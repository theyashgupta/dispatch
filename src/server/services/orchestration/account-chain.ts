import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type AccountApplyResult,
  type ChainAccountEntry,
  type ChainStateFile,
  type ClaudeAccountsSettings,
  type ClaudeUsageSnapshot,
} from "../../../shared/types.js";
import { SWITCH_NOW_REASON } from "../../../shared/account-chain.js";
import { ALL_BOARDS } from "../../../shared/board-key.js";
import { readClaudeIdentity } from "../../adapters/claude-cli.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  selectAccount,
  type ChainCandidate,
} from "../domain/account-selection.js";
import {
  deriveAccountState,
  isStaleSurface,
  isTokenReadFailed,
  parseSurfaceResetAt,
} from "../domain/account-state.js";
import {
  getClaudeAccountsSettings,
  updateClaudeAccountsSettings,
} from "../infra/config-holder.js";
import {
  emptyChainState,
  readChainState,
  writeChainState,
} from "./account-chain-state.js";
import { recordChainEvent, type ChainEvent } from "./account-chain-records.js";
import {
  accountDir,
  getActiveAccountId,
  readChainOrder,
  setActiveAccount,
} from "./claude-accounts.js";
import {
  getUsage,
  onUsageRefreshed,
  refreshUsage,
  usageBuckets,
} from "./claude-usage.js";
import {
  applyAutomaticMove,
  clearAutomaticPendingMoves,
} from "./session-account-apply.js";
import { continueAtLimit, sessionOf } from "./session-account-move.js";
import { liveTurnState, onLimitSignal } from "./session-turn.js";

const RESET_GRACE_MS = 2 * 60 * 1000;
const RECHECK_MS = 15 * 60 * 1000;
const MAX_TIMER_MS = 24 * 24 * 60 * 60 * 1000;
const SURFACE_CAP_MS = 5 * 60 * 60 * 1000;
const SCAN_MS = 30_000;
const EXHAUSTED_TIMER = "exhausted";

export interface ChainDeps {
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  refreshUsage: (id: string) => Promise<ClaudeUsageSnapshot>;
  cachedUsage: (id: string) => ClaudeUsageSnapshot;
  loggedIn: (id: string) => Promise<boolean>;
  emit: (event: ChainEvent) => void;
  scanMs: number;
}

export type FailoverResult =
  | { ok: true; to: string; moves: AccountApplyResult }
  | { ok: false; error: "no-eligible-account" };

const realDeps: ChainDeps = {
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms).unref(),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  refreshUsage,
  cachedUsage: getUsage,
  loggedIn: async (id) =>
    (
      await readClaudeIdentity(
        id === DEFAULT_CLAUDE_ACCOUNT_ID ? undefined : accountDir(id),
      )
    ).loggedIn,
  emit: (event) => {
    void recordChainEvent(event).catch((err: unknown) => {
      console.warn(`[account-chain] ${(err as Error).message}`);
    });
  },
  scanMs: SCAN_MS,
};

let deps = realDeps;
let chain: ChainStateFile = emptyChainState();
let running = false;
let listening = false;
let lastOffer: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
const timers = new Map<
  string,
  { handle: unknown; at: number; fire: () => void }
>();

/**
 * Run a controller task after every earlier one, so two failovers never overlap.
 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch((err: unknown) => {
    console.warn(`[account-chain] ${(err as Error).message}`);
  });
  return run;
}

/**
 * Mark the account in use as a manual pick, which ends the dwell and stops a boot return.
 *
 * @remarks Call it inside `runInChainQueue`; it does not queue itself.
 */
export async function noteManualSwitch(): Promise<void> {
  chain.inUseSince = null;
  await persist();
}

/**
 * Run a task in the controller queue, so it never overlaps a chain move.
 */
export function runInChainQueue<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(task);
}

/**
 * Resolve once every queued controller task has finished.
 *
 * @internal Tests use it to observe the controller.
 */
export async function whenChainIdle(): Promise<void> {
  let seen: Promise<unknown>;
  do {
    seen = queue;
    await seen;
  } while (seen !== queue);
}

