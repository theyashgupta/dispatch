import type { Card } from "./types.js";

/** Map each card id to its identifier, for the card timeline rows. */
export function cardIdentifiers(
  cards: readonly Card[],
): Record<string, string> {
  const identifiers: Record<string, string> = {};
  for (const card of cards) identifiers[card.id] = card.identifier;
  return identifiers;
}
