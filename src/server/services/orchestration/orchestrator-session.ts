import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type {
  Board,
  BoardKey,
  Card,
  OrchestratorPolicyOverride,
  OrchestratorRecord,
  OrchestratorScope,
  OrchestratorSessionView,
  OrchestratorView,
  StartError,
} from "../../../shared/types.js";
import { sleep } from "../../adapters/exec.js";
import { hasSession, paneAtPrompt, sendKeys } from "../../adapters/tmux.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { DISPATCH_DATA_DIR } from "../../store/data-dir.js";
import {
  ConflictError,
  NotFoundError,
  PolicyError,
  ValidationError,
} from "../domain/errors.js";
import {
  orchestratorMcpConfig,
  orchestratorMcpConfigPath,
} from "../domain/orchestrator-launch.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import {
  checkRecords,
  type RecordsRefusal,
} from "../domain/orchestrator-rules.js";
import { isHiddenCard } from "../../../shared/hidden-card.js";
import { isLiveSessionCard, resolveBoard } from "./boards.js";
import { requireOrchestrationConfig } from "./group-launch.js";
import { revokeOrchestratorToken } from "./orchestrator-tokens.js";
import { runClaude } from "./run-claude.js";
import { startSession } from "./start-session.js";
import { sendConfirmed } from "./supervisor-send.js";

export const orchestratorTools: {
  start: typeof startSession;
  relaunch: typeof runClaude;
  keys: typeof sendKeys;
  send: typeof sendConfirmed;
  hasSession: typeof hasSession;
  atPrompt: typeof paneAtPrompt;
  mcpCommand: () => { command: string; args: string[] };
  stopWait: { totalMs: number; pollMs: number };
} = {
  start: startSession,
  relaunch: runClaude,
  keys: sendKeys,
  send: sendConfirmed,
  hasSession,
  atPrompt: paneAtPrompt,
  mcpCommand: serverMcpCommand,
  stopWait: { totalMs: 30_000, pollMs: 500 },
};

export interface OrchestratorInput {
  id: string;
  name: string;
  role: "main" | "extra";
  scope: OrchestratorScope;
  policyOverride: OrchestratorPolicyOverride;
}

export interface OrchestratorPatch {
  name?: string;
  scope?: OrchestratorScope;
  policyOverride?: OrchestratorPolicyOverride;
}

export interface LifecycleResult {
  record: OrchestratorRecord;
  settled: Promise<void>;
}

const busy = new Set<string>();
const ORCHESTRATOR_PLAYBOOK = { playbook: "Board Orchestrator" };

/**
 * The command that starts `dispatch mcp` from the running server's own entry files.
 *
 * @remarks
 * The file extension of this module picks the sibling cli entry, `.ts` under tsx and `.js`
 * in a build, and the node flags of the server carry over so tsx loads the same way.
 */
function serverMcpCommand(): { command: string; args: string[] } {
  const here = fileURLToPath(import.meta.url);
  const cli = path.resolve(
    path.dirname(here),
    "../../bootstrap",
    `cli${path.extname(here)}`,
  );
  return { command: process.execPath, args: [...process.execArgv, cli, "mcp"] };
}

function findRecord(board: Board, id: string): OrchestratorRecord {
  const record = board.orchestrators.find((r) => r.id === id);
  if (!record) throw new NotFoundError("unknown-orchestrator");
  return record;
}

function refuse(refusal: RecordsRefusal): never {
  switch (refusal.code) {
    case "group-owned":
      throw new ConflictError(refusal.code, { owner: refusal.owner });
    case "main-exists":
    case "duplicate-id":
      throw new ConflictError(refusal.code);
    case "wider-override":
      throw new ValidationError(refusal.code, { field: refusal.field });
    default:
      throw new ValidationError(refusal.code);
  }
}

function assertRecords(
  board: Board,
  records: OrchestratorRecord[],
  changedIds: string[],
): void {
  const check = checkRecords(board.policy, records, changedIds);
  if (!check.ok) refuse(check);
}

