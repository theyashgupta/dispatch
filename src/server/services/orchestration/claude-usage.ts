import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type ChainBucket,
  type ClaudeUsageSnapshot,
} from "../../../shared/types.js";
import {
  fetchUsage,
  mapUsageResponse,
  readCredential,
  type UsageFetchResult,
} from "../../adapters/claude-usage.js";
import {
  appendUsageRequest,
  type UsageCaller,
} from "../../adapters/usage-request-log.js";
import {
  bindingPercent,
  INITIAL_POLL_STATE,
  IN_USE_CEILING,
  POST_429_WINDOW,
  planNextPoll,
  type PollResult,
  type PollState,
} from "../domain/usage-poll-plan.js";
import { getClaudeAccountsSettings } from "../infra/config-holder.js";
import { CLAUDE_HOME_DIR } from "../infra/paths.js";
import {
  accountDir,
  getActiveAccountId,
  keychainServiceName,
  getManagedDefaultId,
  readRegistry,
} from "./claude-accounts.js";

const TICK_MS = 15_000;
const MANUAL_MIN_GAP_MS = 30 * 1000;
const USER_AGENT = "claude-code/2.1.0";

const cache = new Map<string, ClaudeUsageSnapshot>();
const holdUntil = new Map<string, number>();
const pollState = new Map<string, PollState>();
const nextDueAt = new Map<string, number>();
const lastManualAt = new Map<string, number>();
const inFlight = new Map<string, Promise<ClaudeUsageSnapshot>>();
let ticking = false;
let lastActiveId: string | null = null;

const EMPTY: ClaudeUsageSnapshot = {
  status: "unavailable",
  windows: [],
  fetchedAt: null,
};

/**
 * The cached usage for an account, an empty `unavailable` snapshot before the first fetch.
 */
export function getUsage(id: string): ClaudeUsageSnapshot {
  return cache.get(id) ?? EMPTY;
}

/**
 * Return the usage windows of a snapshot as chain buckets, keeping only kind, percent and reset.
 */
export function usageBuckets(usage: ClaudeUsageSnapshot): ChainBucket[] {
  return usage.windows.map(({ kind, percent, resetsAt }) => ({
    kind,
    percent,
    resetsAt,
  }));
}

/**
 * Merge a patch into an account's cached snapshot and return the result.
 *
 * @remarks For `loginExpiresAt`, `null` clears the stored value and `undefined` keeps it.
 */
function mergeSnapshot(
  id: string,
  patch: Omit<Partial<ClaudeUsageSnapshot>, "loginExpiresAt"> & {
    loginExpiresAt?: string | null;
  },
): ClaudeUsageSnapshot {
  const prior = cache.get(id) ?? EMPTY;
  const next: ClaudeUsageSnapshot = {
    status: patch.status ?? prior.status,
    windows: patch.windows ?? prior.windows,
    fetchedAt: patch.fetchedAt ?? prior.fetchedAt,
  };
  if (patch.error !== undefined) next.error = patch.error;
  const loginExpiresAt =
    patch.loginExpiresAt === undefined
      ? prior.loginExpiresAt
      : patch.loginExpiresAt;
  if (loginExpiresAt) next.loginExpiresAt = loginExpiresAt;
  cache.set(id, next);
  return next;
}

type UsageListener = (id: string, snapshot: ClaudeUsageSnapshot) => void;

const refreshListeners: UsageListener[] = [];

/**
 * Register a listener that runs after every usage refresh of any account, whatever its result.
 *
 * @remarks A listener must not throw; it is called outside any try block.
 */
export function onUsageRefreshed(listener: UsageListener): void {
  refreshListeners.push(listener);
}

/**
 * Register a listener that runs after every refresh of the Default account, whatever its result.
 *
 * @remarks A listener must not throw; it is called outside any try block.
 */
export function onDefaultUsageRefreshed(listener: () => void): void {
  onUsageRefreshed((id) => {
    if (id === DEFAULT_CLAUDE_ACCOUNT_ID) listener();
  });
}

function isHeld(id: string, now: number): boolean {
  return (holdUntil.get(id) ?? 0) > now;
}

function timeScale(): number {
  const s = Number(process.env.DISPATCH_USAGE_TIME_SCALE);
  return Number.isFinite(s) && s >= 1 ? s : 1;
}

