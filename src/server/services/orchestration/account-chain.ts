import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type AccountApplyResult,
  type ChainAccountEntry,
  type ChainStateFile,
  type ClaudeAccountsSettings,
  type ClaudeUsageSnapshot,
  type DecisionItem,
} from "../../../shared/types.js";
import { SWITCH_NOW_REASON } from "../../../shared/account-chain.js";
import { ALL_BOARDS } from "../../../shared/board-key.js";
import { readClaudeIdentity } from "../../adapters/claude-cli.js";
import type { UsageCaller } from "../../adapters/usage-request-log.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  filterByHysteresis,
  passesHysteresis,
  selectAccount,
  type BucketedCandidate,
} from "../domain/account-selection.js";
import {
  chainStateOf,
  deriveAccountState,
  isShadowOfHome,
  isStaleSurface,
  isTokenReadFailed,
  NEEDS_LOGIN_READS,
  nextRejectedReads,
  parseSurfaceResetAt,
  showsNewPeriod,
} from "../domain/account-state.js";
import { shouldWarnLoginExpiry } from "../domain/login-expiry.js";
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
  closeAccountDecision,
  raiseExhaustedDecision as raiseAccountExhaustedDecision,
  raiseLoginDecision as raiseAccountLoginDecision,
} from "./account-decisions.js";
import {
  accountDir,
  getActiveAccountId,
  readChainOrder,
  getManagedDefaultId,
  readDefaultIdentity,
  readRegistry,
  setActiveAccount,
  type DefaultIdentity,
} from "./claude-accounts.js";
import { startLogin } from "./claude-login.js";
import {
  getUsage,
  onUsageRefreshed,
  refreshUsage,
  usageBuckets,
} from "./claude-usage.js";
import { onDecisionAnswered } from "./decision-items.js";
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
const NEEDS_LOGIN_CAUSE = "needs-login:";
const EXHAUSTED_CAUSE = "exhausted";

export interface ChainDeps {
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  refreshUsage: (
    id: string,
    caller?: UsageCaller,
  ) => Promise<ClaudeUsageSnapshot>;
  cachedUsage: (id: string) => ClaudeUsageSnapshot;
  loggedIn: (id: string) => Promise<boolean>;
  emit: (event: ChainEvent) => void;
  startLogin: (accountId?: string) => Promise<{ ok: boolean; error?: string }>;
  raiseLoginDecision: (accountId: string) => Promise<string>;
  raiseExhaustedDecision: (earliestResetAt: string | null) => Promise<string>;
  closeDecision: (decisionId: string, optionId: string, note: string) => void;
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
    void recordChainEvent(event).catch(warnChain);
  },
  startLogin,
  raiseLoginDecision: async (id) => {
    const email =
      id === DEFAULT_CLAUDE_ACCOUNT_ID
        ? (await readDefaultIdentity())?.email
        : (await readRegistry()).find((a) => a.id === id)?.email;
    return raiseAccountLoginDecision(
      id,
      email ?? id,
      id === DEFAULT_CLAUDE_ACCOUNT_ID,
    );
  },
  raiseExhaustedDecision: (earliestResetAt) =>
    Promise.resolve(raiseAccountExhaustedDecision(earliestResetAt)),
  closeDecision: closeAccountDecision,
  scanMs: SCAN_MS,
};

let deps = realDeps;
let chain: ChainStateFile = emptyChainState();
let running = false;
let listening = false;
let lastOffer: string | null = null;
let home: DefaultIdentity | undefined;
const shadowed = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();
const timers = new Map<
  string,
  { handle: unknown; at: number; fire: () => void }
>();

/**
 * Log a controller failure without throwing.
 */
function warnChain(err: unknown): void {
  console.warn(`[account-chain] ${(err as Error).message}`);
}

/**
 * Run a controller task after every earlier one, so two failovers never overlap.
 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(warnChain);
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
 * @public The account chain specs are the callers.
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
 * @public The account chain specs are the callers.
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

/**
 * Arm the return check of a limited account.
 *
 * @remarks The timer outlives a clear of the limit, so only the timer returns the work.
 */
