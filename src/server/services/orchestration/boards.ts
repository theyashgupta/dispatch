import fsp from "node:fs/promises";
import path from "node:path";
import {
  ALL_BOARDS,
  DEFAULT_BOARD_KEY,
  DEFAULT_CHECK_COMMAND,
  defaultBoardPolicy,
  deriveBoardKey,
  identifierPrefix,
  isReservedBoardKey,
  parseBoardKey,
} from "../../../shared/board-key.js";
import { buildAttentionQueue } from "../../../shared/attention-queue.js";
import { loopView } from "../../../shared/loop-view.js";
import {
  hasLiveSession,
  hasLoopProgress,
  isActiveCard,
} from "../../../shared/running-group.js";
import type {
  Board,
  BoardCount,
  BoardCounts,
  BoardKey,
  BoardList,
  BoardPolicy,
  BoardWorkspaceRepo,
  Card,
  Column,
  SessionSummary,
} from "../../../shared/types.js";
import {
  BoardUnavailableError,
  redactCard,
  boardRepository as store,
} from "../../store/board-repository.js";
import { boardWorkspace } from "../domain/board-workspace.js";
import { cardOwner, effectivePolicy } from "../domain/orchestrator-rules.js";
import type {
  OrchestratorIdentity,
  ScopeTarget,
} from "../domain/orchestrator-scope.js";
import {
  BoardConflictError,
  BoardNotFoundError,
  BoardValidationError,
  ForbiddenError,
} from "../domain/errors.js";
import {
  getOrchestrationConfig,
  updateWorkspaceRoot,
} from "../infra/config-holder.js";
import {
  getWorkflow,
  noteWorkflowFailure,
  workflowFailedRecently,
} from "./linear-outbound.js";
import { isWithinHome, restatRepos, validateFolder } from "./workspaces.js";

const COPY = {
  "invalid-key":
    "Use 2 to 6 capital letters or digits, starting with a letter.",
  "reserved-key": "LOCAL and GROUP are reserved.",
  "missing-name": "Enter a name.",
  "folder-missing": "This folder does not exist.",
  "no-repositories":
    "This board has no repository. Add one in the board settings.",
  "no-workspaces-root": "Set the Dispatch workspaces root in Settings.",
  "no-free-key": "No free key for this name. Enter a key in Advanced.",
  "git-init-failed": "Dispatch could not make the repository.",
} as const;

type StaticBoardVariant = keyof typeof COPY;

type LinearTeamKeyReader = () => Promise<string[] | null>;

interface NewBoardInput {
  key?: string;
  name: string;
  workspaceRoot?: string;
  repositories: BoardWorkspaceRepo[];
  linearTeamKeys: string[];
}

interface BoardUpdateInput {
  name?: string;
  workspaceRoot?: string;
  repositories?: BoardWorkspaceRepo[];
  linearTeamKeys?: string[];
}

/** True when a variant carries fixed UI copy, so a schema message can become a typed error. */
export function isStaticBoardVariant(
  variant: string,
): variant is StaticBoardVariant {
  return variant in COPY;
}

/**
 * The typed 400 for a fixed-copy board variant.
 *
 * @remarks `error` is the exact UI copy and `code` is the variant. `details` adds the field that
 * failed.
 */
export function boardRefusal(
  variant: StaticBoardVariant,
  details?: Record<string, unknown>,
): BoardValidationError {
  return new BoardValidationError(variant, COPY[variant], details);
}

/**
 * Resolve the optional board of a request to a copy of its board.
 *
 * @remarks Absent means the default board, and an unknown key throws the typed 404 `unknown-board`.
 * An archived board resolves, so reads work; a create goes through {@link resolveBoardForCreate}.
 * The copy keeps a caller from changing the live store entry.
 */
export function resolveBoard(key: BoardKey | undefined): Board {
  const board = store.getBoard(key ?? DEFAULT_BOARD_KEY);
  if (!board) throw new BoardNotFoundError("unknown-board");
  return structuredClone(board);
}

/** Resolve a board that is not archived; an archived board throws the same 404 as an unknown one. */
export function resolveOpenBoard(key: BoardKey): Board {
  const board = resolveBoard(key);
  if (board.archived) throw new BoardNotFoundError("unknown-board");
  return board;
}

