import { MEMORY_RESUME_LINE } from "../../../shared/dispatch-lines.js";
import type { Card, Session } from "../../../shared/types.js";
import { sleep } from "../../adapters/exec.js";
import { signalSafe } from "../../adapters/process-tree.js";
import {
  capturePane,
  hasSession,
  paneAtPrompt,
  paneTerminal,
  paneTtyCooked,
  sessionEnvHas,
} from "../../adapters/tmux.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { paneBusy, paneDialog } from "../domain/supervisor-state.js";
import { withCardLock } from "./card-lock.js";
import { activeSession } from "./pause-card.js";
import { runActions } from "./supervisor-actions.js";
import { markNeedsInput, record } from "./supervisor-record.js";
import { ensureWatcher } from "./supervisor-registry.js";
import { SHELL_SESSION_ENV } from "./steps.js";
import {
  sendLine,
  waitFor,
  type SendReason,
  type SendTiming,
} from "./supervisor-send.js";

const BUSY_POLL_MS = 5_000;
const BUSY_LIMIT_MS = 30 * 60_000;
const ATTEMPTS = 3;
const RELAUNCH_ON: ReadonlySet<SendReason> = new Set([
  "not ready",
  "not in transcript",
]);
const probing = new Set<string>();

export const probeTools: {
  capturePane: typeof capturePane;
  paneTerminal: typeof paneTerminal;
  ttyCooked: typeof paneTtyCooked;
  atShellPrompt: (target: string) => Promise<boolean>;
  shellRoot: (name: string) => Promise<boolean>;
  hasSession: typeof hasSession;
  send: typeof sendLine;
  resume: (card: Card, session: Session, evidence: string) => Promise<void>;
  watcher: typeof ensureWatcher;
  kill: (pid: number, signal: "SIGHUP" | "SIGKILL") => void;
  sleep: (ms: number) => Promise<void>;
  timing: SendTiming;
  grace: { hangupMs: number; killMs: number; pollMs: number };
} = {
  capturePane,
  paneTerminal,
  ttyCooked: paneTtyCooked,
  atShellPrompt: (target) => paneAtPrompt(target).catch(() => false),
  shellRoot: (name) =>
    sessionEnvHas(`=${name}`, SHELL_SESSION_ENV).catch(() => false),
  hasSession,
  send: sendLine,
  resume: (card, session, evidence) =>
    runActions(card, session, [{ kind: "resume" }], evidence),
  watcher: ensureWatcher,
  kill: (pid, signal) => process.kill(pid, signal),
  sleep,
  timing: { readyMs: 30_000, settleMs: 1_500, confirmMs: 30_000, pollMs: 500 },
  grace: { hangupMs: 10_000, killMs: 5_000, pollMs: 500 },
};

type Live = { card: Card; session: Session };
type Outcome =
  | { kind: "gone" }
  | { kind: "busy" }
  | { kind: "confirmed" }
  | { kind: "unconfirmed"; reason?: string }
  | { kind: "ended"; why: string };

/**
 * End the foreground job of a pane: hang it up, then kill it if the shell does not return.
 *
 * @remarks Never signals the shell group, so a pane already at its prompt is left alone. The kill
 * goes out only when the same group still owns the terminal, so a pid reused meanwhile is spared.
 */
async function endJob(target: string): Promise<void> {
  const read = () =>
    Promise.resolve(probeTools.paneTerminal(target)).catch(() => null);
  const terminal = await read();
  if (!terminal || terminal.tpgid === terminal.pgid) return;
  if (!signalSafe(terminal.tpgid)) return;
  const signal = (name: "SIGHUP" | "SIGKILL") => {
    try {
      probeTools.kill(-terminal.tpgid, name);
    } catch {
      return;
    }
  };
  const atPrompt = () => probeTools.atShellPrompt(target);
  const { hangupMs, killMs, pollMs } = probeTools.grace;
  signal("SIGHUP");
  if (await waitFor(atPrompt, hangupMs, pollMs)) return;
  if ((await read())?.tpgid !== terminal.tpgid) return;
  signal("SIGKILL");
  await waitFor(atPrompt, killMs, pollMs);
}

/**
 * Wait until the pane shows an idle input row, or give up when the card or session is gone.
 *
 * @remarks A failed capture is not idle. The wait ends after `BUSY_LIMIT_MS` since the probe began.
 */
async function waitIdle(
  live: () => Live | undefined,
  startedAt: number,
): Promise<(Live & { pane: string; name: string }) | undefined> {
  for (;;) {
    const now = live();
    const name = now?.session.tmuxSession;
    if (!now || name === undefined) return undefined;
    if (!(await probeTools.hasSession(`=${name}`))) return undefined;
    const pane = await probeTools.capturePane(`=${name}:`).catch(() => null);
    if (pane !== null && !paneBusy(pane)) return { ...now, pane, name };
    if (Date.now() - startedAt >= BUSY_LIMIT_MS) return undefined;
    await probeTools.sleep(BUSY_POLL_MS);
  }
}

