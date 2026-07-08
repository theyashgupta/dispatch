import { agentOutputView } from "./pane-view.js";
import {
  markerKey,
  normalizeMarkerKey,
  parseLastMarker,
  sameMarkerKey,
} from "./parse.js";

/**
 * The at-most-one board mutation decideScan picks for a card this tick. `setOutputChanged` and
 * `flipBack` carry NO timestamp — the shell stamps the ISO wall-clock time when it applies them,
 * keeping the decision deterministic for the replay gate.
 */
export type Decision =
  | { kind: "nothing" }
  | { kind: "clearLastMarker" }
  | {
      kind: "applyMarker";
      column: "needs_input" | "agent_done";
      reason?: string;
      key: string;
    }
  | { kind: "flipBack" }
  | { kind: "setOutputChanged" };

/**
 * The per-session state that is DECISION state (as opposed to I/O-outcome state — capture failures /
 * warn-once — which stays in the shell). The two baselines are deliberately DISTINCT fields and are
 * NEVER merged: `flip` is the MARK-03 flip-back baseline (deleted on flip-back / Agent Done) and
 * `agentView` is the ATTN-02 unseen-dot baseline (seeded once, re-baselined forward on each fire).
 * Entangling them corrupts both state machines and reopens the false-flip class (PITFALLS #6).
 */
export interface SessionState {
  /** Flip-back baseline: the `⏺` agent-output view + the geometry it was snapshotted at + the
   *  consecutive-divergence counter (2-tick debounce). Absent = no baseline (Agent Done / flipped). */
  flip?: {
    baseline: string;
    width: number;
    height: number;
    divergentTicks: number;
  };
  /** Unseen-activity dot baseline: the last observed agent-output view. Absent = never observed
   *  (seed on first sight, never fire on the seed). */
  agentView?: string;
  /** Consecutive marker-free ticks while out of an attention column but still holding a dedup key
   *  (2-tick clear debounce). 0 = no streak / reset. */
  markerFreeStreak: number;
}

/**
 * Everything decideScan needs about this tick, all pre-fetched by the shell. `width`/`height` are the
 * pane geometry probed by the shell; the shell passes `NaN` for BOTH when it did not fetch geometry
 * this tick (the branch does not need it) OR when the geometry probe threw (the session vanished
 * mid-tick) — the geometry-consuming branches guard on `Number.isFinite` and reproduce the original
 * "no baseline this round" handling on `NaN`.
 */
export interface ScanInput {
  pane: string;
  width: number;
  height: number;
  column: string;
  lastMarker?: string;
}

/**
 * True iff the pre-extraction watcher would have probed pane geometry for this tick — i.e. a fresh
 * NEEDS_INPUT marker fires (snapshot a flip baseline) OR a needs_input card reaches the flip-back
 * step (compare / re-baseline). The shell calls this to keep the geometry-probe subprocess LAZY on
 * exactly the same branches as before the extraction (identical subprocess-call set), rather than
 * eagerly probing geometry every tick. Pure: parses the marker but never touches geometry or I/O.
 *
 * @remarks Mirrors decideScan's geometry-reading branches one-for-one so the shell's placeholder
 * `NaN` geometry is never actually read on a `false` result.
 * @see docs/ARCHITECTURE.md#watcher-discriminator
 */
export function paneNeedsSize(input: ScanInput): boolean {
  if (input.column === "done" || input.column === "todo") return false;
  const marker = parseLastMarker(input.pane);
  if (marker) {
    const key = markerKey(marker);
    if (!sameMarkerKey(key, input.lastMarker)) {
      return marker.kind === "NEEDS_INPUT";
    }
    const markerColumn =
      marker.kind === "NEEDS_INPUT" ? "needs_input" : "agent_done";
    if (input.column === markerColumn && input.lastMarker != null) {
      const revealed = normalizeMarkerKey(key);
      const stored = normalizeMarkerKey(input.lastMarker);
      if (revealed.length > stored.length && revealed.startsWith(stored)) {
        return false;
      }
    }
    return input.column === "needs_input";
  }
  if (
    input.lastMarker &&
    input.column !== "needs_input" &&
    input.column !== "agent_done"
  ) {
    return false;
  }
  return input.column === "needs_input";
}

