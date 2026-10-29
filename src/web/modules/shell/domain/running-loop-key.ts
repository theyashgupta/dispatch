import { isActiveCard } from "../../../../shared/running-group.js";
import type { Card } from "../../../../shared/types.js";

/** The sorted ids of the running group cards, joined with commas, so a start or stop changes the key. */
export function runningLoopKey(cards: readonly Card[]): string {
  return cards
    .filter((card) => card.source === "group" && isActiveCard(card))
    .map((card) => card.id)
    .sort()
    .join(",");
}