function assertScopeCards(board: Board, scope: OrchestratorScope): void {
  const onBoard = (card: Card | undefined): card is Card =>
    card !== undefined && (card.boardKey ?? DEFAULT_BOARD_KEY) === board.key;
  for (const id of scope.groupIds) {
    const card = store.getCard(id);
    if (!onBoard(card) || card.source !== "group") {
      throw new ValidationError("unknown-card");
    }
  }
  for (const id of scope.ticketIds) {
    const card = store.getCard(id);
    if (!onBoard(card) || card.source === "group" || isHiddenCard(card)) {
      throw new ValidationError("unknown-card");
    }
  }
}

async function saveRecords(
  board: Board,
  records: OrchestratorRecord[],
): Promise<void> {
  if (!(await store.setBoardOrchestrators(board.key, records))) {
    throw new NotFoundError("unknown-board");
  }
}

let recordWrites: Promise<unknown> = Promise.resolve();

/**
 * Read the records of a board, change them and save them as one step, after every earlier record write.
 *
 * @remarks
 * The store replaces the whole records array, so a change computed from a board read
 * before an earlier write is saved would drop that write.
 */
function writeRecords<T>(
  key: BoardKey,
  change: (board: Board) => { records: OrchestratorRecord[]; result: T },
): Promise<T> {
  const step = recordWrites.then(async () => {
    const board = resolveBoard(key);
    const { records, result } = change(board);
    await saveRecords(board, records);
    return result;
  });
  recordWrites = step.catch(() => undefined);
  return step;
}

function patchRecord(
  key: BoardKey,
  id: string,
  patch: Partial<OrchestratorRecord>,
): Promise<OrchestratorRecord> {
  return writeRecords(key, (board) => {
    const next = { ...findRecord(board, id), ...patch };
    return {
      records: board.orchestrators.map((r) => (r.id === id ? next : r)),
      result: next,
    };
  });
}

export function setLastWake(
  key: BoardKey,
  id: string,
  lastWake: { reasons: string[]; at: string },
): Promise<OrchestratorRecord> {
  return patchRecord(key, id, { lastWake });
}

const stopListeners: ((key: BoardKey, id: string) => void)[] = [];

/**
 * Register a listener that runs when an orchestrator stop begins.
 *
 * @remarks The wake service registers here, so a stopped orchestrator drops its queue without this
 * file importing the service that writes to it.
 */
export function onOrchestratorStop(
  listener: (key: BoardKey, id: string) => void,
): void {
  stopListeners.push(listener);
}

export interface OrchestratorState {
  markdown: string;
  updatedAt: string | null;
  handoffReady: boolean;
}

/** The saved state of the calling orchestrator, empty before its first write. */
export function readState(caller: OrchestratorIdentity): OrchestratorState {
  const record = findRecord(
    resolveBoard(caller.boardKey),
    caller.orchestratorId,
  );
  return {
    markdown: record.stateMarkdown ?? "",
    updatedAt: record.stateUpdatedAt ?? null,
    handoffReady: record.handoffReady === true,
  };
}

/**
 * Replace the saved state of the calling orchestrator, with the handoff flag false unless given.
 *
 * @remarks
 * The state lives on the record because an orchestrator has no file write tool.
 */
export async function writeState(
  caller: OrchestratorIdentity,
  markdown: string,
  handoffReady: boolean,
): Promise<OrchestratorState> {
  const next = await patchRecord(caller.boardKey, caller.orchestratorId, {
    stateMarkdown: markdown,
    stateUpdatedAt: new Date().toISOString(),
    handoffReady,
  });
  return {
    markdown,
    updatedAt: next.stateUpdatedAt ?? null,
    handoffReady,
  };
}

/**
 * Set the handoff flag of a record.
 *
 * @remarks
 * The supervisor clears it once the fresh session is confirmed.
 */
export async function setHandoffReady(
  key: BoardKey,
  id: string,
  handoffReady: boolean,
): Promise<void> {
  await patchRecord(key, id, { handoffReady });
}

/** The start error of a hidden card as one line: the failed step, then the first stderr line when there is one. */
function startErrorReason(error: StartError | null | undefined): string | null {
  if (!error) return null;
  const detail = error.stderr
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim();
  return (detail ? `${error.step}: ${detail}` : error.step).slice(0, 300);
}