/**
 * Decide at most ONE board mutation for this tick and return the next per-session decision state.
 *
 * Lifts the per-tick decision logic from the pre-extraction `scanSession` VERBATIM in meaning:
 *   - ATTN-02 unseen-dot (step 1c): seed the dot baseline on first sight (no fire), else stamp
 *     `setOutputChanged` on the FIRST divergence and re-baseline forward. Conveyed via `next.agentView`
 *     (the shell stamps from the transition) so it can co-occur with a marker/flip decision in the
 *     same tick, exactly as before. Runs for done cards too (dot-only bail).
 *   - MARK-04 dedup-key liveness (step 3a): out of an attention column with a stale key and no marker
 *     on the pane, clear the key only after TWO consecutive marker-free ticks (IN-06 hardening).
 *   - MARK-01/02 + BUG-1 dedup + fire (step 3b): a genuinely new marker (width-invariant prefix test)
 *     moves the card and, for NEEDS_INPUT, snapshots the flip baseline; a re-seen marker at a wider
 *     capture grows the key monotonically (never re-fires / re-snapshots).
 *   - MARK-03 flip-back (step 4): a needs_input card returns to In Progress once the `⏺` agent-output
 *     view diverges from the marker-time baseline for TWO consecutive ticks; a width OR height change
 *     re-snapshots the baseline (never flips); a re-converge before the 2nd tick resets the streak.
 *
 * The `flip` (flip-back) and `agentView` (dot) baselines are kept DISTINCT — never merged (PITFALLS
 * #6). Geometry-consuming branches treat `NaN` width/height as "session vanished mid-tick" and
 * reproduce the original "no baseline this round" handling.
 *
 * @remarks Pure decision authority for the watcher — the single seam the replay gate records against.
 * @see docs/ARCHITECTURE.md#watcher-discriminator
 */
export function decideScan(
  input: ScanInput,
  prev: SessionState,
): { decision: Decision; next: SessionState } {
  const view = agentOutputView(input.pane);
  let nextAgentView = prev.agentView;
  let dotFired = false;
  if (prev.agentView === undefined) {
    nextAgentView = view;
  } else if (view !== prev.agentView) {
    nextAgentView = view;
    dotFired = true;
  }

  let nextFlip = prev.flip;
  let nextStreak = prev.markerFreeStreak;
  let decision: Decision = dotFired
    ? { kind: "setOutputChanged" }
    : { kind: "nothing" };

  const mk = (): { decision: Decision; next: SessionState } => ({
    decision,
    next: {
      flip: nextFlip,
      agentView: nextAgentView,
      markerFreeStreak: nextStreak,
    },
  });

  if (input.column === "done") return mk();

  const marker = parseLastMarker(input.pane);

  if (
    !marker &&
    input.lastMarker &&
    input.column !== "needs_input" &&
    input.column !== "agent_done"
  ) {
    const streak = nextStreak + 1;
    if (streak >= 2) {
      nextStreak = 0;
      decision = { kind: "clearLastMarker" };
    } else {
      nextStreak = streak;
    }
    return mk();
  }
  nextStreak = 0;

  if (marker) {
    const key = markerKey(marker);
    const column = marker.kind === "NEEDS_INPUT" ? "needs_input" : "agent_done";
    const reason = marker.reason === "" ? undefined : marker.reason;
    if (!sameMarkerKey(key, input.lastMarker)) {
      decision = { kind: "applyMarker", column, reason, key };
      if (marker.kind === "NEEDS_INPUT") {
        if (Number.isFinite(input.width) && Number.isFinite(input.height)) {
          nextFlip = {
            baseline: view,
            width: input.width,
            height: input.height,
            divergentTicks: 0,
          };
        } else {
          nextFlip = undefined;
        }
      } else {
        nextFlip = undefined;
      }
      return mk();
    }
    if (input.column === column && input.lastMarker != null) {
      const revealed = normalizeMarkerKey(key);
      const stored = normalizeMarkerKey(input.lastMarker);
      if (revealed.length > stored.length && revealed.startsWith(stored)) {
        decision = { kind: "applyMarker", column, reason, key };
        return mk();
      }
    }
  }

  if (input.column === "needs_input") {
    const cached = nextFlip;
    if (cached == null) {
      if (Number.isFinite(input.width) && Number.isFinite(input.height)) {
        nextFlip = {
          baseline: view,
          width: input.width,
          height: input.height,
          divergentTicks: 0,
        };
      }
      return mk();
    }
    if (!Number.isFinite(input.width) || !Number.isFinite(input.height)) {
      return mk();
    }
    if (input.width !== cached.width || input.height !== cached.height) {
      nextFlip = {
        baseline: view,
        width: input.width,
        height: input.height,
        divergentTicks: 0,
      };
    } else if (view !== cached.baseline) {
      const divergentTicks = cached.divergentTicks + 1;
      if (divergentTicks >= 2) {
        decision = { kind: "flipBack" };
        nextFlip = undefined;
      } else {
        nextFlip = { ...cached, divergentTicks };
      }
    } else if (cached.divergentTicks > 0) {
      nextFlip = { ...cached, divergentTicks: 0 };
    }
  }

  return mk();
}
