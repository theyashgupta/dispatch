import type { Card } from "./types.js";

/**
 * A To Do card is demote-eligible only when it has never carried a live session — checked via
 * existing fields so no new field is needed, and a card that was ever started (even later dragged
 * back to To Do) never re-offers Move to Inbox. `branch` is the check that makes that claim hold
 * through Done-cleanup: finishCleanup clears the three session fields but deliberately KEEPS
 * `branch` (assigned only when a session attaches, never cleared anywhere in the store), so a
 * cleaned-up card dragged back to To Do stays ineligible. `provisioningStep`/`startError` keep
 * an actively-provisioning or failed-start card out of the Inbox, where a saga failure would
 * strand `startError` on a card that renders no error state (and hide the Retry affordance).
 * Lives in shared/ because it is used VERBATIM by both the PanelHeader demote affordance and the
 * `/move` route's server-side transition gate — one predicate, so the two can never drift.
 */
export function isDemoteEligible(card: Card): boolean {
  return (
    card.branch == null &&
    card.tmuxSession == null &&
    card.claudeSessionId == null &&
    card.workspacePath == null &&
    card.provisioningStep == null &&
    card.startError == null
  );
}
