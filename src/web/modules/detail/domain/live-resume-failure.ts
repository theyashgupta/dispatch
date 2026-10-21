import type { Card } from "../../../../shared/types.js";

/**
 * The alert copy for a live session the supervisor refused to relaunch, or null.
 *
 * @remarks A lost session shows its refusal in the lost-session panel instead, so only a live
 * tmux session gets this copy. The `resume: ` lead is the supervisor evidence prefix.
 */
export function liveResumeFailure(card: Card): string | null {
  if (!card.tmuxSession || card.sessionLost) return null;
  if (card.state !== "needs_input" || card.stateReason !== "resume_failed")
    return null;
  const copy = card.statusReason?.replace(/^resume: /, "").trim();
  return copy ? copy : null;
}
