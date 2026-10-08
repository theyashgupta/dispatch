import type { Card } from "./types.js";

/** True for an orchestrator session card, which the board never shows as a ticket. */
export function isHiddenCard(card: Pick<Card, "source">): boolean {
  return card.source === "orchestrator";
}