/** The policy an orchestrator works under: its board policy narrowed by its own override. */
export function callerPolicy(caller: OrchestratorIdentity): BoardPolicy {
  const board = resolveBoard(caller.boardKey);
  return effectivePolicy(
    board.policy,
    board.orchestrators.find((r) => r.id === caller.orchestratorId),
  );
}

/** The board and the owner orchestrator of a card, for the scope check of an orchestrator call. */
export function scopeTargetOf(card: Card): ScopeTarget {
  const records =
    store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY)?.orchestrators ?? [];
  const group = card.groupId ? store.getCard(card.groupId) : undefined;
  return {
    boardKey: card.boardKey,
    owner: cardOwner(records, card, group),
  };
}

/** Resolve the board of a create request; an archived board throws the typed 409 `board-archived`. */
export function resolveBoardForCreate(key: BoardKey | undefined): Board {
  const board = resolveBoard(key);
  if (board.archived) throw new BoardConflictError("board-archived");
  return board;
}

/**
 * Turn the store's create refusal into the typed error of the same cause.
 *
 * @remarks The store throws `BoardUnavailableError` when a board is archived or gone between the
 * resolve and the write. Any other error comes back unchanged for the caller to throw.
 */
export function mapBoardUnavailable(err: unknown): unknown {
  if (!(err instanceof BoardUnavailableError)) return err;
  return store.getBoard(err.board)
    ? new BoardConflictError("board-archived")
    : new BoardNotFoundError("unknown-board");
}

export const isLiveSessionCard = hasLiveSession;

/** True for a card that is not Done and has a live session, a provisioning step or a start in flight. */
export function isRunningCard(card: Card): boolean {
  return (
    isActiveCard(card) || (card.column !== "done" && store.isStarting(card.id))
  );
}

/** The number of running group loops on a board, without the card `exceptId` when given. */
export function runningLoops(board: BoardKey, exceptId?: string): number {
  return store
    .listCards(board)
    .filter(
      (c) => c.source === "group" && c.id !== exceptId && isRunningCard(c),
    ).length;
}

/** True for a dependency group in Done, or with at least one PR and every PR merged. */
export function dependencyDone(id: string): boolean {
  const dep = store.getCard(id);
  if (!dep) return false;
  if (dep.column === "done") return true;
  const prs = dep.prs ?? [];
  return prs.length > 0 && prs.every((pr) => pr.state === "merged");
}

interface CardListFilters {
  column?: Column;
  source?: string;
  hasSession?: boolean;
  text?: string;
}

/**
 * The cards of one board that match the filters, redacted for the wire.
 *
 * @remarks Each card passes through `redactCard`, so no `hookToken` or session record leaves. A
 * missing filter matches every card; `total` counts the matches.
 */
export function listBoardCards(
  board: BoardKey,
  filters: CardListFilters,
): { cards: Card[]; total: number } {
  const cards = store
    .listCards(board)
    .filter(
      (card) =>
        (filters.column === undefined || card.column === filters.column) &&
        (filters.source === undefined ||
          (card.source ?? "linear") === filters.source) &&
        (filters.hasSession === undefined ||
          hasSession(card) === filters.hasSession) &&
        (filters.text === undefined || matchesText(card, filters.text)),
    )
    .map(redactCard);
  return { cards, total: cards.length };
}

function matchesText(card: Card, text: string): boolean {
  const needle = text.toLowerCase();
  return (
    card.title.toLowerCase().includes(needle) ||
    card.identifier.toLowerCase().includes(needle)
  );
}

function hasSession(card: Card): boolean {
  return (card.sessions?.length ?? 0) > 0 || card.tmuxSession != null;
}

type SessionListEntry = SessionSummary & { cardId: string };

/**
 * The session records of one board, each with the id of its card.
 *
 * @remarks Each record is the wire `SessionSummary` built by `redactCard`, so the hook token never
 * leaves. `live` keeps the sessions whose terminal is up, or the lost ones when false.
 */
export function listBoardSessions(
  board: BoardKey,
  live: boolean | undefined,
): SessionListEntry[] {
  return store
    .listCards(board)
    .flatMap((card) =>
      (redactCard(card).sessionSummaries ?? [])
        .filter((summary) => live === undefined || summary.lost !== live)
        .map((summary) => ({ cardId: card.id, ...summary })),
    );
}

/**
 * The counts of every board, from a single pass over the cards of all boards.
 *
 * @remarks `attention` is the length of the attention queue of the board. `loops` lists the running group cards, and a group with no loop progress has a null percent.
 */
