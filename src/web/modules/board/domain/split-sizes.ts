type SplitSizes = { primary: number; secondary: number };

const DEFAULT_SIZES: SplitSizes = { primary: 50, secondary: 50 };

/**
 * Read the stored pane sizes: two positive percentages summing to 100 within 1, else the 50/50 default.
 *
 * @remarks A pair that does not sum to 100 would mount the panels at a layout the group rejects, so it is treated as corrupt.
 */
export function parseSplitSizes(raw: unknown): SplitSizes {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SIZES;
  const { primary, secondary } = raw as Record<string, unknown>;
  if (
    typeof primary !== "number" ||
    typeof secondary !== "number" ||
    !(primary > 0) ||
    !(secondary > 0) ||
    Math.abs(primary + secondary - 100) > 1
  ) {
    return DEFAULT_SIZES;
  }
  return { primary, secondary };
}
