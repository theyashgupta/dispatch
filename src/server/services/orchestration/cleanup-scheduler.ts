import { store } from "../../store/board.store.js";
import { cleanupWorkspace } from "./cleanup.js";

/**
 * Tick cadence for the automatic due-cleanup sweep. One minute: the UI's finest countdown
 * granularity is `<1m` (`format-cleanup-countdown.ts`), and Phase 82 will grow the retained Done
 * population, so a tighter cadence buys no visible responsiveness and only costs an extra scan.
 */
const CLEANUP_TICK_MS = 60_000;

/**
 * Tear down every past-due card once, non-forced. `store.clearCleanupDue` runs BEFORE
 * `cleanupWorkspace` dispatches (double-run guard #1: a second tick can no longer see the card as
 * due), and `store.isCleaningUp`/`beginCleanup`/`endCleanup` (the SAME shared in-flight guard the
 * manual `/cleanup` route consults — WR-01) blocks re-entry against a still-running teardown from a
 * previous tick OR a concurrent manual dispatch for the same card. Iterates SEQUENTIALLY, never
 * `Promise.all` — teardowns are disk- and subprocess-heavy and must not stampede. Dispatching
 * non-forced is the whole CLEAN-07 safety contract: the existing dirty-worktree preflight still
 * refuses.
 * @remarks Re-validates the card's live state with a FRESH `store.getCard` read immediately before
 * the destructive `cleanupWorkspace` call (CR-01), rather than trusting the `cardsDueForCleanup`
 * snapshot: sequential dispatch plus the `clearCleanupDue` queue hop means real wall-clock time
 * elapses between the snapshot and this card's own turn, during which a legal Done → In Progress
 * drag (or a column-preserving Resume) can make the card live again. A card that left Done is
 * abandoned silently — `moveCardManual` already cleared its `cleanupDueAt` as part of that same
 * move, so nothing needs restoring. A card that is STILL Done but has a start/resume saga in flight
 * is also abandoned for this tick, but its schedule is restored via `restoreCleanupDue` so it is
 * retried on the next tick instead of being stranded with no schedule and no automatic way back to
 * one; a blocked (dirty-preflight) run, by contrast, remains terminal — no retry, no backoff.
 */
async function runDueCleanups(): Promise<void> {
  const now = Date.now();
  for (const snapshot of store.cardsDueForCleanup(now)) {
    if (store.isCleaningUp(snapshot.id)) continue;
    store.beginCleanup(snapshot.id);
    try {
      await store.clearCleanupDue(snapshot.id, undefined);
      const fresh = store.getCard(snapshot.id);
      if (!fresh || fresh.column !== "done") continue;
      if (store.isStarting(snapshot.id)) {
        await store.restoreCleanupDue(snapshot.id, undefined, now);
        continue;
      }
      await cleanupWorkspace(snapshot.id, { force: false });
    } finally {
      store.endCleanup(snapshot.id);
    }
  }
}

/**
 * Start the services-tier, self-rescheduling due-cleanup loop (`LIFE-03`). Mirrors
 * `artifact-detect.ts#startArtifactDetectionLoop`'s tick/scheduleNext/unref shape exactly, but
 * lives in `services/orchestration/` rather than `adapters/` because it calls `cleanupWorkspace` —
 * an `adapters → services` import is a hard ESLint `boundaries/dependencies` error and a forbidden
 * back-edge in `docs/ARCHITECTURE.md`'s Do-Not-Change Contract #12.
 * @remarks The immediate `void tick()` below IS the boot sweep: any card whose `cleanupDueAt`
 * elapsed while the process was stopped is picked up by this first tick, so no separate catch-up
 * code path exists. A fixed-interval timer is deliberately avoided — an overlapping tick would be a
 * double-teardown-dispatch risk this loop cannot tolerate the way the cheap-store-mutation-only
 * marker/artifact loops can.
 * @see docs/ARCHITECTURE.md#cleanup-lifecycle
 */
export function startCleanupScheduler(): void {
  async function tick(): Promise<void> {
    try {
      await runDueCleanups();
    } catch (err) {
      console.error(
        `[cleanup-scheduler] tick failed — continuing: ${(err as Error).message}`,
      );
    } finally {
      scheduleNext();
    }
  }

  function scheduleNext(): void {
    const timer = setTimeout(() => void tick(), CLEANUP_TICK_MS);
    timer.unref?.();
  }

  void tick();
}