export function boardCounts(): BoardCounts {
  const now = new Date();
  const byKey = new Map<BoardKey, BoardCount>(
    store.listBoards().map((board) => [
      board.key,
      {
        key: board.key,
        running: 0,
        openGroups: 0,
        attention: 0,
        loops: [],
      },
    ]),
  );
  const cardsByKey = new Map<BoardKey, Card[]>();
  for (const card of store.listCards(ALL_BOARDS)) {
    const key = card.boardKey ?? DEFAULT_BOARD_KEY;
    const count = byKey.get(key);
    if (!count) continue;
    const list = cardsByKey.get(key);
    if (list === undefined) cardsByKey.set(key, [card]);
    else list.push(card);
    if (isLiveSessionCard(card)) count.running += 1;
    if (card.source === "group" && card.column !== "done") {
      count.openGroups += 1;
    }
    if (card.source === "group" && isRunningCard(card)) {
      count.loops.push({
        groupId: card.identifier,
        percent: hasLoopProgress(card)
          ? loopView(card.loopProgress, {}).percent
          : null,
      });
    }
  }
  for (const count of byKey.values()) {
    count.loops.sort((a, b) =>
      a.groupId.localeCompare(b.groupId, undefined, { numeric: true }),
    );
    count.attention = buildAttentionQueue({
      boardKey: count.key,
      cards: cardsByKey.get(count.key) ?? [],
      decisions: store.listDecisionItems(count.key, "open"),
      now,
    }).length;
  }
  return { counts: [...byKey.values()], at: now.toISOString() };
}

/**
 * The sessions that block a board archive.
 *
 * @remarks
 * A stopped orchestrator keeps its hidden card's tmux shell, because stop never kills, so
 * that card does not count.
 */
function activeSessionCount(key: BoardKey): number {
  const stopped = new Set(
    store
      .getBoard(key)
      ?.orchestrators.filter((r) => r.state === "stopped")
      .map((r) => r.cardId),
  );
  return store
    .listAllCards(key)
    .filter(
      (card) =>
        !stopped.has(card.id) &&
        (isLiveSessionCard(card) ||
          card.provisioningStep != null ||
          store.isStarting(card.id)),
    ).length;
}

/**
 * The board as the API shows it.
 *
 * @remarks The default board keeps its sessions folder in `Config` and its repositories in the
 * global workspace folders, so the view reads them from there. It is a copy.
 */
function viewOf(board: Board): Board {
  const view = structuredClone(board);
  if (board.key !== DEFAULT_BOARD_KEY) return view;
  const { folders, lastUsed } = store.getWorkspaceFolders(board.key);
  const workspace = boardWorkspace(
    board,
    getOrchestrationConfig()?.workspaceRoot,
    folders,
  );
  view.workspaceRoot =
    workspace.workspaceRoot && path.resolve(workspace.workspaceRoot);
  view.repositories = workspace.repositories;
  view.lastUsedFolder = lastUsed;
  return view;
}

/**
 * The Linear team keys, from the workflow read the Linear routes share.
 *
 * @remarks Answers null when Linear is off, with no log line. A failed read answers null with one
 * log line and is remembered for 60 s, so a list or create never waits on a dead Linear twice. A
 * cached workflow wins over that memory, so a Linear that recovered is used at once.
 */
async function readLinearTeamKeys(): Promise<string[] | null> {
  if (workflowFailedRecently()) return null;
  const result = await getWorkflow();
  if (result.ok) {
    return result.workflow.teams.map((team) => team.key);
  }
  if (result.status === 502) {
    console.warn("boards: Linear team keys skipped:", result.error);
    noteWorkflowFailure();
  }
  return null;
}

function linearCardPrefixes(): string[] {
  const prefixes = new Set<string>();
  for (const card of store.listCards(ALL_BOARDS)) {
    if ((card.source ?? "linear") !== "linear") continue;
    prefixes.add(identifierPrefix(card.identifier));
  }
  return [...prefixes];
}

/**
 * Every board and the Linear team keys the create form must not reuse.
 *
 * @remarks The keys are the identifier prefixes of the Linear cards in the store plus the keys of
 * the Linear teams when the read works.
 */
export async function listBoards(
  readTeamKeys: LinearTeamKeyReader = readLinearTeamKeys,
): Promise<BoardList> {
  const known = new Set(linearCardPrefixes());
  for (const key of (await readTeamKeys()) ?? []) known.add(key);
  return {
    boards: store.listBoards().map(viewOf),
    knownLinearTeamKeys: [...known].sort(),
  };
}

