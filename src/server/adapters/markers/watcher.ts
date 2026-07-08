import { store } from "../../store/boardStore.js";
import { capturePane, paneSize } from "../tmux.js";
import { killTtyd, trackedTtydSessions } from "../ttyd.js";
import {
  agentOutputView,
  diffFingerprint,
  isRecapOverlay,
} from "./pane-view.js";
import {
  decideScan,
  paneNeedsSize,
  type ScanInput,
  type SessionState,
} from "./scan-decision.js";

/**
 * Per-session flip-back state, keyed by tmux session name. In-memory only (NOT persisted) —
 * mirrors ttyd.ts's module-level procs/inFlight maps. `baseline` is the AGENT-OUTPUT VIEW
 * (agentOutputView(): the `⏺`-anchored lines of the stripped body — see § structural discriminator)
 * snapshotted when a NEEDS_INPUT marker fires; a later tick flips the card back once the live
 * agent-output view diverges from it (the agent has produced a NEW assistant/tool block, i.e. it
 * responded). Anchoring on `⏺` blocks — not the whole stripped body — is what makes TUI CHROME
 * repaints (tips, notification rows, timed hints, recap/suggestion variants, rewraps the geometry
 * guard misses) structurally unable to flip a card: chrome never emits a `⏺` block, so it can
 * never change this view (root-cause fix for the open-ended false-flip class; see debug session
 * false-flipback-tui-repaint). `width` is the pane width (columns) at snapshot time: a ttyd client
 * attach resizes the window and hard-rewraps the transcript, changing `⏺`-line TEXT at the new
 * width WITHOUT any agent activity — so a width change invalidates the baseline (re-snapshot, never
 * flip). Within a constant-geometry window `⏺` text is stable, which is the dependency the compare
 * relies on. `height` is tracked alongside `width` because a ttyd DETACH (the Phase-5 sweep-kill of
 * an orphaned client) shrinks the pane height at constant width and reflows the transcript — a
 * width-only guard missed it and false-flipped a still-blocked card. `divergentTicks` counts
 * consecutive ticks the live agent-output view has diverged from `baseline`: flip-back requires TWO
 * in a row (see § 4) so a baseline snapshotted mid-settling can't false-flip on a single transient
 * repaint. It rides inside this entry so it is reset/cleaned automatically whenever the baseline is
 * re-snapshotted or the session is dropped.
 */
const sessions = new Map<
  string,
  { baseline: string; width: number; height: number; divergentTicks: number }
>();

/**
 * Per-session baseline of the AGENT-OUTPUT VIEW (agentOutputView()) for the ATTN-02 unseen-activity
 * dot, keyed by tmux session name. In-memory only. DEDICATED — deliberately NOT the flip-back
 * `sessions` map above: that map is deleted on flip-back and Agent Done, and entangling the two
 * would corrupt both state machines. First observation SEEDS only (never fires) so a backend boot
 * doesn't light a dot on every live session; a later divergence re-baselines forward and stamps the
 * card's `outputChangedAt`. Fires on the FIRST divergence (no 2-tick debounce — a false dot is
 * cosmetic and self-heals on the next panel open; the flip-back debounce exists only because a
 * false flip-back is destructive). Reaped alongside the other per-session maps at end of tick.
 */
const agentViews = new Map<string, string>();

/**
 * Sessions whose capture failure has already been warned about, so a dead/renamed session logs
 * exactly ONCE instead of never (silent freeze) or every 2s (log spam). Cleared on a later
 * successful capture so a session that dies AGAIN warns again. Content-free logging only.
 */
const warnedCaptures = new Set<string>();

/**
 * Consecutive marker-free ticks observed per session while a card is out of its attention column
 * but still holds a `lastMarker` (BUG-2 / IN-06 hardening). Step 3a clears the dedup key only after
 * TWO consecutive such ticks, so a single transient full-screen repaint (idle recap overlay, a
 * one-off capture hiccup) that momentarily hides the marker can never wipe the key and let it
 * re-fire. Reset the moment a marker reappears or a clear fires. In-memory only.
 */
const markerFreeTicks = new Map<string, number>();

/**
 * Consecutive `capture-pane` FAILURES observed per session (RESIL-01 runtime dead-session detector).
 * Three in a row (~6s at the 2s tick) means the tmux session is genuinely gone, so the card is
 * marked session-lost (store.markSessionLost) — which clears tmuxSession, drops the card out of
 * cardsWithSession(), and makes it Restart-able instead of frozen in a silent warn-once state.
 * The threshold survives the two benign transient cases: a tsx-watch reload kills the whole backend
 * process before 3 failures can accrue, and boot reconcile re-validates a still-live session at
 * startup — so only a REAL mid-run kill reaches 3. Accepted tradeoff: a session wedged (uncapturable)
 * for >6s but eventually recoverable is marked lost, which the user simply Restarts (never destructive
 * to the workspace/branch). Reset to zero on ANY successful capture. In-memory only.
 */
const captureFailures = new Map<string, number>();

/**
 * Scan one session's visible pane and apply at most ONE decision this tick. This is the I/O SHELL:
 * it owns capture, the lazy `paneSize` fetch, the capture-failure dead-session detector, and the
 * mapping of the pure `decideScan` decision onto `store.*` mutators. All decision logic lives in
 * `scan-decision.ts`; the two per-session baselines (`sessions` flip-back and `agentViews` dot) are
 * threaded through `SessionState` and written back here without ever being merged.
 */