function sessionViewOf(
  record: OrchestratorRecord,
): OrchestratorSessionView | null {
  const card = record.cardId ? store.getCard(record.cardId) : undefined;
  if (!card) return null;
  const session = card.sessions?.find((s) => s.id === card.activeSessionId);
  return {
    cardId: card.id,
    state: session?.state ?? null,
    stateReason: session?.stateReason ?? null,
    contextPercent: session?.contextPercent ?? null,
    model: session?.model ?? null,
    hasTmuxSession: (session?.tmuxSession ?? card.tmuxSession) != null,
    activeSessionId: card.activeSessionId ?? null,
    ttydPort: card.ttydPort ?? null,
    stateSince: session?.stateSince ?? null,
    startError: startErrorReason(card.startError),
  };
}

export function listOrchestrators(board: Board): OrchestratorView[] {
  return board.orchestrators.map((r) => {
    const view: OrchestratorView = { ...r, session: sessionViewOf(r) };
    delete (view as OrchestratorRecord).stateMarkdown;
    return view;
  });
}

export async function addOrchestrator(
  board: Board,
  input: OrchestratorInput,
): Promise<OrchestratorRecord> {
  assertScopeCards(board, input.scope);
  const record: OrchestratorRecord = {
    ...input,
    cardId: null,
    state: "stopped",
    createdAt: new Date().toISOString(),
  };
  return writeRecords(board.key, (current) => {
    const records = [...current.orchestrators, record];
    assertRecords(current, records, [record.id]);
    return { records, result: record };
  });
}

/**
 * Edit the name, scope or override of a record, checking override narrowing only when the patch sends an override.
 *
 * @remarks
 * A board policy that narrowed after the override was saved must not lock the record against
 * unrelated edits; the supervisor applies the narrowed policy at use time.
 */
export async function editOrchestrator(
  board: Board,
  id: string,
  patch: OrchestratorPatch,
): Promise<OrchestratorRecord> {
  findRecord(board, id);
  if (patch.scope) assertScopeCards(board, patch.scope);
  return writeRecords(board.key, (current) => {
    const next: OrchestratorRecord = {
      ...findRecord(current, id),
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.scope === undefined ? {} : { scope: patch.scope }),
      ...(patch.policyOverride === undefined
        ? {}
        : { policyOverride: patch.policyOverride }),
    };
    const records = current.orchestrators.map((r) => (r.id === id ? next : r));
    assertRecords(
      current,
      records,
      patch.policyOverride === undefined ? [] : [id],
    );
    return { records, result: next };
  });
}

/**
 * Add a card an orchestrator created to its scope when it is an extra, so the scope stays the one ownership source.
 *
 * @remarks
 * The append re-reads the record inside the record queue, so it keeps every earlier scope edit.
 * It runs no scope or override check: an append cannot widen anything, and a create that already
 * wrote its card must not fail on a stale scope id or a stale override.
 */
export async function appendToExtraScope(
  caller: OrchestratorIdentity,
  field: keyof OrchestratorScope,
  id: string,
): Promise<void> {
  const isExtra = (board: Board): boolean =>
    board.orchestrators.some(
      (r) => r.id === caller.orchestratorId && r.role === "extra",
    );
  if (!isExtra(resolveBoard(caller.boardKey))) return;
  await writeRecords(caller.boardKey, (board) => ({
    records: board.orchestrators.map((r) =>
      r.id === caller.orchestratorId &&
      r.role === "extra" &&
      !r.scope[field].includes(id)
        ? { ...r, scope: { ...r.scope, [field]: [...r.scope[field], id] } }
        : r,
    ),
    result: undefined,
  }));
}

/**
 * True while the tmux session of a hidden card is open, probed by the name the start saga gives it when the card does not hold it yet.
 *
 * @remarks
 * A first start writes `tmuxSession` on the card only once claude is ready, so during
 * `starting` the open session is known only by its name.
 */