/**
 * List the pending controller timers by key (`return:<id>` or `exhausted`) with their due time.
 *
 * @internal Tests use it to observe the controller.
 */
export function chainTimers(): { key: string; at: string }[] {
  return [...timers].map(([key, t]) => ({
    key,
    at: new Date(t.at).toISOString(),
  }));
}

const nowIso = (): string => new Date(deps.now()).toISOString();

const accountOf = (session: { claudeAccountId?: string }): string =>
  session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID;

function cancel(key: string): void {
  const timer = timers.get(key);
  if (timer === undefined) return;
  deps.clearTimer(timer.handle);
  timers.delete(key);
}

/**
 * Arm the timer `key` to run `task` in the queue at `at`, replacing any timer of that key.
 *
 * @remarks A delay is capped at 24 days, since `setTimeout` fires at once past 2^31 ms; an early
 * fire arms again. A task that throws runs again 15 minutes later unless it armed its own timer.
 */
function schedule(key: string, at: number, task: () => Promise<void>): void {
  cancel(key);
  const fire = (): void => {
    timers.delete(key);
    void enqueue(task).catch(() => {
      if (running && !timers.has(key)) {
        schedule(key, deps.now() + RECHECK_MS, task);
      }
    });
  };
  const handle = deps.setTimer(
    () => {
      if (deps.now() < at) schedule(key, at, task);
      else fire();
    },
    Math.min(Math.max(0, at - deps.now()), MAX_TIMER_MS),
  );
  timers.set(key, { handle, at, fire });
}

/**
 * Fire each timer whose wall clock time has passed.
 *
 * @remarks Node timers do not count the time a Mac sleeps, so the 30 s scan runs this watchdog.
 */
function fireOverdueTimers(): void {
  for (const [key, timer] of [...timers]) {
    if (timer.at > deps.now()) continue;
    deps.clearTimer(timer.handle);
    timers.delete(key);
    timer.fire();
  }
}

/**
 * Pick when to read a limited account again: its reset plus 2 minutes, else 15 minutes from now.
 */
function recheckAt(resetAt: string | null): number {
  const at = resetAt === null ? NaN : Date.parse(resetAt) + RESET_GRACE_MS;
  return at > deps.now() ? at : deps.now() + RECHECK_MS;
}

function scheduleReturn(id: string, at: number): void {
  schedule(`return:${id}`, at, () => checkReturn(id));
}

function scheduleExhausted(at: number): void {
  schedule(EXHAUSTED_TIMER, at, checkExhausted);
}

async function persist(): Promise<void> {
  await writeChainState(chain);
}

async function candidates(): Promise<ChainCandidate[]> {
  return (await readChainOrder()).map((id) => ({
    id,
    state: chain.accounts[id]?.state ?? "unknown",
    limitedUntil: chain.accounts[id]?.limitedUntil ?? null,
  }));
}

/**
 * Derive and store one account's chain state from a usage snapshot and an optional limit signal.
 *
 * @remarks A limited account stays limited until its `limitedUntil` passes, and its return timer
 * outlives any read that clears it, so only the timer returns the work.
 */
async function ingest(
  id: string,
  usage: ClaudeUsageSnapshot,
  limit?: { resetAt: string | null },
): Promise<ChainAccountEntry> {
  const now = deps.now();
  const loggedIn =
    !limit && isTokenReadFailed(usage) ? await deps.loggedIn(id) : null;
  const derived = deriveAccountState(
    usage,
    { loggedIn, ...(limit ? { limit } : {}) },
    getClaudeAccountsSettings().thresholdPercent,
    new Date(now),
  );
  const prior = chain.accounts[id];
  const held =
    prior?.state === "limited" &&
    derived.state !== "limited" &&
    derived.state !== "login-expired" &&
    prior.limitedUntil !== null &&
    Date.parse(prior.limitedUntil) > now;
  const entry: ChainAccountEntry = {
    ...(held
      ? { state: "limited", limitedUntil: prior.limitedUntil }
      : derived),
    buckets: usageBuckets(usage),
  };
  chain.accounts[id] = entry;
  if (prior?.state === "limited" && entry.state !== "limited") {
    lastOffer = null;
  }
  if (entry.state === "limited") {
    scheduleReturn(id, recheckAt(entry.limitedUntil));
  }
  await persist();
  return entry;
}