function earliestFutureReset(
  windows: ClaudeUsageSnapshot["windows"],
  now: number,
): number | null {
  const times = windows
    .map((w) => (w.resetsAt === null ? NaN : Date.parse(w.resetsAt)))
    .filter((t) => t > now);
  return times.length > 0 ? Math.min(...times) : null;
}

function replan(id: string, result: PollResult, now: number): number {
  const plan = planNextPoll(pollState.get(id) ?? INITIAL_POLL_STATE, {
    now,
    inUse: id === getActiveAccountId(),
    thresholdPercent: getClaudeAccountsSettings().thresholdPercent,
    result,
    random: Math.random,
    scale: timeScale(),
  });
  pollState.set(id, plan.state);
  nextDueAt.set(id, plan.nextDueAt);
  if (plan.holdUntil === null) holdUntil.delete(id);
  else holdUntil.set(id, plan.holdUntil);
  return plan.nextDueAt;
}

function replanAndLog(
  id: string,
  caller: UsageCaller,
  status: number | "network",
  result: PollResult,
): void {
  const now = Date.now();
  const due = replan(id, result, now);
  appendUsageRequest({
    ts: new Date(now).toISOString(),
    account: id,
    caller,
    status,
    nextInMs: due - now,
  });
}

/**
 * Fetch one account's usage now, re-plan its next read and log the request.
 *
 * @remarks Inside a hold it returns the cached snapshot with no request, listener call or log line,
 * and a call during a read of the same account shares that read. A 401 or 403 marks the last
 * windows stale, a 429 holds the account and a network failure keeps them as `error`. The token
 * lives only inside this call.
 */
export async function refreshUsage(
  id: string,
  caller: UsageCaller = "poll",
): Promise<ClaudeUsageSnapshot> {
  if (isHeld(id, Date.now())) return getUsage(id);
  const pending = inFlight.get(id);
  if (pending) return pending;
  const read = fetchAccountUsage(id, caller).finally(() => {
    inFlight.delete(id);
  });
  inFlight.set(id, read);
  const snapshot = await read;
  for (const listener of refreshListeners) listener(id, snapshot);
  return snapshot;
}

/**
 * Tell whether a 401 comes from an access token that only aged out while its refresh token lives.
 *
 * @remarks An idle account's access token lives 8 hours and only a CLI launch renews it, so such a
 * rejection is not a sign of a dead login.
 */
function isIdleExpiry(
  accessExpiresAt: number | undefined,
  loginExpiresAt: string | null,
): boolean {
  if (accessExpiresAt === undefined || accessExpiresAt > Date.now()) {
    return false;
  }
  return loginExpiresAt === null || Date.parse(loginExpiresAt) > Date.now();
}

async function fetchAccountUsage(
  id: string,
  caller: UsageCaller,
): Promise<ClaudeUsageSnapshot> {
  const isDefault = id === DEFAULT_CLAUDE_ACCOUNT_ID;
  const dir = isDefault ? CLAUDE_HOME_DIR : accountDir(id);
  const credential = await readCredential(
    keychainServiceName(isDefault ? undefined : dir),
    dir,
  );
  if (!credential) {
    replan(id, { kind: "rejected" }, Date.now());
    return mergeSnapshot(id, {
      status: "unavailable",
      windows: [],
      error: "no-token",
      loginExpiresAt: null,
    });
  }
  const { token, loginExpiresAt, accessExpiresAt } = credential;
  let result: UsageFetchResult;
  try {
    result = await fetchUsage(token, USER_AGENT);
  } catch {
    replanAndLog(id, caller, "network", { kind: "failed" });
    return mergeSnapshot(id, {
      status: "error",
      error: "unreachable",
      loginExpiresAt,
    });
  }
  const now = new Date().toISOString();
  if (result.status === 200) {
    let windows: ClaudeUsageSnapshot["windows"];
    try {
      windows = mapUsageResponse(result.body);
    } catch {
      replanAndLog(id, caller, 200, { kind: "failed" });
      return mergeSnapshot(id, {
        status: "error",
        error: "bad-response",
        loginExpiresAt,
      });
    }
    replanAndLog(id, caller, 200, {
      kind: "ok",
      bindingPercent: bindingPercent(windows),
      nextResetAt: earliestFutureReset(windows, Date.now()),
    });
    return mergeSnapshot(id, {
      status: "ok",
      windows,
      fetchedAt: now,
      error: undefined,
      loginExpiresAt,
    });
  }
  if (result.status === 429) {
    replanAndLog(id, caller, 429, {
      kind: "rate-limited",
      retryAfterMs: result.retryAfterMs ?? null,
    });
    return mergeSnapshot(id, {
      status: "rate-limited",
      error: "rate-limited",
      loginExpiresAt,
    });
  }
  if (result.status === 401 || result.status === 403) {
    replanAndLog(id, caller, result.status, { kind: "rejected" });
    return mergeSnapshot(id, {
      status: "stale",
      error: isIdleExpiry(accessExpiresAt, loginExpiresAt)
        ? "token-expired"
        : "token-rejected",
      loginExpiresAt,
    });
  }
  replanAndLog(id, caller, result.status, { kind: "failed" });
  return mergeSnapshot(id, {
    status: "error",
    error: `http-${result.status}`,
    loginExpiresAt,
  });
}

