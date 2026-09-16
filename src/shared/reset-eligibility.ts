import type { Card } from "./types.js";

/**
 * Whether Reset (LOCAL-20) applies: the card still holds a session, a workspace or a local branch.
 * @remarks Reads only the flat projection so the wire card and the store card agree. Groups and
 * their members are excluded because Unwind is their teardown path.
 */
export function isResetEligible(card: Card): boolean {
  if (card.source === "group" || card.groupId != null) return false;
  return (
    card.tmuxSession != null ||
    card.workspacePath != null ||
    card.branch != null ||
    card.sessionLost === true
  );
}
