/** Format an amount as dollars with two decimals, such as "$12.40". */
export function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Format a cost as "$X of $Y" with a budget, else "$X". */
export function spentOfBudget(cost: number, budget: number | null): string {
  return budget === null
    ? dollars(cost)
    : `${dollars(cost)} of ${dollars(budget)}`;
}
