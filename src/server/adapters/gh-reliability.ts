import { run } from "./exec.js";
import { listPrsForBranch, type PrProbeResult } from "./gh.js";
import type { ProbeFailureCategory } from "../../shared/types.js";

/** Ceiling on `gh pr list` subprocesses in flight at once, across every repo/session (PRLINK-05). */
const MAX_CONCURRENT = 4;

/** How long a deterministic failure is trusted without re-asking `gh` (PRLINK-05). */
const NEGATIVE_CACHE_TTL_MS = 10 * 60_000;

/** Below this many requests remaining in either GitHub rate-limit bucket, probing pauses. */
const RATE_LIMIT_FLOOR = 50;

/** Upper bound on a single breaker pause, regardless of what `reset` reports (T-98-03). */
const MAX_PAUSE_MS = 60 * 60_000;

/**
 * The `ProbeFailureCategory` values worth negative-caching: a repeat ask is certain to fail the
 * same way until something outside this process changes (an auth grant, a repo re-permission, a
 * reinstalled `gh`, a restored folder). Listed as literals rather than derived from the
 * `ProbeFailureCategory` union so widening that union can never silently enrol a new category:
 * `gh pr list failed` and `detection unavailable` stay off this list because they are transient
 * and must retry every tick under the existing ceiling, and `gh rate limited` is governed by the
 * breaker below, not this cache.
 */
const DETERMINISTIC: ReadonlySet<ProbeFailureCategory> = new Set([
  "gh not authenticated",
  "gh repo not accessible",
  "gh unavailable",
  "repo path missing",
]);

/**
 * The same shape `gh.ts` returns, with one addition: `skipped` marks a result that never spawned
 * `gh` at all, a negative-cache hit or a rate-limit-breaker pause. The caller needs this to tell
 * "we did not ask" from "we asked and it failed", since only the latter may spend a strike against
 * `PROBE_FAILURE_CEILING` (98-RESEARCH.md Pitfall 4).
 */
export type GhProbeResult = PrProbeResult & { skipped?: true };

const negativeCache = new Map<
  string,
  { category: ProbeFailureCategory; cachedUntil: number }
>();

/** Global rate-limit breaker: no `gh pr list` spawns anywhere until this epoch ms. */
let pausedUntil = 0;

/** Memoises the single in-flight `gh api rate_limit` call so simultaneous failures trip it once. */
let rateLimitCheckInFlight: Promise<void> | null = null;

let inFlight = 0;
const queue: (() => void)[] = [];

function acquire(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (inFlight < MAX_CONCURRENT) {
        inFlight++;
        resolve(() => {
          inFlight--;
          queue.shift()?.();
        });
      } else {
        queue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

interface GhRateLimitBody {
  resources?: {
    core?: { remaining?: number; reset?: number };
    graphql?: { remaining?: number; reset?: number };
  };
}

/**
 * Call `gh api rate_limit` once and, if either bucket is genuinely below {@link RATE_LIMIT_FLOOR},
 * trip {@link pausedUntil}.
 *
 * @remarks
 * Never throws and never sets a pause on a parse failure, a non-finite `remaining`, or a thrown
 * call: a misbehaving `gh` must not be able to wedge PR probing (T-98-03). The response body and
 * any stderr are never logged, only the closed `ProbeFailureCategory` token this function's caller
 * already returns may cross the wire (T-98-01).
 *
 * A standing pause returns immediately. {@link rateLimitCheckInFlight} dedupes only STRICTLY
 * overlapping calls, since the initiating caller nulls it in its own `finally`, and rate-limited
 * `gh pr list` children exit milliseconds apart rather than simultaneously: without the
 * {@link pausedUntil} test, N rate-limited failures would spawn N `gh api rate_limit` subprocesses,
 * and a body that never trips a pause (a healthy `remaining`, a malformed body, a past `reset`)
 * would spawn one per failing probe per tick, forever.
 */
async function tripBreakerIfRateLimited(): Promise<void> {
  if (Date.now() < pausedUntil) return;
  if (rateLimitCheckInFlight != null) return rateLimitCheckInFlight;
  rateLimitCheckInFlight = (async () => {
    try {
      const { stdout } = await run("gh", ["api", "rate_limit"], {
        timeout: 8000,
      });
      const body = JSON.parse(stdout) as GhRateLimitBody;
      const buckets = [body.resources?.core, body.resources?.graphql];
      let earliestReset: number | null = null;
      for (const bucket of buckets) {
        const remaining = bucket?.remaining;
        const reset = bucket?.reset;
        if (
          typeof remaining === "number" &&
          Number.isFinite(remaining) &&
          remaining < RATE_LIMIT_FLOOR &&
          typeof reset === "number" &&
          Number.isFinite(reset)
        ) {
          const resetMs = reset * 1000;
          if (earliestReset == null || resetMs < earliestReset) {
            earliestReset = resetMs;
          }
        }
      }
      if (earliestReset != null) {
        pausedUntil = Math.max(
          Date.now(),
          Math.min(earliestReset, Date.now() + MAX_PAUSE_MS),
        );
      }
    } catch {
      // no-op: see the doc block above, a thrown call sets no pause (PRLINK-05).
    }
  })();
  try {
    await rateLimitCheckInFlight;
  } finally {
    rateLimitCheckInFlight = null;
  }
}

/**
 * Gate every `gh pr list` spawn behind a per-repo negative cache, a global rate-limit breaker and
 * a concurrency semaphore, in that order, before delegating to {@link listPrsForBranch}.
 *
 * @remarks
 * A cache hit or a breaker pause returns `skipped: true` with NO spawn: "we did not ask", never
 * "we asked and it failed". Only a real spawn (step 4 below) can arm the negative cache or trip
 * the breaker, and only a real spawn's result is returned without `skipped`, which is what lets
 * the caller count it as a genuine strike.
 */
export async function probePrsForBranch(
  repoPath: string,
  branch: string,
  repo: string,
): Promise<GhProbeResult> {
  const cached = negativeCache.get(repoPath);
  if (cached != null) {
    if (Date.now() < cached.cachedUntil) {
      return { ok: false, category: cached.category, skipped: true };
    }
    negativeCache.delete(repoPath);
  }

  if (Date.now() < pausedUntil) {
    return { ok: false, category: "gh rate limited", skipped: true };
  }

  const release = await acquire();
  let result: PrProbeResult;
  try {
    result = await listPrsForBranch(repoPath, branch, repo);
  } finally {
    release();
  }

  if (!result.ok) {
    if (DETERMINISTIC.has(result.category)) {
      negativeCache.set(repoPath, {
        category: result.category,
        cachedUntil: Date.now() + NEGATIVE_CACHE_TTL_MS,
      });
    } else if (result.category === "gh rate limited") {
      await tripBreakerIfRateLimited();
    }
  }
  return result;
}

/**
 * Evict every negative-cache entry not in `liveRepoPaths`, mirroring `artifact-detect.ts`'s own
 * per-tick prune of its session-keyed maps (T-98-04). This cache is keyed by repo PATH rather than
 * session id: a deleted or renamed repo would otherwise leave a permanent entry behind, since
 * nothing else in this module ever visits a path that stopped being probed.
 */
export function pruneGhReliability(liveRepoPaths: Set<string>): void {
  for (const path of negativeCache.keys()) {
    if (!liveRepoPaths.has(path)) negativeCache.delete(path);
  }
}
