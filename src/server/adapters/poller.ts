import type { Config } from "../../shared/types.js";
import { store } from "../store/boardStore.js";
import { RateLimited, type TicketSource } from "../sources/TicketSource.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

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
  const baseIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let backoffMs = baseIntervalMs;

  async function pollOnce(): Promise<void> {
    try {
      const { issues, truncated } = await source.fetch();
      if (truncated) {
        console.warn(
          `[poller] partial ${source.id} pull (pages remained beyond the source page cap or the cursor was missing) — applying upserts only, skipping removals/gone-flags this cycle.`,
        );
      }
      await store.applyIssues(issues, new Date().toISOString(), {
        partial: truncated,
        source: source.id,
      });
      backoffMs = baseIntervalMs;
      scheduleNext(baseIntervalMs);
    } catch (err) {
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

  function scheduleNext(delayMs: number): void {
    const timer = setTimeout(() => void pollOnce(), delayMs);
    timer.unref?.();
  }

  void pollOnce();
}
