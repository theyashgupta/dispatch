import { costText } from "../../../../shared/cost-text.js";

/** Build the cost line of a group card from the orchestration summary, or null for any other card. */
export function groupCostLine(
  card: { id: string; source?: string } | null,
  groups: readonly { cardId: string; cost: number; budget: number | null }[],
): string | null {
  if (card === null || card.source !== "group") return null;
  const group = groups.find((g) => g.cardId === card.id);
  return group === undefined
    ? null
    : `Cost ${costText(group.cost, group.budget)}`;
}