/** One board as the API shows it, or the typed 404 `unknown-board`. */
export function getBoard(key: BoardKey): Board {
  return viewOf(resolveBoard(key));
}

/**
 * Store a board policy and answer the board as the API shows it, or the typed 404 `unknown-board`.
 *
 * @remarks An omitted `groupPlaybook` or `wakeMinutes` keeps the stored value, and an explicit null clears the playbook.
 */
export async function setBoardPolicy(
  key: BoardKey,
  policy: Omit<BoardPolicy, "groupPlaybook" | "wakeMinutes"> & {
    groupPlaybook?: string | null | undefined;
    wakeMinutes?: number | undefined;
  },
): Promise<Board> {
  const stored = store.getBoard(key)?.policy;
  const groupPlaybook =
    policy.groupPlaybook === undefined
      ? (stored?.groupPlaybook ?? null)
      : policy.groupPlaybook;
  const wakeMinutes =
    policy.wakeMinutes ??
    stored?.wakeMinutes ??
    defaultBoardPolicy(key).wakeMinutes;
  const board = await store.setBoardPolicy(key, {
    ...policy,
    groupPlaybook,
    wakeMinutes,
  });
  if (!board) throw new BoardNotFoundError("unknown-board");
  return viewOf(board);
}

/**
 * True when a folder can be a repository of the board.
 *
 * @remarks One rule for every write path. A folder of the default board only has to exist, because
 * it can be a parent folder of repositories; a folder of any other board must hold a `.git` entry.
 */
export async function isBoardRepository(
  board: BoardKey,
  folder: string,
): Promise<boolean> {
  return board === DEFAULT_BOARD_KEY
    ? (await validateFolder(folder)) === "ok"
    : restatRepos([{ path: folder, base: "" }]);
}

async function assertRepositories(
  board: BoardKey,
  repositories: readonly BoardWorkspaceRepo[],
): Promise<void> {
  for (const repo of repositories) {
    if (!(await isBoardRepository(board, repo.path))) {
      throw boardRefusal("folder-missing", {
        field: "repositories",
        path: repo.path,
      });
    }
  }
}

async function assertSessionsFolder(workspaceRoot: string): Promise<void> {
  if ((await validateFolder(workspaceRoot)) !== "ok") {
    throw boardRefusal("folder-missing", { field: "workspaceRoot" });
  }
}

/**
 * Create a board after the name, key, folder, repository and Linear team checks.
 *
 * @remarks The checks run in the order of the form: name, explicit key, workspaces root, sessions
 * folder, repositories, a key a board already uses, a key a Linear team uses, then a team key
 * another board lists. A missing key is derived from the name and retried up to 3 times when the
 * store refuses it; a missing folder is the key below the workspaces root, made right before the
 * store write and removed again when the store refuses an empty one.
 */
export async function createBoard(
  input: NewBoardInput,
  readTeamKeys: LinearTeamKeyReader = readLinearTeamKeys,
): Promise<Board> {
  const name = input.name.trim();
  if (name === "") throw boardRefusal("missing-name");
  let explicitKey: BoardKey | null = null;
  if (input.key !== undefined) {
    explicitKey = parseBoardKey(input.key);
    if (explicitKey === null) throw boardRefusal("invalid-key");
    if (isReservedBoardKey(explicitKey)) throw boardRefusal("reserved-key");
  }
  const folder = await sessionsFolderFor(input.workspaceRoot);
  const write = (key: BoardKey) => writeBoard(key, name, input, folder);
  if (explicitKey !== null) {
    await assertRepositories(explicitKey, input.repositories);
    return createWithKey(explicitKey, input, readTeamKeys, write);
  }
  return createWithDerivedKey(name, input, await readTeamKeys(), write);
}

type SessionsFolder =
  { kind: "given"; path: string } | { kind: "default"; root: string };

type StoreRefusal = Exclude<
  Awaited<ReturnType<typeof store.createBoard>>,
  { ok: true }
>;

async function sessionsFolderFor(
  workspaceRoot: string | undefined,
): Promise<SessionsFolder> {
  if (workspaceRoot !== undefined) {
    await assertSessionsFolder(workspaceRoot);
    return { kind: "given", path: workspaceRoot };
  }
  const defaultRoot = getOrchestrationConfig()?.workspaceRoot;
  if (!defaultRoot) throw boardRefusal("no-workspaces-root");
  return { kind: "default", root: path.resolve(defaultRoot) };
}

