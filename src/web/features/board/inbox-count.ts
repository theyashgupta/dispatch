import type { Card } from "../../../shared/types.js";

/**
 * The single predicate for "this card is a ticket waiting in the Inbox".
 * @remarks Excluding group members matches the counting convention already used by
 * `buildWorkspaceGroups` (orca-selectors.ts) and `StatusPillSwitcher`'s per-column count — a
 * deliberate alignment, not an arbitrary choice. Exported (rather than inlined per call site) so
 * the strip badge, the To Do empty state, the Inbox list and its project filter cannot drift onto
 * two different definitions of the same number. A member is also not independently promotable —
 * `/move` 409s it via `groupedMemberError` — so it must never render its own Inbox row.
 */
export function isInboxWaiting(card: Card): boolean {
  return card.column === "inbox" && card.groupId == null;
}

/** Counts cards waiting in the Inbox, excluding group members. */
export function inboxWaitingCount(cards: Card[]): number {
  return cards.filter(isInboxWaiting).length;
}