async function hasLiveTmux(cardId: string | null): Promise<boolean> {
  const card = cardId ? store.getCard(cardId) : undefined;
  if (!card) return false;
  const branch = card.sessions?.find(
    (s) => s.id === card.activeSessionId,
  )?.branch;
  const tmux = card.tmuxSession ?? `dsp-${branch ?? card.identifier}`;
  return orchestratorTools.hasSession(`=${tmux}`);
}

/**
 * Remove a stopped orchestrator and revoke its token.
 *
 * @remarks
 * A record whose hidden card still has an open tmux session is refused, so no hidden
 * session is left with no record to resume or stop it.
 */
export async function removeOrchestrator(
  board: Board,
  id: string,
): Promise<void> {
  const refuseLive = (current: Board): OrchestratorRecord => {
    const record = findRecord(current, id);
    if (record.state !== "stopped" || busy.has(`${board.key}:${id}`)) {
      throw new ConflictError("orchestrator-running");
    }
    return record;
  };
  const cardId = refuseLive(board).cardId;
  assertRecords(
    board,
    board.orchestrators.filter((r) => r.id !== id),
    [],
  );
  if (await hasLiveTmux(cardId)) {
    throw new ConflictError("orchestrator-session-live", {
      reason: "the session is still open: exit its shell first",
    });
  }
  await writeRecords(board.key, (current) => {
    refuseLive(current);
    const records = current.orchestrators.filter((r) => r.id !== id);
    assertRecords(current, records, []);
    return { records, result: undefined };
  });
  revokeOrchestratorToken({ boardKey: board.key, orchestratorId: id });
}

/**
 * Take the lifecycle lock of one record synchronously, so two overlapping calls cannot both start.
 *
 * @remarks
 * The lock is held until `settled` ends, which is also when the record leaves its transient state.
 */
function lock(board: Board, id: string): () => void {
  const key = `${board.key}:${id}`;
  if (busy.has(key)) throw new ConflictError("orchestrator-running");
  busy.add(key);
  return () => busy.delete(key);
}

function assertSupervisorOn(board: Board): void {
  if (board.policy.supervisor === "off")
    throw new PolicyError("supervisor-off");
}

async function writeMcpConfig(
  boardKey: BoardKey,
  orchestratorId: string,
): Promise<void> {
  const file = orchestratorMcpConfigPath(
    DISPATCH_DATA_DIR,
    boardKey,
    orchestratorId,
  );
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fsp.writeFile(
    file,
    JSON.stringify(orchestratorMcpConfig(orchestratorTools.mcpCommand())),
    { mode: 0o600 },
  );
  await fsp.chmod(file, 0o600);
}

function kickoffDirection(board: Board, record: OrchestratorRecord): string {
  return `You are the orchestrator "${record.name}" (id ${record.id}) of board ${board.key}. Use the dispatch tools to coordinate the work of this board.`;
}

function settledState(cardId: string): "running" | "stopped" {
  const card = store.getCard(cardId);
  return card && isLiveSessionCard(card) && card.startError == null
    ? "running"
    : "stopped";
}

type SettledState = "running" | "stopped";

/**
 * Settle a launch: write the state the hidden card ended in, revoke the token of a `stopped` end, and always release the lock.
 *
 * @remarks
 * A launch that throws leaves the record `stopped`, so the user can start it again. A launch
 * that answers a state yielded to another launch of the same session, which owns the outcome and
 * the token, so that state is written back as it was and nothing is revoked.
 */
async function settleLaunch(
  board: Board,
  id: string,
  cardId: string,
  launch: () => Promise<SettledState | void>,
  release: () => void,
): Promise<void> {
  let state: SettledState = "stopped";
  let yielded = false;
  try {
    const kept = await launch();
    yielded = kept !== undefined;
    state = kept ?? settledState(cardId);
    if (yielded) {
      console.warn(
        `[orchestrator] launch of ${id} yielded: another launch of its session is in flight`,
      );
    } else if (state === "stopped") {
      const reason = startErrorReason(store.getCard(cardId)?.startError);
      console.warn(
        `[orchestrator] launch of ${id} failed: ${reason ?? "no live session"}`,
      );
    }
  } catch (err) {
    console.warn(
      `[orchestrator] launch of ${id} failed: ${(err as Error).message}`,
    );
  }
  try {
    if (state === "stopped" && !yielded) {
      revokeOrchestratorToken({ boardKey: board.key, orchestratorId: id });
    }
    await patchRecord(board.key, id, { state });
  } finally {
    release();
  }
}