/**
 * A user-triggered refresh, limited to one call per account per 30 seconds and refused inside a
 * hold.
 *
 * @remarks The 30 second gap is real time and `DISPATCH_USAGE_TIME_SCALE` does not scale it.
 */
export async function refreshUsageManually(
  id: string,
): Promise<
  { ok: true; usage: ClaudeUsageSnapshot } | { ok: false; error: "too-soon" }
> {
  const last = lastManualAt.get(id) ?? 0;
  if (Date.now() - last < MANUAL_MIN_GAP_MS || isHeld(id, Date.now())) {
    return { ok: false, error: "too-soon" };
  }
  lastManualAt.set(id, Date.now());
  return { ok: true, usage: await refreshUsage(id, "manual") };
}

async function pollableIds(): Promise<string[]> {
  let ids: string[] =
    getManagedDefaultId() === undefined ? [DEFAULT_CLAUDE_ACCOUNT_ID] : [];
  try {
    ids = ids.concat((await readRegistry()).map((a) => a.id));
  } catch {}
  return ids;
}

/**
 * Plan the account that just became active to be read within 300 seconds.
 *
 * @remarks An account inside its post-429 hour or inside a hold keeps its plan.
 */
function pullActiveForward(now: number): void {
  const active = getActiveAccountId();
  const previous = lastActiveId;
  lastActiveId = active;
  if (previous === null || previous === active) return;
  const last429At = pollState.get(active)?.last429At ?? null;
  const inSlowHour =
    last429At !== null &&
    now - last429At < (POST_429_WINDOW * 1000) / timeScale();
  if (inSlowHour || isHeld(active, now)) return;
  nextDueAt.set(
    active,
    Math.min(
      nextDueAt.get(active) ?? now,
      now + (IN_USE_CEILING * 1000) / timeScale(),
    ),
  );
}

/**
 * Refresh, one after another, every account that is due and not held.
 *
 * @remarks An account with no planned time is due, and a held account is skipped by
 * `refreshUsage`. Errors never escape.
 */
export async function runUsageTick(now = Date.now()): Promise<void> {
  pullActiveForward(now);
  for (const id of await pollableIds()) {
    const due = nextDueAt.get(id);
    if (due !== undefined && due > now) continue;
    await refreshUsage(id, "poll").catch(() => undefined);
  }
}

/**
 * Read every account at boot, then every 15 seconds read the accounts that are due.
 *
 * @remarks Each read re-plans its account, so the planned time and not the tick sets the cadence.
 * Ticks never overlap, the boot read included. `DISPATCH_USAGE_TIME_SCALE` divides the tick and
 * every planned interval, for tests.
 */
export function startUsagePollLoop(): () => void {
  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      await runUsageTick();
    } finally {
      ticking = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), TICK_MS / timeScale());
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Return the planned timing of an account.
 *
 * @public The usage plan specs are the callers.
 */
export function getUsagePlan(id: string): {
  nextDueAt: number | null;
  holdUntil: number | null;
  intervalMs: number | null;
} {
  return {
    nextDueAt: nextDueAt.get(id) ?? null,
    holdUntil: holdUntil.get(id) ?? null,
    intervalMs: pollState.get(id)?.intervalMs ?? null,
  };
}

/**
 * Drop a removed account's cached usage and limiter state.
 */
export function forgetUsage(id: string): void {
  cache.delete(id);
  holdUntil.delete(id);
  pollState.delete(id);
  nextDueAt.delete(id);
  lastManualAt.delete(id);
  inFlight.delete(id);
}
