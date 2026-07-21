import type { Config } from "../../shared/types.js";
import { listPrsForBranch } from "./gh.js";
import { store } from "../store/board.store.js";
import { getLinearSource } from "../sources/registry.js";
import { RateLimited, type TicketSource } from "../sources/ticket.source.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

let currentSource: TicketSource | null = null;
let baseIntervalMs = DEFAULT_POLL_INTERVAL_MS;
let backoffMs = DEFAULT_POLL_INTERVAL_MS;
let generation = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * Run one poll of the active source, then reschedule the next. The captured `gen` is the race guard:
 * a settings save bumps `generation` and starts its own poll, so any older in-flight fetch that
 * returns (or rejects) afterwards is discarded here — it neither applies its now-stale scope to the
 * board nor reschedules, leaving the newer poll in sole control (Pitfall P3). The guard is
 * re-checked after the store apply too: a save landing during that await must not let the stale
 * poll reschedule, or its timer and the new poll's timer would each perpetuate a chain forever.
 * @remarks The unreachable branch is scoped to `TypeError` WITH a `.cause`: undici's `fetch()`
 * rejects a real transport failure (ECONNREFUSED/ENOTFOUND/etc.) with a `TypeError` carrying that
 * underlying error as `.cause`, whereas a programming `TypeError` thrown inside applyIssues/mapping
 * is causeless. Gating on `.cause` keeps a genuine blip → "Reconnecting…" (ROBU-03) while letting an
 * internal bug fall through to the generic branch (surfaced as a real fault, flag cleared) rather
 * than being masked as connectivity loss.
 */
async function pollOnce(): Promise<void> {
  const source = currentSource;
  if (!source) return;
  const gen = generation;
  try {
    const { issues, truncated } = await source.fetch();
    if (gen !== generation) return;
    if (truncated) {
      console.warn(
        `[poller] partial ${source.id} pull (pages remained beyond the source page cap or the cursor was missing) — applying upserts only, skipping removals/gone-flags this cycle.`,
      );
    }
    await store.applyIssues(issues, new Date().toISOString(), {
      partial: truncated,
      source: source.id,
    });
    if (gen !== generation) return;
    detectPullRequests().catch((err) =>
      console.error("[pr-detect] tick failed:", (err as Error).message),
    );
    backoffMs = baseIntervalMs;
    scheduleNext(baseIntervalMs);
  } catch (err) {
    if (gen !== generation) return;
    if (err instanceof RateLimited) {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      console.warn(
        `[poller] ${source.id} rate-limited — backing off ${Math.round(backoffMs / 1000)}s, keeping last-known-good.`,
      );
      void store.setSyncUnreachable(false);
      scheduleNext(backoffMs);
    } else if (
      err instanceof TypeError &&
      (err as { cause?: unknown }).cause != null
    ) {
      console.error(
        `[poller] network-level poll failure — keeping last-known-good: ${err.message}`,
      );
      void store.setSyncUnreachable(true);
      scheduleNext(baseIntervalMs);
    } else {
      console.error(
        `[poller] poll failed — keeping last-known-good: ${(err as Error).message}`,
      );
      void store.setSyncUnreachable(false);
      scheduleNext(baseIntervalMs);
    }
  }
}

/**
 * Fan out a `gh pr list` probe across every live-session card's workspace repos, piggybacking on
 * the existing 60s tick. Fire-and-forget from its `pollOnce` call site (never awaited there): a
 * hung or slow `gh` process must degrade only badge freshness, never the Linear-sync cadence or
 * `scheduleNext`'s reschedule. Scopes via `cardsWithSession()` (already excludes member cards,
 * which never carry `tmuxSession`) filtered to a branch, matching D-02's live-session scoping with
 * zero new store surface. Uses `repo.path` — the STABLE registered main-repo path — never the
 * per-ticket worktree directory Done cleanup deletes, which is not the repo `gh` needs to resolve
 * the remote from anyway.
 */
async function detectPullRequests(): Promise<void> {
  const cards = store
    .cardsWithSession()
    .filter((c) => c.branch != null && c.workspace != null);
  await Promise.all(
    cards.map(async (card) => {
      const branch = card.branch as string;
      const repos = card.workspace?.repos ?? [];
      const results = await Promise.all(
        repos.map((repo) => listPrsForBranch(repo.path, branch)),
      );
      const next = results.flat();
      if (JSON.stringify(card.prs ?? []) === JSON.stringify(next)) return;
      await store.setPrs(card.id, next);
    }),
  );
}

/**
 * Arm the next self-rescheduling tick, stamped with the current generation. The stamp covers the
 * window clearTimeout cannot: if the timer already fired and its callback sits queued when pollNow
 * bumps the generation, the clear is a no-op — the stale tick must abort itself here or it would
 * start a second self-perpetuating poll chain. `unref` keeps the timer from holding the process open.
 */
function scheduleNext(delayMs: number): void {
  const gen = generation;
  pending = setTimeout(() => {
    if (gen === generation) void pollOnce();
  }, delayMs);
  pending.unref?.();
}

/**
 * Start the poll loop. Runs one poll immediately, then reschedules itself: the base interval on a
 * healthy cycle, or an exponentially-backed-off delay after a RateLimited response. A self-
 * rescheduling timer (rather than setInterval) guarantees polls never overlap and lets the delay
 * vary for backoff. Fire-and-forget: startPoller returns immediately.
 * @remarks SYNC-01: the I/O half only — it drives the pluggable source's fetch() and hands the raw
 * list to the single-writer store, which runs the pure reconcile() inside its mutation queue. It
 * never sorts, never touches cards past To Do, and keeps last-known-good on any error/RateLimited.
 * @see docs/ARCHITECTURE.md#linear-sync
 */
export function startPoller(config: Config, source: TicketSource): void {
  currentSource = source;
  baseIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  backoffMs = baseIntervalMs;
  void pollOnce();
}

/**
 * Start the poll loop against the freshly-built Linear source after a first-run key save.
 * @remarks Called only from the keyless setup path (the route 409s when a key already exists), so the
 * `startPoller` re-entry residual — it does not reset `generation` — is never triggered by a second
 * start.
 */
export function startLinearPoller(config: Config): void {
  startPoller(config, getLinearSource());
}

/**
 * Trigger an immediate poll after a filter change. Bumping `generation` invalidates any in-flight
 * fetch still carrying the old scope so it can never revert the board, and clearing the pending
 * timer prevents a duplicate scheduled tick from racing this one (Pitfall P3).
 */
export function pollNow(): void {
  generation++;
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  void pollOnce();
}