function inDwell(): boolean {
  const since = chain.inUseSince === null ? NaN : Date.parse(chain.inUseSince);
  const dwellMs = getClaudeAccountsSettings().minDwellMinutes * 60_000;
  return deps.now() - since < dwellMs;
}

/**
 * Emit an offer for a move that `autoMove` false holds back, once per pair of accounts.
 */
function offer(
  kind: "failover" | "return",
  from: string,
  to: string,
  reason: string,
): void {
  const key = `${kind}:${from}:${to}`;
  if (lastOffer === key) return;
  lastOffer = key;
  deps.emit({ kind, from, to, reason, moved: false, sessions: 0 });
}

/**
 * Move to `to` when `autoMove` is on, else offer the move once.
 */
async function moveOrOffer(
  kind: "failover" | "return",
  from: string,
  to: string,
  reason: string,
): Promise<void> {
  if (getClaudeAccountsSettings().autoMove) {
    await moveTo(to, kind, reason);
  } else offer(kind, from, to, reason);
}

async function clearExhausted(): Promise<void> {
  cancel(EXHAUSTED_TIMER);
  if (chain.exhausted === null) return;
  chain.exhausted = null;
  await persist();
}

async function markExhausted(
  from: string,
  earliestResetAt: string | null,
): Promise<void> {
  const first = chain.exhausted === null;
  chain.exhausted = {
    since: chain.exhausted?.since ?? nowIso(),
    earliestResetAt,
  };
  scheduleExhausted(recheckAt(earliestResetAt));
  await persist();
  if (first) deps.emit({ kind: "exhausted", from, earliestResetAt });
}

/**
 * Point the chain at `to`, start a new dwell and move the old account's sessions.
 */
async function moveTo(
  to: string,
  kind: "failover" | "return",
  reason: string,
): Promise<AccountApplyResult | null> {
  const from = getActiveAccountId();
  if (!(await setActiveAccount(to)).ok) return null;
  const at = nowIso();
  chain.inUseSince = at;
  chain.moves.push({ at, from, to, reason });
  lastOffer = null;
  cancel(EXHAUSTED_TIMER);
  chain.exhausted = null;
  let moves: AccountApplyResult | null = null;
  try {
    await persist();
    moves = await applyAutomaticMove(from, to);
    return moves;
  } finally {
    const sessions =
      moves === null ? null : moves.moved.length + moves.queued.length;
    deps.emit({ kind, from, to, reason, moved: true, sessions });
  }
}

/**
 * Leave the account in use for the selection result, or record the exhausted chain.
 */
async function failover(reason: string): Promise<void> {
  const from = getActiveAccountId();
  const selection = selectAccount(await candidates(), new Date(deps.now()));
  if (selection.exhausted) {
    await markExhausted(from, selection.earliestReset);
    return;
  }
  if (selection.id === from) return;
  await clearExhausted();
  await moveOrOffer("failover", from, selection.id, reason);
}

/**
 * Fail over from a limited account in use, unless the dwell holds a soft trigger back.
 */
async function onLimited(
  id: string,
  hard: boolean,
  reason: string,
): Promise<void> {
  if (id !== getActiveAccountId()) return;
  if (!hard && inDwell()) return;
  await failover(reason);
}

/**
 * Store one usage read and fail over when the account in use is at the threshold.
 */
export function handleUsageRead(
  id: string,
  usage: ClaudeUsageSnapshot,
): Promise<void> {
  return enqueue(async () => {
    const entry = await ingest(id, usage);
    if (entry.state === "limited") {
      await onLimited(id, false, "usage at the threshold");
    }
  });
}

/**
 * Read the reset a pane surface prints, capped at 5 hours from now.
 *
 * @remarks Pane text is not proof of a limit, so a printed time never holds an account longer than
 * one session window.
 */
function surfaceResetAt(pane: string): string | null {
  const at = parseSurfaceResetAt(pane, new Date(deps.now()));
  const cap = deps.now() + SURFACE_CAP_MS;
  return at !== null && Date.parse(at) > cap ? new Date(cap).toISOString() : at;
}