function scheduleReturn(id: string, at: number): void {
  schedule(`return:${id}`, at, () => checkReturn(id));
}

function scheduleExhausted(at: number): void {
  schedule(EXHAUSTED_TIMER, at, checkExhausted);
}

async function persist(): Promise<void> {
  await writeChainState(chain);
}

/** Read the chain accounts in position order with their stored state and buckets. */
export async function limitMoveCandidates(): Promise<BucketedCandidate[]> {
  return (await readChainOrder()).map((id) => ({
    id,
    state: chain.accounts[id]?.state ?? "unknown",
    limitedUntil: chain.accounts[id]?.limitedUntil ?? null,
    buckets: chain.accounts[id]?.buckets ?? [],
  }));
}

/**
 * Answer the decision stored for `cause` and drop its id.
 *
 * @remarks The id is dropped also when the close fails, so a later cause of the same kind can raise
 * a new decision.
 */
function closeCause(cause: string, optionId: string, note: string): void {
  const stored = chain.decisions[cause];
  if (stored === undefined) return;
  delete chain.decisions[cause];
  try {
    deps.closeDecision(stored, optionId, note);
  } catch (err) {
    warnChain(err);
  }
}

/**
 * Raise the login decision of an account that needs a login, or close it once the account recovered.
 *
 * @remarks The decision id is stored per cause, so a restart or a later rejected read never raises a
 * second one.
 */
async function syncLoginDecision(
  id: string,
  state: ChainAccountEntry["state"],
): Promise<void> {
  const cause = `${NEEDS_LOGIN_CAUSE}${id}`;
  const stored = chain.decisions[cause];
  try {
    if (state === "needs-login" && stored === undefined) {
      chain.decisions[cause] = await deps.raiseLoginDecision(id);
    } else if (state !== "needs-login") {
      closeCause(cause, "later", "The account returned to the chain.");
    }
  } catch (err) {
    warnChain(err);
  }
}

/**
 * Copy an entry with a new state, keeping its buckets and read time and dropping the hold.
 */
function entryWithState(
  prior: ChainAccountEntry | undefined,
  state: ChainAccountEntry["state"],
): ChainAccountEntry {
  return {
    state,
    limitedUntil: null,
    buckets: prior?.buckets ?? [],
    ...(prior?.fetchedAt !== undefined ? { fetchedAt: prior.fetchedAt } : {}),
  };
}

/**
 * Recompute which registry accounts hold the home login and move their chain entries to match.
 *
 * @remarks Call it inside the queue. A newly shadowed account gets `shadowed-by-home`, loses its
 * return timer and closes an open login decision; an account that stopped matching goes back to
 * `unknown`, so the next read derives its state.
 */
async function refreshShadows(): Promise<void> {
  const active = getActiveAccountId();
  const registry = await readRegistry();
  const homeLogin = getManagedDefaultId() === undefined ? home : undefined;
  const next = new Set(
    registry
      .filter(
        (record) => record.id !== active && isShadowOfHome(record, homeLogin),
      )
      .map((record) => record.id),
  );
  let changed = false;
  for (const id of next) {
    if (shadowed.has(id)) continue;
    shadowed.add(id);
    changed = true;
    chain.accounts[id] = entryWithState(chain.accounts[id], "shadowed-by-home");
    cancel(`return:${id}`);
    await syncLoginDecision(id, "shadowed-by-home");
  }
  for (const id of [...shadowed]) {
    if (next.has(id)) continue;
    shadowed.delete(id);
    changed = true;
    if (!registry.some((record) => record.id === id)) {
      delete chain.accounts[id];
    } else if (chain.accounts[id] !== undefined) {
      chain.accounts[id] = entryWithState(chain.accounts[id], "unknown");
    }
  }
  if (changed) await persist();
}

/**
 * Take the home login in and shadow each registry account that holds the same login.
 *
 * @remarks Before the chain starts it only stores the identity, since the boot reads it itself. A
 * failure is logged by the queue and never reaches the caller, so the identity watch keeps going.
 */
