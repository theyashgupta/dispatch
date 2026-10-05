export const BOARD_REFRESH_GAP_MS = 5_000;

/**
 * Return how long a board-driven inventory refetch waits before it may run.
 *
 * @remarks
 * A refetch inside the gap waits for the remainder, so frames from every card change collapse
 * into one fetch per gap. The Refresh button does not call this: it always fetches with `fresh`.
 */
export function inventoryRefetchDelay(sinceLastMs: number): number {
  return Math.max(0, BOARD_REFRESH_GAP_MS - sinceLastMs);
}