/**
 * Take one limit signal of a session into the chain.
 *
 * @remarks A pane surface is not proof of a limit, so it fails over only when a fresh read is at
 * the threshold or not ok; a rate limit `StopFailure` (`pane` null) needs no read.
 */
export function handleLimitSignal(
  cardId: string,
  sessionId: string,
  pane: string | null,
): Promise<void> {
  const session = sessionOf(cardId, sessionId);
  const id =
    session && session.claudeAccountStale !== true
      ? accountOf(session)
      : undefined;
  return enqueue(async () => {
    if (id === undefined || id !== getActiveAccountId()) return;
    const { thresholdPercent } = getClaudeAccountsSettings();
    let usage = deps.cachedUsage(id);
    if (pane !== null) {
      if (isStaleSurface(pane, usage, thresholdPercent, new Date(deps.now()))) {
        return;
      }
      usage = await deps.refreshUsage(id);
      if (
        usage.status === "ok" &&
        usage.windows.every((w) => w.percent < thresholdPercent)
      ) {
        return;
      }
    }
    if (chain.accounts[id]?.state !== "limited") {
      const resetAt = pane === null ? null : surfaceResetAt(pane);
      await ingest(id, usage, { resetAt });
    }
    await onLimited(
      id,
      true,
      pane === null ? "rate limit stop" : "limit surface",
    );
  });
}

/**
 * Read an account for a timer task, or `null` when the read is not ok or older than the task.
 */
async function freshRead(
  id: string,
  startedAt: number,
): Promise<ClaudeUsageSnapshot | null> {
  const usage = await deps.refreshUsage(id);
  const fetchedAt =
    usage.fetchedAt === null ? NaN : Date.parse(usage.fetchedAt);
  return usage.status === "ok" && fetchedAt >= startedAt ? usage : null;
}

/**
 * Re-read a limited account at its reset and return to it when it outranks the one in use.
 *
 * @remarks Only a fresh ok read counts. Any other read changes nothing, and it or a result of
 * `unknown` or `login-expired` checks again 15 minutes later.
 */
async function checkReturn(id: string): Promise<void> {
  const usage = await freshRead(id, deps.now());
  if (usage === null) {
    scheduleReturn(id, deps.now() + RECHECK_MS);
    return;
  }
  const entry = await ingest(id, usage);
  if (entry.state === "limited") return;
  if (entry.state === "login-expired" || entry.state === "unknown") {
    scheduleReturn(id, deps.now() + RECHECK_MS);
    return;
  }
  const inUse = getActiveAccountId();
  const order = await readChainOrder();
  const rank = order.indexOf(id);
  if (id === inUse || rank < 0 || rank > order.indexOf(inUse)) return;
  await moveOrOffer("return", inUse, id, "reset");
}

/**
 * Re-read every account at the earliest reset of an exhausted chain.
 *
 * @remarks Only fresh ok reads update an account, and when the selected account has none the check
 * runs again 15 minutes later. Otherwise it moves on, or sends `Continue.` to each session of the
 * account in use that still shows a surface 2 minutes after the reset.
 */
async function checkExhausted(): Promise<void> {
  const startedAt = deps.now();
  const fresh = new Set<string>();
  for (const id of await readChainOrder()) {
    const usage = await freshRead(id, startedAt);
    if (usage === null) continue;
    await ingest(id, usage);
    fresh.add(id);
  }
  const inUse = getActiveAccountId();
  const selection = selectAccount(await candidates(), new Date(deps.now()));
  if (selection.exhausted) {
    await markExhausted(inUse, selection.earliestReset);
    return;
  }
  if (!fresh.has(selection.id)) {
    scheduleExhausted(deps.now() + RECHECK_MS);
    return;
  }
  await clearExhausted();
  if (selection.id !== inUse) {
    await moveOrOffer("failover", inUse, selection.id, "reset");
    return;
  }
  for (const { card, session } of store.sessionsWithTmux(ALL_BOARDS)) {
    if (accountOf(session) === inUse)
      await continueAtLimit(card.id, session.id);
  }
}

