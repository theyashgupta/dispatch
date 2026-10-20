/** Format a cost as "$X of $Y" with a budget, else "$X". */
export function costText(cost: number, budget: number | null): string {
  return budget === null
    ? `$${cost.toFixed(2)}`
    : `$${cost.toFixed(2)} of $${budget.toFixed(2)}`;
}