/**
 * Start the session of a stopped orchestrator as a hidden card and answer once it is `starting`.
 *
 * @remarks
 * The hidden card is created on the first start and reused after. The start saga runs
 * after the answer; `settled` resolves when it ended and the record holds `running` or `stopped`.
 */
export async function startOrchestrator(
  board: Board,
  id: string,
): Promise<LifecycleResult> {
  assertSupervisorOn(board);
  const current = findRecord(board, id);
  if (current.state !== "stopped")
    throw new ConflictError("orchestrator-running");
  const config = requireOrchestrationConfig();
  const release = lock(board, id);
  try {
    const known = current.cardId ? store.getCard(current.cardId) : undefined;
    if (await hasLiveTmux(current.cardId)) {
      throw new ConflictError("orchestrator-session-live", {
        reason: "the session is still open: resume it",
      });
    }
    const card =
      known ??
      (await store.createOrchestratorCard(
        board.key,
        `Orchestrator: ${current.name}`,
        id,
      ));
    try {
      await writeMcpConfig(board.key, id);
    } catch (err) {
      await store.setStartError(card.id, {
        step: "writing mcp config",
        stderr: (err as Error).message,
        variant: "generic",
      });
      await patchRecord(board.key, id, { cardId: card.id });
      throw err;
    }
    const record = await patchRecord(board.key, id, {
      cardId: card.id,
      state: "starting",
    });
    const settled = settleLaunch(
      board,
      id,
      card.id,
      () =>
        orchestratorTools.start(
          card.id,
          kickoffDirection(board, record),
          config,
          ORCHESTRATOR_PLAYBOOK,
        ),
      release,
    );
    return { record, settled };
  } catch (err) {
    release();
    throw err;
  }
}

/**
 * True for a record resume can act on: `stopped`, or `running` while its session is lost or back at the shell.
 *
 * @remarks
 * A reboot or a claude exit leaves the record `running` with no claude to talk to, and
 * only a resume brings it back.
 */
function isResumable(record: OrchestratorRecord, card: Card): boolean {
  if (record.state === "stopped") return true;
  if (record.state !== "running") return false;
  const state = card.sessions?.find(
    (s) => s.id === card.activeSessionId,
  )?.state;
  return (
    card.sessionLost === true || state === "lost" || state === "shell_prompt"
  );
}

/**
 * Bring an orchestrator back: relaunch claude in its live tmux session, else run the start saga again.
 *
 * @remarks
 * The in place relaunch goes through `runClaude`, which hands the shell a fresh token and
 * resumes the recorded conversation.
 */
export async function resumeOrchestrator(
  board: Board,
  id: string,
): Promise<LifecycleResult> {
  assertSupervisorOn(board);
  const current = findRecord(board, id);
  const card = current.cardId ? store.getCard(current.cardId) : undefined;
  if (!card || !isResumable(current, card)) {
    throw new ConflictError("orchestrator-not-resumable");
  }
  const cardId = card.id;
  const previous = current.state === "running" ? "running" : "stopped";
  const config = requireOrchestrationConfig();
  const release = lock(board, id);
  try {
    await writeMcpConfig(board.key, id);
    const record = await patchRecord(board.key, id, { state: "starting" });
    const launch = async (): Promise<SettledState | void> => {
      const tmux = store.getCard(cardId)?.tmuxSession;
      const live =
        tmux !== undefined && (await orchestratorTools.hasSession(`=${tmux}`));
      const outcome = live ? await orchestratorTools.relaunch(cardId) : null;
      if (outcome === "launched") return;
      if (outcome === "busy") return previous;
      if (live) throw new ConflictError("orchestrator-busy");
      await orchestratorTools.start(
        cardId,
        kickoffDirection(board, record),
        config,
        ORCHESTRATOR_PLAYBOOK,
      );
    };
    return {
      record,
      settled: settleLaunch(board, id, cardId, launch, release),
    };
  } catch (err) {
    release();
    throw err;
  }
}

