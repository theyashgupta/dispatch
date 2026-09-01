import { store } from "../../store/board.store.js";
import { cleanupWorkspace } from "./cleanup.js";

/**
 * Tick cadence for the automatic due-cleanup sweep. One minute: the UI's finest countdown
 * granularity is `<1m` (`format-cleanup-countdown.ts`), and Phase 82 will grow the retained Done
 * population, so a tighter cadence buys no visible responsiveness and only costs an extra scan.
 * @remarks Overridable via `DISPATCH_CLEANUP_TICK_MS` (`LIFE-01` instrument hook), mirroring
 * `cleanup.ts`'s `DISPATCH_PERF_CLEANUP` env-gate idiom exactly: `Number(undefined) || 60_000`
 * evaluates to `60_000` when the variable is unset, so production timing is unchanged on every
 * normal path. It exists so a real-process instrument can observe several ticks in seconds rather
 * than minutes; the parsed value is floored at 250 ms and only honoured when finite and positive,
 * so a malformed or hostile value can never busy-loop the scheduler.
 */
const parsedTickMs = Number(process.env.DISPATCH_CLEANUP_TICK_MS) || 60_000;
const CLEANUP_TICK_MS =
  Number.isFinite(parsedTickMs) && parsedTickMs > 0
    ? Math.max(parsedTickMs, 250)
    : 60_000;

/**
 * Tear down every past-due SESSION once, non-forced, iterating the `(card, session)` pairs
 * {@link store.sessionsDueForCleanup} yields. `store.clearCleanupDue` runs BEFORE `cleanupWorkspace`
 * dispatches for that session (double-run guard #1: a second tick can no longer see the same session
 * as due), and `store.isCleaningUp`/`beginCleanup`/`endCleanup` (the SAME shared in-flight guard the
 * manual `/cleanup` route consults — WR-01) stays CARD-scoped, blocking re-entry against a still-
 * running teardown from a previous tick OR a concurrent manual dispatch for the same card — a card
 * can now appear more than once in one tick's list, and the guard must still serialize all of a
 * card's own sessions rather than letting two of its teardowns race each other. Iterates
 * SEQUENTIALLY, never `Promise.all` — teardowns are disk- and subprocess-heavy and must not stampede,
 * and a compound-keyed (card, session) in-flight guard was deliberately rejected in favor of this
 * simpler card-scoped one plus strict sequencing. Dispatching non-forced is the whole CLEAN-07 safety
 * contract: the existing dirty-worktree preflight still refuses.
 * @remarks Re-validates BOTH the card's and the session's live state with a FRESH `store.getCard`
 * read immediately before the destructive `cleanupWorkspace` call (CR-01), rather than trusting the
 * `sessionsDueForCleanup` snapshot: sequential dispatch plus the `clearCleanupDue` queue hop means
 * real wall-clock time elapses between the snapshot and this pair's own turn, during which a legal
 * Done → In Progress drag (or a column-preserving Resume) can make the card live again, OR an earlier
 * iteration in the SAME tick (or a concurrent manual fan-out) can already have removed the very
 * session record this iteration was about to clean. Without the session-existence check, that second
 * iteration would reach `cleanupWorkspace` with an id that no longer resolves. A card that left Done
 * is abandoned silently — `moveCardManual` already cleared every session's `cleanupDueAt` as part of
 * that same move, so nothing needs restoring. A card that is STILL Done but has a start/resume saga
 * in flight is also abandoned for this tick, but its schedule is restored via `restoreCleanupDue` so
 * it is retried on the next tick instead of being stranded with no schedule and no automatic way back
 * to one; a blocked (dirty-preflight) run, by contrast, remains terminal — no retry, no backoff.
 */
async function runDueCleanups(): Promise<void> {
  const now = Date.now();
  for (const due of store.sessionsDueForCleanup(now)) {
    if (store.isCleaningUp(due.card.id)) continue;
    store.beginCleanup(due.card.id);
    try {
      await store.clearCleanupDue(due.card.id, due.sessionId);
      const fresh = store.getCard(due.card.id);
      if (!fresh || fresh.column !== "done") continue;
      if (
        due.sessionId !== undefined &&
        !fresh.sessions?.some((s) => s.id === due.sessionId)
      ) {
        continue;
      }
      if (store.isStarting(due.card.id)) {
        await store.restoreCleanupDue(due.card.id, due.sessionId, now);
        continue;
      }
      await cleanupWorkspace(due.card.id, due.sessionId, { force: false });
    } finally {
      store.endCleanup(due.card.id);
    }
  }
}

/**
 * Start the services-tier, self-rescheduling due-cleanup loop (`LIFE-03`). Mirrors
 * `artifact-detect.ts#startArtifactDetectionLoop`'s tick/scheduleNext/unref shape exactly, but
 * lives in `services/orchestration/` rather than `adapters/` because it calls `cleanupWorkspace` —
 * an `adapters → services` import is a hard ESLint `boundaries/dependencies` error and a forbidden
 * back-edge in `docs/ARCHITECTURE.md`'s Do-Not-Change Contract #12.
 * @remarks The immediate `void tick()` below IS the boot sweep: any session whose `cleanupDueAt`
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
        `[cleanup-scheduler] tick failed, continuing: ${(err as Error).message}`,
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
