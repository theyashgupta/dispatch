import type { Session, StatusChannel } from "../../../shared/types.js";
import { store } from "../../store/board.store.js";
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
 * Three in a row (~6s at the 2s tick) means the tmux session is genuinely gone, so that ONE session
 * is marked lost (store.markSessionLost, Phase 91: targets this session's own id, never the card's
 * active pointer) — clearing its `tmuxSession` and dropping it out of `sessionsWithTmux()`. A card
 * with no other live session becomes Restart-able instead of frozen in a silent warn-once state; a
 * card with a live sibling stays untouched, its own capture continuing on its own strike count.
 * The threshold survives the two benign transient cases: a tsx-watch reload kills the whole backend
 * process before 3 failures can accrue, and boot reconcile re-validates a still-live session at
 * startup — so only a REAL mid-run kill reaches 3. Accepted tradeoff: a session wedged (uncapturable)
 * for >6s but eventually recoverable is marked lost, which the user simply Restarts (never destructive
 * to the workspace/branch). Reset to zero on ANY successful capture. In-memory only.
 */
const captureFailures = new Map<string, number>();

/**
 * Scan one session's visible pane and apply at most ONE decision this tick. This is the I/O SHELL:
 * it owns capture, the lazy `paneSize` fetch, the capture-failure dead-session detector, the
 * per-session channel gate, and the mapping of the pure `decideScan` decision onto `store.*`
 * mutators. All decision logic lives in `scan-decision.ts`; the two per-session baselines
 * (`sessions` flip-back and `agentViews` dot) are threaded through `SessionState` and written back
 * here without ever being merged. The channel gate demotes everything BELOW it — marker scan,
 * flip-back, and dot pane-diffing — per session, while capture and its 3-strike dead-session
 * detector above the gate stay unconditional on every channel: capture IS the RESIL-01 probe and
 * must run for hook-routed sessions too.
 * @remarks (`WR-05`) Under `auto` the gate demotes this channel ONLY on `card.hookRoutedAt`, which
 * is stamped exclusively by an authenticated hook event. That asymmetry is deliberate: because
 * everything below the gate is this session's LAST status channel, the gate must never close on a
 * prediction (a CLI version parse) that a hook POST will one day arrive — a hook script whose
 * `curl` is missing from the session's PATH fails silently by design, and a predicted latch would
 * leave such a card with no marker scan, no flip-back and no activity dot for the rest of its life.
 * Erring the other way costs at most a brief overlap where both channels are live, which
 * `lastMarker` dedup and the single-writer queue already absorb.
 * @remarks A tick spans several awaits (the pane capture, the lazy size probe, the dot stamp) and
 * `card` is the store's LIVE Map entry, so the hooks channel can mutate it after `decideScan` has
 * already ruled on a now-stale pair of inputs. The dangerous shape is a hook-driven `flipBack` out
 * of `agent_done`/`in_review`, which clears `lastMarker` — the level-triggered scan's only defence
 * against re-firing a marker that is still physically on the pane — so the tick would re-apply the
 * consumed DONE and snap the card the user just re-prompted straight back to Agent Done with a
 * stale summary. Re-comparing the card's `column` and `lastMarker` against the values the decision
 * was computed from, immediately before dispatching, makes the mutation compare-and-swap: a
 * changed card skips this tick and the next one re-decides from the new state. The per-session
 * baselines are still written back, because they describe the pane, not the card. This guard
 * stands on its own — it must not be traded away on the assumption that the channel gate above
 * already excludes hook-routed sessions, since under `auto` a session is pane-routed until its
 * first hook event proves otherwise.
 * @remarks (`WR-05`) The `applyMarker` case derives its `eventType` from `decision.column` with a
 * ternary — the one place that derivation survives, because `scan-decision.ts`'s `Decision` type
 * is replay-frozen and carries no event-type field of its own. This I/O shell is where the frozen
 * type's column is turned into the caller-supplied literal `applyMarker` now requires; it must
 * never be pushed back into the store.
 * @remarks (Phase 91) Driven per-session: the tick loop calls this once for every
 * `store.sessionsWithTmux()` pair, so a card with N live siblings receives N calls per tick, each
 * addressing its OWN session record's `tmuxSession`/`lastMarker`/`hookRoutedAt` — never the card's
 * flat mirror. Reading the mirror here would let one session's hook traffic silence the pane scan
 * of a sibling with no hook channel of its own, or let a sibling's marker write masquerade as a
 * change to THIS session's own compare-and-swap inputs below.
 * @remarks (`CR-01`) `decideScan` CONSUMES the flip-back baseline on the tick it decides
 * `flipBack` (`nextFlip` becomes `undefined`), which is correct only when the store actually
 * moved the card. `store.flipBack` now reports whether it did, and a suppressed move RETAINS the
 * existing baseline instead of deleting it — otherwise the evidence for a refused move is thrown
 * away and the retry needs two fresh divergent ticks, which an agent that has already finished
 * replying never produces. Retaining the baseline keeps the retry level-triggered: the next
 * divergent tick re-fires immediately.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
async function scanSession(
  card: { id: string; column: string },
  session: Session,
  channel: StatusChannel,
): Promise<void> {
  const tmuxName = session.tmuxSession;
  if (!tmuxName) return;

  if (card.column === "todo") return;

  let pane: string;
  try {
    pane = await capturePane(`=${tmuxName}:`, { join: true });
    warnedCaptures.delete(tmuxName);
    captureFailures.delete(tmuxName);
  } catch (err) {
    if (card.column === "done") return;
    const fails = (captureFailures.get(tmuxName) ?? 0) + 1;
    if (fails >= 3) {
      captureFailures.delete(tmuxName);
      await store.markSessionLost(card.id, session.id);
      return;
    }
    captureFailures.set(tmuxName, fails);
    if (!warnedCaptures.has(tmuxName)) {
      warnedCaptures.add(tmuxName);
      console.warn(
        `[watcher] capture failed for a session, skipping until it recovers: ${(err as Error).message}`,
      );
    }
    return;
  }

  const paneRouted =
    channel === "pane" || (channel === "auto" && session.hookRoutedAt == null);
  if (!paneRouted) return;

  if (isRecapOverlay(pane)) return;

  const prev: SessionState = {
    flip: sessions.get(tmuxName),
    agentView: agentViews.get(tmuxName),
    markerFreeStreak: markerFreeTicks.get(tmuxName) ?? 0,
  };

  let width = Number.NaN;
  let height = Number.NaN;
  const probe: ScanInput = {
    pane,
    width,
    height,
    column: card.column,
    lastMarker: session.lastMarker,
  };
  if (paneNeedsSize(probe)) {
    try {
      ({ width, height } = await paneSize(`=${tmuxName}:`));
    } catch {}
  }

  const input: ScanInput = {
    pane,
    width,
    height,
    column: card.column,
    lastMarker: session.lastMarker,
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
        `[watcher] agent-output divergence tick ${divergentTicks}/2: ${diffFingerprint(prev.flip.baseline, view)}`,
      );
    }
  }

  const decisionInputsStillLive =
    card.column === input.column && session.lastMarker === input.lastMarker;

  let flipSuppressed = false;
  if (decisionInputsStillLive) {
    switch (decision.kind) {
      case "nothing":
      case "setOutputChanged":
        break;
      case "clearLastMarker":
        await store.clearLastMarker(card.id, session.id);
        break;
      case "applyMarker": {
        const eventType =
          decision.column === "needs_input"
            ? "status_needs_input"
            : "status_agent_done";
        await store.applyMarker(
          card.id,
          session.id,
          decision.column,
          decision.reason,
          decision.key,
          eventType,
        );
        break;
      }
      case "flipBack":
        flipSuppressed = !(await store.flipBack(card.id, session.id));
        break;
    }
  }

  if (next.flip) sessions.set(tmuxName, next.flip);
  else if (!flipSuppressed) sessions.delete(tmuxName);
  if (next.agentView !== undefined) agentViews.set(tmuxName, next.agentView);
  else agentViews.delete(tmuxName);
  if (next.markerFreeStreak > 0)
    markerFreeTicks.set(tmuxName, next.markerFreeStreak);
  else markerFreeTicks.delete(tmuxName);
}

/**
 * End-of-tick reaping: per-session map cleanup + orphaned-ttyd teardown (Phase-3 review IN-04), now
 * REACHABLE via the runtime dead-session detector in the scan (a mid-run markSessionLost clears
 * that session's own `tmuxSession`, so it drops out of `sessionsWithTmux()`). Called AFTER the scan
 * loop so any markSessionLost from this tick is already reflected: for every tracked session key no
 * longer live, drop its entries from all four per-session maps and tear down its now-orphaned ttyd.
 * `sessionsWithTmux()` (Phase 91) reports every session a card owns, not just the active one, so a
 * sibling's still-live pane is never mistaken for an orphan and reaped alongside a dead one. `killTtyd`
 * is wired HERE (in the shell, never in the store) so the import direction stays acyclic
 * (watcher → ttyd → store).
 */
