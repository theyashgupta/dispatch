import { DONE_MARKER_PREFIX } from "../../../shared/marker-key.js";
import type { SupervisorState } from "../../../shared/types.js";

/**
 * True when a stored `released` state holds, so the supervisor leaves the session alone.
 *
 * @remarks Released means Claude exited on purpose, so no detection plans a resume or a group error.
 * The hold ends when a relaunch goes through `runClaude`, or when the pane clearly shows Claude, as after a hand-typed `claude`.
 */
export function holdsReleased(
  stored: SupervisorState | null,
  claudeShown: boolean,
): boolean {
  return stored === "released" && !claudeShown;
}

export const RELEASE_AFTER_MS = 10 * 60_000;

export interface ReleaseFacts {
  column: string;
  loopCard: boolean;
  lastMarker: string | undefined;
  engineOpen: boolean;
  storedState: SupervisorState | null;
  detectedState: SupervisorState;
  busy: boolean;
  changed: boolean;
  paused: boolean;
  starting: boolean;
  shipFlowState: "running" | "stopped" | "done" | undefined;
  columnSince: string | undefined;
  stateSince: string | undefined;
  now: number;
  afterMs: number;
}

export type ReleaseDecision = { due: true } | { due: false; reason: string };

/**
 * Decide whether a finished loop session must give its Claude process back now.
 *
 * @remarks
 * The clock starts at the later of the move to Agent done and the last state change, so a
 * revived session that goes idle again waits a full period. A stopped ship flow keeps the session,
 * because a fix instruction can still follow.
 */
export function releaseDue(f: ReleaseFacts): ReleaseDecision {
  const no = (reason: string): ReleaseDecision => ({ due: false, reason });
  if (f.storedState === "released") return no("already released");
  if (!f.loopCard) return no("not a loop card");
  if (f.column !== "agent_done") return no("card is not in agent_done");
  if (!f.lastMarker?.startsWith(DONE_MARKER_PREFIX))
    return no("last marker is not DONE");
  if (f.engineOpen) return no("engine is open");
  if (f.detectedState !== "idle" && f.detectedState !== "roadmap_complete")
    return no(`detected ${f.detectedState}`);
  if (f.busy) return no("prompt is busy");
  if (f.changed) return no("state changed this sample");
  if (f.paused) return no("card is paused");
  if (f.starting) return no("start in flight");
  if (f.shipFlowState === "running" || f.shipFlowState === "stopped")
    return no(`ship flow ${f.shipFlowState}`);
  const stamps = [f.columnSince, f.stateSince]
    .map((t) => Date.parse(t ?? ""))
    .filter(Number.isFinite);
  if (stamps.length === 0) return no("no timestamp");
  const since = Math.max(...stamps);
  return f.now - since >= f.afterMs ? { due: true } : no("timer not elapsed");
}
