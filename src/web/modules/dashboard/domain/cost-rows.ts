import { dollars } from "../../../../shared/cost-text.js";

export interface CostRow {
  cardId: string;
  groupId: string;
  percent: number | null;
  text: string;
  near: boolean;
}

/**
 * Builds the cost bar rows of the groups, with the near budget mark at `nearPercent` of the budget and the over budget mark above 100 percent.
 *
 * @remarks A budget that an owner orchestrator override set names that orchestrator, so the user knows where to change it.
 */
export function costRows(
  groups: readonly {
    cardId: string;
    groupId: string;
    cost: number;
    budget: number | null;
    ownerName?: string | null;
  }[],
  nearPercent: number,
): CostRow[] {
  return groups.map(({ cardId, groupId, cost, budget, ownerName }) => {
    if (budget === null || budget <= 0) {
      return {
        cardId,
        groupId,
        percent: null,
        text: `${dollars(cost)}, no budget`,
        near: false,
      };
    }
    const percent = Math.round((cost / budget) * 100);
    const near = cost >= (budget * nearPercent) / 100;
    const base = `${dollars(cost)} of ${dollars(budget)}, ${percent}%`;
    const over = cost > budget;
    const text = over
      ? `${base}, over budget`
      : near
        ? `${base}, near budget`
        : base;
    return {
      cardId,
      groupId,
      percent,
      text: ownerName == null ? text : `${text}, budget set by ${ownerName}`,
      near,
    };
  });
}