export function noteHomeIdentity(
  identity: DefaultIdentity | undefined,
): Promise<void> {
  return enqueue(async () => {
    home = identity;
    if (running) await refreshShadows();
  }).catch(() => undefined);
}

/**
 * Derive and store one account's chain state from a usage snapshot and an optional limit signal.
 *
 * @remarks Two consecutive `token-rejected` reads give `needs-login`, and a limit signal never counts
 * as a read because it reuses a cached snapshot. A not ok or empty read keeps a limited account held
 * until `limitedUntil` unless it shows a new period. An account that holds the home login stays
 * `shadowed-by-home` over every other state.
 */
async function ingest(
  id: string,
  usage: ClaudeUsageSnapshot,
  limit?: { resetAt: string | null },
): Promise<ChainAccountEntry> {
  const now = deps.now();
  const isShadow = shadowed.has(id);
  const loggedIn =
    !limit && !isShadow && isTokenReadFailed(usage)
      ? await deps.loggedIn(id)
      : null;
  const { thresholdPercent } = getClaudeAccountsSettings();
  const derived = deriveAccountState(
    usage,
    { loggedIn, ...(limit ? { limit } : {}) },
    thresholdPercent,
    new Date(now),
  );
  const prior = chain.accounts[id];
  const rejectedReads = isShadow
    ? 0
    : limit
      ? (prior?.rejectedReads ?? 0)
      : nextRejectedReads(prior?.rejectedReads, usage);
  const needsLogin = rejectedReads >= NEEDS_LOGIN_READS;
  const held =
    !needsLogin &&
    (usage.status !== "ok" || usage.windows.length === 0) &&
    prior?.state === "limited" &&
    derived.state !== "limited" &&
    derived.state !== "login-expired" &&
    prior.limitedUntil !== null &&
    Date.parse(prior.limitedUntil) > now &&
    !showsNewPeriod(usage, prior, thresholdPercent);
  const entry: ChainAccountEntry = {
    ...chainStateOf({
      shadowed: isShadow,
      needsLogin,
      held,
      heldUntil: prior?.limitedUntil ?? null,
      derived,
    }),
    buckets: usageBuckets(usage),
    fetchedAt: usage.fetchedAt,
    ...(rejectedReads > 0 ? { rejectedReads } : {}),
  };
  chain.accounts[id] = entry;
  if (prior?.state === "limited" && entry.state !== "limited") {
    lastOffer = null;
  }
  if (entry.state === "limited") {
    scheduleReturn(id, recheckAt(entry.limitedUntil));
  } else if (entry.state === "needs-login") {
    cancel(`return:${id}`);
  }
  await syncLoginDecision(id, entry.state);
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
  closeCause(EXHAUSTED_CAUSE, "wait", "An account is usable again.");
  await persist();
}

/**
 * Record the exhausted chain and raise the one board decision for it.
 *
 * @remarks The decision is raised when none is stored, which also covers a chain file written
 * before the decision existed. A failure keeps the id absent, so the next check tries again.
 */
