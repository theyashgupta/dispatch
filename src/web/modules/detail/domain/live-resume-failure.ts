import type { Card } from "../../../../shared/types.js";

/**
 * The alert copy for a live session whose supervisor resume failed, or null.
 *
 * @remarks A lost session shows its refusal in the lost-session panel instead. Only a status reason
 * with the supervisor `resume: ` lead is shown, because a card already in Needs input keeps its
 * older reason.
 */
export function liveResumeFailure(card: Card): string | null {
  if (!card.tmuxSession || card.sessionLost) return null;
  if (card.state !== "needs_input" || card.stateReason !== "resume_failed")
    return null;
  const copy = /^resume: (.+)/.exec(card.statusReason ?? "")?.[1]?.trim();
  return copy ? copy : null;
}
