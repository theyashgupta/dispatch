import { DEFAULT_POLL_INTERVAL_MS } from "../../shared/types.js";
import { store } from "../store/board.store.js";
import { enabledSources } from "../sources/registry.js";
import { RateLimited, type TicketSource } from "../sources/ticket.source.js";

const MAX_BACKOFF_MS = 15 * 60_000;

interface Loop {
  source: TicketSource;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
  inFlight: boolean;
  rerun: boolean;
  stopped: boolean;
}

const loops = new Map<string, Loop>();

const MAX_TIMER_MS = 2 ** 31 - 1;

function baseInterval(source: TicketSource): number {
  return source.pollIntervalMs > 0
    ? Math.min(source.pollIntervalMs, MAX_TIMER_MS)
    : DEFAULT_POLL_INTERVAL_MS;
}

/**
 * Run one poll of a source, then reschedule that source's next tick.
 *
 * @remarks The captured `gen` is the race guard: `pollNow` bumps the loop's generation and starts
 * its own poll, so an older in-flight fetch that settles afterwards neither applies its stale
 * result nor reschedules. A poll requested while one is in flight only sets `rerun`, and the
 * in-flight poll runs once more when it settles, so the same source never has two fetches open.
 */
async function pollOnce(loop: Loop): Promise<void> {
  if (loop.stopped) return;
  if (loop.inFlight) {
    loop.rerun = true;
    return;
  }
  loop.inFlight = true;
  const gen = loop.generation;
  const source = loop.source;
  try {
    const { issues, items, truncated } = await source.fetch();
    if (gen !== loop.generation) return;
    if (truncated) {
      console.warn(
        `[poller] partial ${source.id} pull (pages remained beyond the source page cap or the cursor was missing), applying upserts only, skipping removals/gone-flags this cycle.`,
      );
    }
    await store.applyIssues(issues, new Date().toISOString(), {
      partial: truncated,
      source: source.id,
      kind: source.kind,
    });
    if (items !== undefined) {
      await store.upsertItems(source.id, items, {
        kind: source.kind,
        partial: truncated,
      });
    }
    if (gen !== loop.generation) return;
    loop.backoffMs = baseInterval(source);
    scheduleNext(loop, loop.backoffMs);
  } catch (err) {
    if (gen !== loop.generation) return;
    if (err instanceof RateLimited) {
      loop.backoffMs = Math.min(loop.backoffMs * 2, MAX_BACKOFF_MS);
      console.warn(
        `[poller] ${source.id} rate-limited, backing off ${Math.round(loop.backoffMs / 1000)}s, keeping last-known-good.`,
      );
      void store.setSyncUnreachable(false);
      scheduleNext(loop, loop.backoffMs);
    } else if (
      err instanceof TypeError &&
      (err as { cause?: unknown }).cause != null
    ) {
      console.error(
        `[poller] ${source.id} network-level poll failure, keeping last-known-good: ${err.message}`,
      );
      void store.setSyncUnreachable(true);
      scheduleNext(loop, baseInterval(source));
    } else {
      console.error(
        `[poller] ${source.id} poll failed, keeping last-known-good: ${(err as Error).message}`,
      );
      void store.setSyncUnreachable(false);
      scheduleNext(loop, baseInterval(source));
    }
  } finally {
    loop.inFlight = false;
    const rerun = loop.rerun;
    loop.rerun = false;
    if (rerun && !loop.stopped) void pollOnce(loop);
  }
}

/**
 * Arm a loop's next tick, stamped with its current generation.
 *
 * @remarks The stamp covers the window clearTimeout cannot: a tick already queued when pollNow
 * bumps the generation aborts itself here instead of starting a second chain. `unref` keeps the
 * timer from holding the process open.
 */
function scheduleNext(loop: Loop, delayMs: number): void {
  const gen = loop.generation;
  loop.timer = setTimeout(() => {
    if (gen === loop.generation) void pollOnce(loop);
  }, delayMs);
  loop.timer.unref?.();
}

function stopLoop(loop: Loop): void {
  loop.generation += 1;
  if (loop.timer) {
    clearTimeout(loop.timer);
    loop.timer = null;
  }
}

/**
 * Stop a loop and keep it in the map as `stopped`.
 *
 * @remarks A retired loop is never deleted, so a source re-added while its old fetch is still in
 * flight revives the same object and shares its in-flight guard.
 */
function retireLoop(loop: Loop): void {
  stopLoop(loop);
  loop.stopped = true;
  loop.rerun = false;
}

/**
 * Start (or restart) one poll loop per source and stop loops whose source is gone.
 *
 * @remarks SYNC-01: the I/O half only. Each loop drives its source's fetch() and hands the raw list
 * to the single-writer store, which runs the pure reconcile() inside its mutation queue and applies
 * the source's kind. Calling this again with a rebuilt source replaces the loop's source object and
 * polls at once; it never leaves two loops for one id.
 * @see docs/ARCHITECTURE.md#linear-sync
 */
export function startPollers(sources: readonly TicketSource[]): void {
  const keep = new Set(sources.map((s) => s.id));
  for (const [id, loop] of loops) {
    if (!keep.has(id)) retireLoop(loop);
  }
  for (const source of sources) {
    const existing = loops.get(source.id);
    if (existing) {
      stopLoop(existing);
      existing.stopped = false;
      existing.source = source;
      existing.backoffMs = baseInterval(source);
      void pollOnce(existing);
      continue;
    }
    const loop: Loop = {
      source,
      generation: 0,
      timer: null,
      backoffMs: baseInterval(source),
      inFlight: false,
      rerun: false,
      stopped: false,
    };
    loops.set(source.id, loop);
    void pollOnce(loop);
  }
}

/**
 * Start the loops for every enabled source in the registry (boot and first-run setup).
 *
 * @remarks Also stamps the store's staleness interval with the slowest enabled source, so the
 * sidebar's stale banner follows the real cadence after a first-run setup as well as at boot.
 */
export function startEnabledPollers(): void {
  const sources = enabledSources();
  if (sources.length > 0) {
    store.setPollInterval(Math.max(...sources.map(baseInterval)));
  }
  startPollers(sources);
}

/**
 * Stop every loop; the test teardown path.
 *
 * @public The poller and board route specs are the callers.
 */
export function stopPollers(): void {
  for (const loop of loops.values()) retireLoop(loop);
}

/**
 * Poll one source now, discarding any in-flight fetch of that source.
 *
 * @remarks A false return lets a route refuse instead of starting a loop the registry never
 * enabled.
 */
export function pollNow(sourceId: string): boolean {
  const loop = loops.get(sourceId);
  if (!loop || loop.stopped) return false;
  stopLoop(loop);
  void pollOnce(loop);
  return true;
}

/**
 * Per-source loop state for diagnostics and tests.
 *
 * @public The poller specs are the callers.
 */
export function pollerDiagnostics(): {
  id: string;
  backoffMs: number;
  inFlight: boolean;
}[] {
  return [...loops.values()]
    .filter((l) => !l.stopped)
    .map((l) => ({
      id: l.source.id,
      backoffMs: l.backoffMs,
      inFlight: l.inFlight,
    }));
}