/**
 * Store new chain settings and, when `autoMove` turns off, drop the moves the chain queued.
 *
 * @remarks The drop runs in the queue, so a chain move in flight queues its moves first.
 */
export async function updateChainSettings(
  patch: Partial<ClaudeAccountsSettings>,
): Promise<void> {
  const wasAuto = getClaudeAccountsSettings().autoMove;
  updateClaudeAccountsSettings(patch);
  if (wasAuto && !getClaudeAccountsSettings().autoMove) {
    await enqueue(clearAutomaticPendingMoves);
  }
}

/**
 * Drop a removed account's chain entry and its return timer.
 */
export function forgetChainAccount(id: string): Promise<void> {
  return enqueue(async () => {
    cancel(`return:${id}`);
    if (chain.accounts[id] === undefined) return;
    delete chain.accounts[id];
    await persist();
  });
}

/**
 * Move the account in use's sessions to the best other qualifying account now.
 *
 * @remarks Backs "Switch now" (LOCAL-89), whatever `autoMove` says. The dwell does not block it
 * and it starts a new dwell; pinned sessions stay.
 */
export function requestFailover(reason: string): Promise<FailoverResult> {
  return enqueue(async (): Promise<FailoverResult> => {
    const from = getActiveAccountId();
    const others = (await candidates()).filter((c) => c.id !== from);
    const selection = selectAccount(others, new Date(deps.now()));
    if (selection.exhausted) return { ok: false, error: "no-eligible-account" };
    const moves = await moveTo(selection.id, "failover", reason);
    if (moves === null) return { ok: false, error: "no-eligible-account" };
    return { ok: true, to: selection.id, moves };
  });
}

/**
 * Check each pane on the account in use, so a limit surface signals without hooks.
 */
async function scanInUseSessions(): Promise<void> {
  const inUse = getActiveAccountId();
  for (const { card, session } of store.sessionsWithTmux(ALL_BOARDS)) {
    if (accountOf(session) !== inUse) continue;
    await liveTurnState(card.id, session.id, session.tmuxSession);
  }
}

/**
 * Start the chain controller and return a function that stops it.
 *
 * @remarks `overrides` replace the clock, timers, usage reader and event sink in tests.
 * @see docs/ARCHITECTURE.md#account-chain
 */
export async function startAccountChain(
  overrides: Partial<ChainDeps> = {},
): Promise<() => void> {
  for (const key of [...timers.keys()]) cancel(key);
  deps = { ...realDeps, ...overrides };
  chain = await readChainState();
  lastOffer = null;
  if (!listening) {
    listening = true;
    onUsageRefreshed((id, usage) => {
      if (running) void handleUsageRead(id, usage).catch(() => undefined);
    });
    onLimitSignal((cardId, sessionId, pane) => {
      if (running) {
        void handleLimitSignal(cardId, sessionId, pane).catch(() => undefined);
      }
    });
  }
  const bootAt = (resetAt: string | null): number =>
    resetAt === null
      ? deps.now() + RECHECK_MS
      : Date.parse(resetAt) + RESET_GRACE_MS;
  for (const [id, entry] of Object.entries(chain.accounts)) {
    if (entry.state === "limited") {
      scheduleReturn(id, bootAt(entry.limitedUntil));
    }
  }
  const last = chain.moves.at(-1);
  const left =
    last?.to === getActiveAccountId() &&
    last.at === chain.inUseSince &&
    last.reason !== SWITCH_NOW_REASON
      ? last.from
      : undefined;
  if (left !== undefined && chain.accounts[left]?.state !== "limited") {
    scheduleReturn(left, deps.now());
  }
  if (chain.exhausted !== null) {
    scheduleExhausted(bootAt(chain.exhausted.earliestResetAt));
  }
  running = true;
  let scanning = false;
  const scan =
    deps.scanMs > 0
      ? setInterval(() => {
          fireOverdueTimers();
          if (scanning) return;
          scanning = true;
          void scanInUseSessions()
            .catch(() => undefined)
            .finally(() => {
              scanning = false;
            });
        }, deps.scanMs).unref()
      : undefined;
  return () => {
    running = false;
    clearInterval(scan);
    for (const key of [...timers.keys()]) cancel(key);
  };
}
