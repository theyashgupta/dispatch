import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type ClaudeUsageSnapshot,
} from "../../../shared/types.js";
import {
  fetchUsage,
  mapUsageResponse,
  readAccessToken,
  type UsageFetchResult,
} from "../../adapters/claude-usage.js";
import { CLAUDE_HOME_DIR } from "../infra/paths.js";
import {
  accountDir,
  keychainServiceName,
  readRegistry,
} from "../domain/claude-accounts.js";

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const MANUAL_MIN_GAP_MS = 30 * 1000;
const RETRY_AFTER_CAP_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_DEFAULT_MS = 5 * 60 * 1000;
const USER_AGENT = "claude-code/2.1.0";

const cache = new Map<string, ClaudeUsageSnapshot>();
const retryAt = new Map<string, number>();
const lastManualAt = new Map<string, number>();

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

function mergeSnapshot(
  id: string,
  patch: Partial<ClaudeUsageSnapshot>,
): ClaudeUsageSnapshot {
  const prior = cache.get(id) ?? EMPTY;
  const next: ClaudeUsageSnapshot = {
    status: patch.status ?? prior.status,
    windows: patch.windows ?? prior.windows,
    fetchedAt: patch.fetchedAt ?? prior.fetchedAt,
  };
  if (patch.error !== undefined) next.error = patch.error;
  cache.set(id, next);
  return next;
}

/**
 * Fetch one account's usage now and update the cache. The token lives only inside this call.
 * A 401 or 403 keeps the last windows and marks them stale; a 429 backs off for `Retry-After`;
 * a missing token is `unavailable`; a network failure keeps the last windows as `error`.
 */
export async function refreshUsage(id: string): Promise<ClaudeUsageSnapshot> {
  const isDefault = id === DEFAULT_CLAUDE_ACCOUNT_ID;
  const dir = isDefault ? CLAUDE_HOME_DIR : accountDir(id);
  const token = await readAccessToken(
    keychainServiceName(isDefault ? undefined : dir),
    dir,
  );
  if (!token) {
    return mergeSnapshot(id, {
      status: "unavailable",
      windows: [],
      error: "no-token",
    });
  }
  let result: UsageFetchResult;
  try {
    result = await fetchUsage(token, USER_AGENT);
  } catch {
    return mergeSnapshot(id, { status: "error", error: "unreachable" });
  }
  const now = new Date().toISOString();
  if (result.status === 200) {
    retryAt.delete(id);
    return mergeSnapshot(id, {
      status: "ok",
      windows: mapUsageResponse(result.body),
      fetchedAt: now,
      error: undefined,
    });
  }
  if (result.status === 429) {
    const wait = Math.min(
      result.retryAfterMs ?? RETRY_AFTER_DEFAULT_MS,
      RETRY_AFTER_CAP_MS,
    );
    retryAt.set(id, Date.now() + wait);
    return mergeSnapshot(id, { status: "rate-limited", error: "rate-limited" });
  }
  if (result.status === 401 || result.status === 403) {
    return mergeSnapshot(id, { status: "stale", error: "token-rejected" });
  }
  return mergeSnapshot(id, { status: "error", error: `http-${result.status}` });
}

/**
 * A user-triggered refresh, limited to one call per account per 30 seconds and refused inside a
 * `Retry-After` window, so a click storm never burns the endpoint's budget.
 */
export async function refreshUsageManually(
  id: string,
): Promise<
  { ok: true; usage: ClaudeUsageSnapshot } | { ok: false; error: "too-soon" }
> {
  const last = lastManualAt.get(id) ?? 0;
  if (
    Date.now() - last < MANUAL_MIN_GAP_MS ||
    (retryAt.get(id) ?? 0) > Date.now()
  ) {
    return { ok: false, error: "too-soon" };
  }
  lastManualAt.set(id, Date.now());
  return { ok: true, usage: await refreshUsage(id) };
}

/**
 * Refresh every account that is not inside a `Retry-After` window. Errors never escape: one
 * account's failure must not stop the others.
 */
export async function refreshAllUsage(): Promise<void> {
  let ids: string[] = [DEFAULT_CLAUDE_ACCOUNT_ID];
  try {
    ids = ids.concat((await readRegistry()).map((a) => a.id));
  } catch {}
  for (const id of ids) {
    if ((retryAt.get(id) ?? 0) > Date.now()) continue;
    await refreshUsage(id).catch(() => undefined);
  }
}

/**
 * Poll usage for every account at boot and every 15 minutes after, matching the reference
 * implementation's cadence because the endpoint rate-limits tighter polling.
 */
export function startUsagePollLoop(): () => void {
  void refreshAllUsage();
  const timer = setInterval(
    () => {
      void refreshAllUsage();
    },
    Number(process.env.DISPATCH_USAGE_POLL_MS) || POLL_INTERVAL_MS,
  );
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Drop a removed account's cached usage and limiter state.
 */
export function forgetUsage(id: string): void {
  cache.delete(id);
  retryAt.delete(id);
  lastManualAt.delete(id);
}
