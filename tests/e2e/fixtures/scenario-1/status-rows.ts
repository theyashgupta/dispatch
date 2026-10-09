const READY_ROWS = ["  ? for shortcuts", "  Opus ctx 10%"];

/** The footer a session shows before the loop sets its own meters; the start saga waits for it. */
export function readyRows(): string[] {
  return [...READY_ROWS];
}

/**
 * The two status rows of a Claude session at a context percent, in the grammar `parseStatusLine` reads.
 *
 * @remarks The bar has ten cells, so 55 percent fills six.
 */
export function meterRows(percent: number, cost: string): string[] {
  const filled = Math.round(percent / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  return [
    `Opus 5.5 │ ${bar} ${percent}% ${percent * 2}k/200k`,
    `GROUP │ 5h 10% │ 7d 20% │ $${cost}`,
  ];
}