async function waitForPrompt(target: string): Promise<boolean> {
  const { totalMs, pollMs } = orchestratorTools.stopWait;
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (await orchestratorTools.atPrompt(target).catch(() => false))
      return true;
    await sleep(pollMs);
  }
  return false;
}

/**
 * Stop a running orchestrator: one Escape, then `/exit` through the confirmed send, then revoke its token.
 *
 * @remarks
 * Nothing is killed. The tmux session stays, so the shell holds the pane and a later resume
 * can relaunch claude in it. When the shell prompt does not come back while the tmux session lives,
 * claude may still run, so the record returns to `running` with its token and the user can stop again.
 */
export async function stopOrchestrator(
  board: Board,
  id: string,
): Promise<LifecycleResult> {
  const current = findRecord(board, id);
  if (current.state !== "running")
    throw new ConflictError("orchestrator-not-running");
  const release = lock(board, id);
  try {
    const record = await patchRecord(board.key, id, { state: "stopping" });
    for (const listener of stopListeners) listener(board.key, id);
    const identity = { boardKey: board.key, orchestratorId: id };
    const settled = (async () => {
      const card = current.cardId ? store.getCard(current.cardId) : undefined;
      const session = card?.sessions?.find(
        (s) => s.id === card.activeSessionId,
      );
      let exited = true;
      try {
        if (card && session?.tmuxSession) {
          exited = false;
          const target = `=${session.tmuxSession}:`;
          await orchestratorTools.keys(target, ["Escape"]);
          await orchestratorTools.send(
            card,
            session,
            "/exit",
            "orchestrator_stop",
          );
          exited = await waitForPrompt(target);
        }
      } catch (err) {
        console.warn(
          `[orchestrator] stop of ${id} hit an error: ${(err as Error).message}`,
        );
      }
      try {
        if (
          !exited &&
          (await orchestratorTools
            .hasSession(`=${session?.tmuxSession}`)
            .catch(() => false))
        ) {
          console.warn(
            `[orchestrator] stop of ${id} could not confirm that claude exited; the record stays running`,
          );
          await patchRecord(board.key, id, { state: "running" });
          return;
        }
        revokeOrchestratorToken(identity);
        await patchRecord(board.key, id, { state: "stopped" });
      } finally {
        release();
      }
    })();
    return { record, settled };
  } catch (err) {
    release();
    throw err;
  }
}

/**
 * Settle every `starting` or `stopping` record of every board once at boot: `running` while its hidden tmux session is open, else `stopped` with its token revoked.
 *
 * @remarks
 * The lifecycle lock and the background settle live in memory, so after a restart no step
 * is left to move such a record on. Claude may still run in an open session, so that record stays
 * `running` with its token and the supervisor classifies the session, which keeps Stop and Resume usable.
 */
export async function settleTransientRecords(): Promise<number> {
  const transient = (r: OrchestratorRecord): boolean =>
    r.state === "starting" || r.state === "stopping";
  let settled = 0;
  for (const { key, orchestrators } of store.listBoards()) {
    if (!orchestrators.some(transient)) continue;
    const live = new Set<string>();
    for (const r of orchestrators.filter(transient)) {
      if (await hasLiveTmux(r.cardId)) live.add(r.id);
    }
    const moved = await writeRecords(key, (board) => {
      const ids = board.orchestrators.filter(transient).map((r) => r.id);
      return {
        records: board.orchestrators.map((r) =>
          ids.includes(r.id)
            ? {
                ...r,
                state: live.has(r.id)
                  ? ("running" as const)
                  : ("stopped" as const),
              }
            : r,
        ),
        result: ids,
      };
    });
    for (const orchestratorId of moved) {
      if (live.has(orchestratorId)) continue;
      revokeOrchestratorToken({ boardKey: key, orchestratorId });
    }
    settled += moved.length;
  }
  return settled;
}