async function scanSession(card: {
  id: string;
  column: string;
  tmuxSession?: string;
  lastMarker?: string;
}): Promise<void> {
  const session = card.tmuxSession;
  if (!session) return;

  if (card.column === "todo") return;

  let pane: string;
  try {
    pane = await capturePane(`=${session}:`, { join: true });
    warnedCaptures.delete(session);
    captureFailures.delete(session);
  } catch (err) {
    if (card.column === "done") return;
    const fails = (captureFailures.get(session) ?? 0) + 1;
    if (fails >= 3) {
      captureFailures.delete(session);
      await store.markSessionLost(card.id);
      return;
    }
    captureFailures.set(session, fails);
    if (!warnedCaptures.has(session)) {
      warnedCaptures.add(session);
      console.warn(
        `[watcher] capture failed for a session — skipping until it recovers: ${(err as Error).message}`,
      );
    }
    return;
  }

  if (isRecapOverlay(pane)) return;

  const prev: SessionState = {
    flip: sessions.get(session),
    agentView: agentViews.get(session),
    markerFreeStreak: markerFreeTicks.get(session) ?? 0,
  };

  let width = Number.NaN;
  let height = Number.NaN;
  const probe: ScanInput = {
    pane,
    width,
    height,
    column: card.column,
    lastMarker: card.lastMarker,
  };
  if (paneNeedsSize(probe)) {
    try {
      ({ width, height } = await paneSize(`=${session}:`));
    } catch {}
  }

  const input: ScanInput = {
    pane,
    width,
    height,
    column: card.column,
    lastMarker: card.lastMarker,
  };
  const { decision, next } = decideScan(input, prev);

  if (prev.agentView !== undefined && next.agentView !== prev.agentView) {
    await store.setOutputChanged(card.id, new Date().toISOString());
  }

  if (
    process.env.AK_WATCH_DEBUG &&
    card.column === "needs_input" &&
    prev.flip &&
    Number.isFinite(width) &&
    width === prev.flip.width &&
    height === prev.flip.height
  ) {
    const view = agentOutputView(pane);
    if (view !== prev.flip.baseline) {
      const divergentTicks = prev.flip.divergentTicks + 1;
      console.warn(
        `[watcher] agent-output divergence tick ${divergentTicks}/2 — ${diffFingerprint(prev.flip.baseline, view)}`,
      );
    }
  }

  switch (decision.kind) {
    case "nothing":
    case "setOutputChanged":
      break;
    case "clearLastMarker":
      await store.clearLastMarker(card.id);
      break;
    case "applyMarker":
      await store.applyMarker(
        card.id,
        decision.column,
        decision.reason,
        decision.key,
      );
      break;
    case "flipBack":
      await store.flipBack(card.id);
      break;
  }

  if (next.flip) sessions.set(session, next.flip);
  else sessions.delete(session);
  if (next.agentView !== undefined) agentViews.set(session, next.agentView);
  else agentViews.delete(session);
  if (next.markerFreeStreak > 0)
    markerFreeTicks.set(session, next.markerFreeStreak);
  else markerFreeTicks.delete(session);
}

/**
 * End-of-tick reaping: per-session map cleanup + orphaned-ttyd teardown (Phase-3 review IN-04), now
 * REACHABLE via the runtime dead-session detector in the scan (a mid-run markSessionLost clears
 * tmuxSession, so cardsWithSession() shrinks). Called AFTER the scan loop so any markSessionLost
 * from this tick is already reflected: for every tracked session key no longer live, drop its
 * entries from all four per-session maps and tear down its now-orphaned ttyd. `killTtyd` is wired
 * HERE (in the shell, never in the store) so the import direction stays acyclic (watcher → ttyd →
 * store).
 */
function reapDeadSessions(): void {
  const liveSessions = new Set(
    store
      .cardsWithSession()
      .map((c) => c.tmuxSession)
      .filter(Boolean),
  );
  const tracked = new Set<string>([
    ...sessions.keys(),
    ...warnedCaptures,
    ...markerFreeTicks.keys(),
    ...captureFailures.keys(),
    ...agentViews.keys(),
    ...trackedTtydSessions(),
  ]);
  for (const session of tracked) {
    if (liveSessions.has(session)) continue;
    sessions.delete(session);
    warnedCaptures.delete(session);
    markerFreeTicks.delete(session);
    captureFailures.delete(session);
    agentViews.delete(session);
    killTtyd(session);
  }
}

/**
 * Start the fire-and-forget 2s pane watcher (lives beside the Linear poller). Restart re-attach
 * is Phase 5. Loop shape mirrors linear/poller.ts startPoller: an inner `tick` that scans every
 * live session serially then reaps dead ones, a `scheduleNext` self-rescheduling `setTimeout`
 * (never a fixed-interval timer that could overlap a long tick) with `timer.unref?.()` so it
 * never pins the process, a per-tick try/catch so one failure never kills the loop, and an
 * immediate first run.
 */
export function startMarkerWatcher(): void {
  async function tick(): Promise<void> {
    try {
      for (const card of store.cardsWithSession()) {
        await scanSession(card);
      }
      reapDeadSessions();
    } catch (err) {
      console.error(
        `[watcher] tick failed — continuing: ${(err as Error).message}`,
      );
    } finally {
      scheduleNext();
    }
  }

  function scheduleNext(): void {
    const timer = setTimeout(() => void tick(), 2000);
    timer.unref?.();
  }

  void tick();
}
