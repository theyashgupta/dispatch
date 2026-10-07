import type { SessionTurnState } from "../../../../shared/types.js";

const TURN_LABELS: Record<SessionTurnState, string> = {
  idle: "Idle",
  busy: "Working",
  limit: "At usage limit",
  unknown: "Unknown",
};

/** Name a turn state in words for a session row. */
export function turnLabel(turn: SessionTurnState): string {
  return TURN_LABELS[turn];
}
