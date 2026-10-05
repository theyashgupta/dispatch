export const SPLIT_WIDTH_MIN = 320;
export const SPLIT_WIDTH_MAX = 720;
export const SPLIT_WIDTH_DEFAULT = 480;

/**
 * Resolve a stored list pane width to a usable pixel width.
 *
 * @remarks
 * A missing or non-number value gives the default, and a number outside the drag range is clamped.
 * Every caller routes through here, so a hand-edited storage entry never sizes a pane out of range.
 */
export function clampSplitWidth(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return SPLIT_WIDTH_DEFAULT;
  }
  return Math.min(SPLIT_WIDTH_MAX, Math.max(SPLIT_WIDTH_MIN, Math.round(raw)));
}