function reapDeadSessions(): void {
  const liveSessions = new Set(
    store
      .sessionsWithTmux()
      .map((pair) => pair.session.tmuxSession)
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
 * live SESSION serially (Phase 91: `store.sessionsWithTmux()`, every session a card owns, not
 * only its active projection — a card with N live siblings gets N scans per tick) then reaps dead
 * ones, a `scheduleNext` self-rescheduling `setTimeout` (never a fixed-interval timer that could
 * overlap a long tick) with `timer.unref?.()` so it never pins the process, a per-tick try/catch
 * so one failure never kills the loop, and an immediate first run. `statusChannel` (boot-static,
 * passed as a plain parameter because adapters must not import services' config-holder) threads
 * to the per-session gate in scanSession — it demotes marker/flip-back/dot scanning per channel,
 * while capture-failure dead-session detection and orphaned-ttyd reaping stay unconditional on
 * every channel.
 */
export function startMarkerWatcher(statusChannel: StatusChannel): void {
  async function tick(): Promise<void> {
    try {
      for (const { card, session } of store.sessionsWithTmux()) {
        await scanSession(card, session, statusChannel);
      }
      reapDeadSessions();
    } catch (err) {
      console.error(
        `[watcher] tick failed, continuing: ${(err as Error).message}`,
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
