const CARD_PRIORITY: Record<number, number> = { 1: 100, 2: 75, 3: 50, 4: 25 };

/** Map a Linear card priority (1 urgent to 4 low, 0 none) onto the 0 to 100 item scale. */
export function cardPriorityScore(priority: number): number {
  return CARD_PRIORITY[priority] ?? 0;
}