async function createWithKey(
  key: BoardKey,
  input: NewBoardInput,
  readTeamKeys: LinearTeamKeyReader,
  write: (key: BoardKey) => ReturnType<typeof store.createBoard>,
): Promise<Board> {
  const teamKeys = await readTeamKeys();
  const existing = store.getBoard(key);
  if (existing) throw duplicateKey(existing.name, deriveFor(key, teamKeys));
  if (teamKeys?.includes(key)) throw linearTeamKey(key);
  assertTeamKeysFree(input.linearTeamKeys);
  const result = await write(key);
  if (result.ok) return viewOf(result.board);
  throw refusalFor(result, key, teamKeys);
}

const DERIVED_KEY_TRIES = 3;

async function createWithDerivedKey(
  name: string,
  input: NewBoardInput,
  teamKeys: readonly string[] | null,
  write: (key: BoardKey) => ReturnType<typeof store.createBoard>,
): Promise<Board> {
  const taken = takenKeys(teamKeys);
  let key = nextFreeKey(name, taken);
  await assertRepositories(key, input.repositories);
  assertTeamKeysFree(input.linearTeamKeys);
  for (let attempt = 1; ; attempt++) {
    const result = await write(key);
    if (result.ok) return viewOf(result.board);
    const retry =
      (result.reason === "duplicate-key" || result.reason === "key-in-use") &&
      attempt < DERIVED_KEY_TRIES;
    if (!retry) throw refusalFor(result, key, teamKeys);
    taken.add(key);
    key = nextFreeKey(name, taken);
  }
}

function nextFreeKey(name: string, taken: ReadonlySet<string>): BoardKey {
  const key = deriveBoardKey(name, taken);
  if (key === null) throw boardRefusal("no-free-key");
  return key;
}

async function writeBoard(
  key: BoardKey,
  name: string,
  input: NewBoardInput,
  folder: SessionsFolder,
): ReturnType<typeof store.createBoard> {
  const workspaceRoot =
    folder.kind === "given" ? folder.path : path.join(folder.root, key);
  const made =
    folder.kind === "default"
      ? await fsp.mkdir(workspaceRoot, { recursive: true })
      : undefined;
  const result = await store.createBoard({
    key,
    name,
    workspaceRoot,
    repositories: input.repositories,
    linearTeamKeys: input.linearTeamKeys,
  });
  if (!result.ok && made !== undefined) {
    await fsp.rmdir(workspaceRoot).catch(() => undefined);
  }
  return result;
}

function refusalFor(
  result: StoreRefusal,
  key: BoardKey,
  teamKeys: readonly string[] | null,
): BoardValidationError {
  switch (result.reason) {
    case "invalid-key":
    case "reserved-key":
      return boardRefusal(result.reason);
    case "duplicate-key":
      return duplicateKey(result.boardName, deriveFor(key, teamKeys));
    case "key-in-use":
      return linearTeamKey(key);
  }
}

/**
 * Create a board for an orchestrator, which may only name folders inside the home folder.
 *
 * @remarks A session folder or a repository outside the home folder answers the typed 403
 * `outside-home` before any other check, so an orchestrator cannot point a board at the system.
 */
export async function createBoardForOrchestrator(
  input: NewBoardInput,
  readTeamKeys?: LinearTeamKeyReader,
): Promise<Board> {
  const folders = [
    ...(input.workspaceRoot === undefined ? [] : [input.workspaceRoot]),
    ...input.repositories.map((repo) => repo.path),
  ];
  for (const folder of folders) {
    if (!(await isWithinHome(folder))) throw new ForbiddenError("outside-home");
  }
  return createBoard(input, readTeamKeys);
}

/** A repository entry of a board, with the default check command. */
export function repositoryEntry(
  path: string,
  baseBranch: string | null,
): BoardWorkspaceRepo {
  return { path, baseBranch, checkCommand: DEFAULT_CHECK_COMMAND };
}

function takenKeys(teamKeys: readonly string[] | null): Set<string> {
  return new Set([
    ...store.listBoards().map((b) => b.key),
    ...linearCardPrefixes(),
    ...(teamKeys ?? []),
  ]);
}

function deriveFor(
  key: string,
  teamKeys: readonly string[] | null,
): BoardKey | null {
  return deriveBoardKey(key, takenKeys(teamKeys));
}

