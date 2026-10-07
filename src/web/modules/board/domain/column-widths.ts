import type { Column as ColumnId } from "../../../../shared/types.js";

export type ColumnWidthsMap = Partial<Record<ColumnId, number>>;

export const COLUMN_WIDTH_MIN = 220;
export const COLUMN_WIDTH_MAX = 480;
export const COLUMN_WIDTH_STEP = 20;

const DRAG_THRESHOLD_PX = 3;

/** Clamp a column width in pixels into the 220 to 480 range every resize path shares. */
export function clampColumnWidth(px: number): number {
  return Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, px));
}

/** True when a resize pointer travelled far enough to count as a drag rather than a click. */
export function isWidthDrag(deltaPx: number): boolean {
  return Math.abs(deltaPx) > DRAG_THRESHOLD_PX;
}

/**
 * Read the saved width map from its raw storage string.
 *
 * @remarks
 * Keeps every finite number under any key and does not clamp: stored values are clamped where they
 * are used, so one malformed entry never discards the rest of the map.
 */
export function parseColumnWidths(raw: string | null): ColumnWidthsMap {
  try {
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return {};
    const result: ColumnWidthsMap = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[key as ColumnId] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}