async function markExhausted(
  from: string,
  earliestResetAt: string | null,
): Promise<void> {
  const first = chain.exhausted === null;
  chain.exhausted = {
    since: chain.exhausted?.since ?? nowIso(),
    earliestResetAt,
  };
  if (chain.decisions[EXHAUSTED_CAUSE] === undefined) {
    try {
      chain.decisions[EXHAUSTED_CAUSE] =
        await deps.raiseExhaustedDecision(earliestResetAt);
    } catch (err) {
      warnChain(err);
    }
  }
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
  closeCause(EXHAUSTED_CAUSE, "wait", "An account is usable again.");
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
 *
 * @remarks With `hysteresis` the pick is limited to accounts below the hysteresis line. When none
 * passes, the sessions stay unless the unfiltered chain is exhausted too.
 */
async function failover(reason: string, hysteresis = false): Promise<void> {
  const from = getActiveAccountId();
  const now = new Date(deps.now());
  const all = await limitMoveCandidates();
  const { thresholdPercent, hysteresisPercent } = getClaudeAccountsSettings();
  const selection = selectAccount(
    hysteresis
      ? filterByHysteresis(all, thresholdPercent, hysteresisPercent)
      : all,
    now,
  );
  if (selection.exhausted) {
    const fallback = hysteresis ? selectAccount(all, now) : selection;
    if (fallback.exhausted) await markExhausted(from, fallback.earliestReset);
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
  await failover(reason, !hard);
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
    const expiresAt = usage.loginExpiresAt;
    if (
      expiresAt !== undefined &&
      shouldWarnLoginExpiry(
        expiresAt,
        chain.loginExpiryNotified[id],
        deps.now(),
      )
    ) {
      chain.loginExpiryNotified = {
        ...chain.loginExpiryNotified,
        [id]: expiresAt,
      };
      await persist();
      deps.emit({ kind: "login-expiring", account: id, expiresAt });
    }
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
      usage = await deps.refreshUsage(id, "limit-surface");
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
  const usage = await deps.refreshUsage(id, "fresh-read");
  const fetchedAt =
    usage.fetchedAt === null ? NaN : Date.parse(usage.fetchedAt);
  return usage.status === "ok" && fetchedAt >= startedAt ? usage : null;
}

/**
 * Re-read a limited account at its reset and return to it when it outranks the one in use.
 *
 * @remarks Only a fresh ok read counts. Any other read changes nothing, and it or a result of
 * `unknown` or `login-expired` checks again 15 minutes later. An account that holds the home login
 * is never read or returned to.
 */
async function checkReturn(id: string): Promise<void> {
  if (shadowed.has(id)) return;
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
  const { thresholdPercent, hysteresisPercent } = getClaudeAccountsSettings();
  if (
    !passesHysteresis(
      entry.buckets,
      entry.state,
      thresholdPercent,
      hysteresisPercent,
    )
  ) {
    scheduleReturn(id, deps.now() + RECHECK_MS);
    return;
  }
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
  const selection = selectAccount(
    await limitMoveCandidates(),
    new Date(deps.now()),
  );
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
    shadowed.delete(id);
    const hadNotice = id in chain.loginExpiryNotified;
    const cause = `${NEEDS_LOGIN_CAUSE}${id}`;
    if (
      chain.accounts[id] === undefined &&
      !hadNotice &&
      chain.decisions[cause] === undefined
    ) {
      return;
    }
    closeCause(cause, "later", "The account was removed.");
    delete chain.accounts[id];
    delete chain.loginExpiryNotified[id];
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
    const others = (await limitMoveCandidates()).filter((c) => c.id !== from);
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
 * Start the login of a needs-login account when its decision is answered with `login`.
 */
function handleDecisionAnswered(item: DecisionItem): void {
  if (!running) return;
  const cause = Object.keys(chain.decisions).find(
    (key) => chain.decisions[key] === item.id,
  );
  if (
    !cause?.startsWith(NEEDS_LOGIN_CAUSE) ||
    item.answer?.optionId !== "login"
  ) {
    return;
  }
  const accountId = cause.slice(NEEDS_LOGIN_CAUSE.length);
  void deps.startLogin(accountId).then((result) => {
    if (!result.ok) {
      console.warn(
        `[account-chain] login for ${accountId} did not start: ${result.error}`,
      );
    }
  }, warnChain);
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
  home = await readDefaultIdentity().catch(() => undefined);
  shadowed.clear();
  for (const [id, entry] of Object.entries(chain.accounts)) {
    if (entry.state === "shadowed-by-home") shadowed.add(id);
  }
  await enqueue(refreshShadows).catch(() => undefined);
  if (!listening) {
    listening = true;
    onUsageRefreshed((id, usage) => {
      if (running) void handleUsageRead(id, usage).catch(() => undefined);
    });
    onDecisionAnswered(handleDecisionAnswered);
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