/**
 * Type the probe line under the card lock and end the job when the symptom holds.
 *
 * @remarks The symptom is an unconfirmed line while the pane tty is cooked under a non-shell job,
 * which a healthy REPL never shows. A busy pane after the send means a turn began, so the line is
 * never typed twice; a pane with no login shell root always reads as at its prompt, so it is spared.
 */
async function attempt(
  cardId: string,
  live: () => Live | undefined,
): Promise<Outcome> {
  const before = live();
  if (!before) return { kind: "gone" };
  const sent = await probeTools.send(
    before.card,
    before.session,
    MEMORY_RESUME_LINE,
    "resume_probe",
    probeTools.timing,
  );
  if (sent.result === "confirmed") return { kind: "confirmed" };
  if (sent.reason === undefined || !RELAUNCH_ON.has(sent.reason))
    return { kind: "unconfirmed", reason: sent.reason };
  const now = live();
  if (!now) return { kind: "gone" };
  const name = now.session.tmuxSession ?? "";
  const target = `=${name}:`;
  const pane = await probeTools.capturePane(target).catch(() => null);
  if (pane === null || paneBusy(pane))
    return { kind: "unconfirmed", reason: "turn began" };
  if ((await probeTools.ttyCooked(target)) !== true)
    return { kind: "unconfirmed", reason: "not stuck" };
  if (!(await probeTools.shellRoot(name)))
    return { kind: "unconfirmed", reason: "no shell root" };
  const why = `resume probe: ${sent.reason}, pane tty cooked`;
  record(now.card, now.session, {
    action: "relaunch",
    level: "WARN",
    reason: why,
  });
  console.warn(`[memory] relaunching ${cardId}: ${why}`);
  await endJob(target);
  return { kind: "ended", why };
}

/** Hand the card to the resume action once its job ended, or flag it when claude never left. */
async function relaunch(
  live: () => Live | undefined,
  why: string,
): Promise<void> {
  const now = live();
  if (!now) return;
  const target = `=${now.session.tmuxSession}:`;
  if (!(await probeTools.atShellPrompt(target))) {
    await markNeedsInput(
      now.card,
      now.session,
      "resume_failed",
      "resume probe: claude did not exit",
    );
    return;
  }
  await probeTools.resume(now.card, now.session, why);
}

/**
 * Type one Dispatch line after a memory resume and relaunch claude when the REPL is stuck.
 *
 * @remarks Types only on an idle In Progress loop, and relaunches only when the line is unconfirmed
 * and the pane tty is cooked. It holds the card lock and the supervisor watcher, so typing and
 * relaunch never race the supervisor. Never throws.
 */
export async function probeResume(cardId: string): Promise<void> {
  if (probing.has(cardId)) return;
  probing.add(cardId);
  try {
    await probe(cardId);
  } catch (err) {
    console.warn(
      `[memory] resume probe ${cardId} failed: ${(err as Error).message}`,
    );
  } finally {
    probing.delete(cardId);
  }
}

async function probe(cardId: string): Promise<void> {
  const startedAt = Date.now();
  const first = store.getCard(cardId);
  const sessionId = first && activeSession(first)?.id;
  const live = (): Live | undefined => {
    const card = store.getCard(cardId);
    const session = card && activeSession(card);
    if (!card || !session || session.id !== sessionId) return undefined;
    if (store.isStarting(cardId) || card.paused) return undefined;
    if (card.column !== "in_progress") return undefined;
    if (session.state === "needs_input") return undefined;
    if (session.state === "permission_prompt") return undefined;
    return { card, session };
  };
  let last: Live | undefined;
  for (let n = 0; n < ATTEMPTS; n++) {
    const idle = await waitIdle(live, startedAt);
    if (!idle) return;
    const { card, session, pane, name } = idle;
    last = { card, session };
    if (paneDialog(pane)) {
      record(card, session, {
        action: "resume_probe",
        result: "skipped",
        reason: "dialog open",
      });
      return;
    }
    const watcher = probeTools.watcher(name, session.state ?? null);
    let outcome: Outcome = { kind: "busy" };
    if (!watcher.running) {
      watcher.running = true;
      try {
        const locked = await withCardLock(cardId, () => attempt(cardId, live));
        outcome = locked === "busy" ? { kind: "busy" } : locked;
        if (outcome.kind === "ended") await relaunch(live, outcome.why);
      } finally {
        watcher.running = false;
      }
    }
    if (outcome.kind === "busy") {
      await probeTools.sleep(BUSY_POLL_MS);
      continue;
    }
    if (outcome.kind === "confirmed")
      record(card, session, { action: "resume_probe", result: "confirmed" });
    else if (outcome.kind === "unconfirmed")
      record(card, session, {
        action: "resume_probe",
        result: "unconfirmed",
        reason: outcome.reason,
      });
    return;
  }
  if (last)
    record(last.card, last.session, {
      action: "resume_probe",
      result: "skipped",
      reason: "supervisor busy",
    });
}
