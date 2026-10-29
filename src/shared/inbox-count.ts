import type { Card, Item } from "./types.js";

/**
 * Whether a card is a ticket waiting in the Inbox: in the Inbox, not dismissed, not a group member.
 *
 * @remarks Exported so the strip badge, the To Do empty state and the Inbox list cannot drift onto two definitions of the same number. A member is excluded because `/move` 409s it via `groupedMemberError`, and this matches `StatusPillSwitcher`.
 */
export function isInboxWaiting(card: Card): boolean {
  return (
    card.column === "inbox" &&
    card.groupId == null &&
    card.inboxDismissedAt == null
  );
}

/**
 * Whether a card is a dismissed Inbox ticket, shown under Dismissed.
 *
 * @remarks Group members are excluded for the same reason as {@link isInboxWaiting}.
 */
export function isInboxDismissed(card: Card): boolean {
  return (
    card.column === "inbox" &&
    card.groupId == null &&
    card.inboxDismissedAt != null
  );
}

/** Counts the Inbox rows: cards waiting (group members excluded) plus the listed items. */
export function inboxWaitingCount(
  cards: readonly Card[],
  items: readonly Item[] = [],
): number {
  return cards.filter(isInboxWaiting).length + items.length;
}
