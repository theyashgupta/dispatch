export interface CostRow {
  cardId: string;
  groupId: string;
  percent: number | null;
  text: string;
  near: boolean;
}

const NEAR_RATIO = 0.8;

/** Formats an amount as dollars with two decimals, such as "$12.40". */
export function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Builds the cost bar rows of the groups, with the near budget mark at 80 percent of the budget.
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
    const near = cost / budget >= NEAR_RATIO;
    const base = `${dollars(cost)} of ${dollars(budget)}, ${percent}%`;
    const text = near ? `${base}, near budget` : base;
    return {
      cardId,
      groupId,
      percent,
      text: ownerName == null ? text : `${text}, budget set by ${ownerName}`,
      near,
    };
  });
}
