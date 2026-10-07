import type { Column as ColumnId } from "../../../../shared/types.js";

export const ACTIVE_RATIO = 0.6;

/**
 * The carousel column to mark active: the entry with the highest visible ratio that reaches 0.6.
 *
 * @remarks
 * Entries arrive in board column order and only a strictly higher ratio replaces the leader, so a
 * tie keeps the earlier column. With no qualifying entry the current column stays.
 */
export function pickActiveColumn(
  entries: readonly { column: ColumnId; ratio: number }[],
  current: ColumnId | null,
): ColumnId | null {
  let best: ColumnId | null = null;
  let bestRatio = 0;
  for (const { column, ratio } of entries) {
    if (ratio >= ACTIVE_RATIO && ratio > bestRatio) {
      best = column;
      bestRatio = ratio;
    }
  }
  return best ?? current;
}
