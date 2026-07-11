import type { Config } from "../../shared/types.js";
import { store } from "../store/board.store.js";
import { RateLimited, type TicketSource } from "../sources/TicketSource.js";

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
    backoffMs = baseIntervalMs;
    scheduleNext(baseIntervalMs);
  } catch (err) {
    if (gen !== generation) return;
    if (err instanceof RateLimited) {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      console.warn(
        `[poller] ${source.id} rate-limited — backing off ${Math.round(backoffMs / 1000)}s, keeping last-known-good.`,
      );
      scheduleNext(backoffMs);
    } else {
      console.error(
        `[poller] poll failed — keeping last-known-good: ${(err as Error).message}`,
      );
      scheduleNext(baseIntervalMs);
    }
  }
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