function duplicateKey(
  boardName: string,
  suggestion: BoardKey | null,
): BoardValidationError {
  return new BoardValidationError(
    "duplicate-key",
    `Board ${boardName} uses this key.`,
    suggestion === null ? undefined : { suggestion },
  );
}

function assertTeamKeysFree(keys: readonly string[], board?: Board): void {
  for (const teamKey of keys) {
    if (board?.linearTeamKeys.includes(teamKey)) continue;
    const owner = store
      .listBoards()
      .find((other) => other.linearTeamKeys.includes(teamKey));
    if (owner) {
      throw new BoardValidationError(
        "team-key-taken",
        `Board ${owner.name} lists Linear team ${teamKey}.`,
      );
    }
  }
}

function linearTeamKey(key: string): BoardValidationError {
  return new BoardValidationError(
    "linear-team-key",
    `Linear team ${key} uses this key.`,
  );
}

/**
 * Change the name, sessions folder, repositories or Linear team keys of a board.
 *
 * @remarks Every check runs before the first write, so a refused request changes nothing. The
 * default board keeps its sessions folder in `Config` and its repositories in the global workspace
 * folders, so those two go there; its base branch and check command are dropped (D-1). An unchanged
 * default sessions folder is not checked, because it can be a fallback that is not created yet.
 */
export async function updateBoard(
  key: BoardKey,
  patch: BoardUpdateInput,
): Promise<Board> {
  const board = resolveBoard(key);
  const isDefault = key === DEFAULT_BOARD_KEY;
  const name = patch.name?.trim();
  if (name === "") throw boardRefusal("missing-name");
  const unchangedRoot =
    isDefault && patch.workspaceRoot === viewOf(board).workspaceRoot;
  if (patch.workspaceRoot !== undefined && !unchangedRoot) {
    await assertSessionsFolder(patch.workspaceRoot);
  }
  if (patch.repositories !== undefined) {
    await assertRepositories(key, patch.repositories);
  }
  if (patch.linearTeamKeys !== undefined) {
    assertTeamKeysFree(patch.linearTeamKeys, board);
  }

  if (isDefault) {
    if (patch.workspaceRoot !== undefined) {
      updateWorkspaceRoot(patch.workspaceRoot);
    }
    if (patch.repositories !== undefined) {
      await syncDefaultFolders(patch.repositories.map((repo) => repo.path));
    }
  }
  const updated = await store.updateBoard(key, {
    name,
    linearTeamKeys: patch.linearTeamKeys,
    workspaceRoot: patch.workspaceRoot,
    repositories: patch.repositories,
  });
  if (!updated) throw new BoardNotFoundError("unknown-board");
  return viewOf(updated);
}

async function syncDefaultFolders(paths: readonly string[]): Promise<void> {
  const wanted = new Set(paths);
  const current = [...store.getWorkspaceFolders(DEFAULT_BOARD_KEY).folders];
  for (const folder of current) {
    if (!wanted.has(folder)) {
      await store.removeWorkspaceFolder(DEFAULT_BOARD_KEY, folder);
    }
  }
  for (const folder of paths) {
    if (!current.includes(folder)) {
      await store.addWorkspaceFolder(DEFAULT_BOARD_KEY, folder);
    }
  }
}

/**
 * Archive a board.
 *
 * @remarks The default board answers the typed 409 `default-board`. A board with a card that has a
 * live or starting session answers the typed 409 `sessions-running` with the count.
 */
export async function archiveBoard(key: BoardKey): Promise<Board> {
  resolveBoard(key);
  if (key === DEFAULT_BOARD_KEY) throw new BoardConflictError("default-board");
  const running = activeSessionCount(key);
  if (running > 0) {
    throw new BoardConflictError(
      "sessions-running",
      `Stop the ${running} running ${running === 1 ? "session" : "sessions"} first.`,
      { running },
    );
  }
  return setArchived(key, true);
}

/** Restore an archived board; a board that is not archived stays as it is. */
export function restoreBoard(key: BoardKey): Promise<Board> {
  resolveBoard(key);
  return setArchived(key, false);
}

async function setArchived(key: BoardKey, archived: boolean): Promise<Board> {
  const result = await store.setBoardArchived(key, archived);
  if (result.ok) return viewOf(result.board);
  throw result.reason === "default-board"
    ? new BoardConflictError("default-board")
    : new BoardNotFoundError("unknown-board");
}
