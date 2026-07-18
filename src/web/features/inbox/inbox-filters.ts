import type { Card, FilterOption } from "../../../shared/types.js";

export function inboxProjectOptions(cards: Card[]): FilterOption[] {
  const byId = new Map<string, string>();
  for (const c of cards) {
    if (c.column === "inbox" && c.project)
      byId.set(c.project.id, c.project.name);
  }
  return [...byId]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function matchesSearch(card: Card, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    card.title.toLowerCase().includes(q) ||
    card.identifier.toLowerCase().includes(q)
  );
}

/**
 * A To Do card is demote-eligible only when it has never carried a live session — checked via
 * existing fields so no new field is needed, and a card that was ever started (even later dragged
 * back to To Do) never re-offers Move to Inbox. `branch` is the check that makes that claim hold
 * through Done-cleanup: finishCleanup clears the three session fields but deliberately KEEPS
 * `branch` (assigned only when a session attaches, never cleared anywhere in the store), so a
 * cleaned-up card dragged back to To Do stays ineligible. `provisioningStep`/`startError` keep
 * an actively-provisioning or failed-start card out of the Inbox, where a saga failure would
 * strand `startError` on a card that renders no error state (and hide the Retry affordance).
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
