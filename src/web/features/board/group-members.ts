import type { Card } from "../../../shared/types.js";

/**
 * Derives a group card's members from the full snapshot instead of a duplicated wire shape —
 * members are ordinary cards already present in the SSE snapshot, linked back via `groupId`.
 */
export function membersOf(card: Card, allCards: Card[]): Card[] {
  return allCards.filter((c) => c.groupId === card.id);
}
