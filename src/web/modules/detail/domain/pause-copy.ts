import {
  hasLiveSession,
  isLoopCard,
} from "../../../../shared/running-group.js";
import type { Card } from "../../../../shared/types.js";

export interface PauseRefusal {
  status: number | null;
  error?: string;
  reason?: string;
}

const NETWORK_COPY = "Couldn't reach the server. Try again.";

/**
 * Map a refused pause or unpause to the toast copy.
 *
 * @remarks A 404 reads as a vanished card, and any status the map does not name, including a null status, reads as the network copy.
 */
export function pauseFailureCopy(result: PauseRefusal): string {
  switch (result.error) {
    case "already-paused":
      return "This loop is already paused.";
    case "not-paused":
      return "This loop is not paused.";
    case "not-pausable":
      return `Can't pause: ${result.reason}.`;
    case "busy":
      return "Another action is running on this card. Try again.";
    case "unpause-incomplete":
      return `Can't resume: ${result.reason}.`;
  }
  return result.status === 404 ? "This card no longer exists." : NETWORK_COPY;
}

/** The note the detail panel shows for a paused card, or null when the card is not paused. */
export function pausedNote(card: Card): string | null {
  if (!card.paused) return null;
  return card.paused.by === "memory"
    ? "Paused for memory. Dispatch resumes it when swap falls."
    : "Paused. Resume it when you are ready.";
}

/** Which header button the detail panel shows: Resume for a paused card, Pause for a live loop card, else none. */
export function pauseAction(card: Card): "pause" | "resume" | null {
  if (card.paused) return "resume";
  return isLoopCard(card) && hasLiveSession(card) ? "pause" : null;
}

/** The title that disables Run Claude on a paused card, or null when the card is not paused. */
export function runClaudeBlocked(card: Card): string | null {
  return card.paused ? "Resume the loop first" : null;
}
