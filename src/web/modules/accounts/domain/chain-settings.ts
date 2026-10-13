import { CLAUDE_ACCOUNTS_BOUNDS } from "../../../../shared/types.js";

/** Parse the threshold draft into a whole percent within the bounds and above `hysteresis`, or null when it is not one. */
export function parseThreshold(
  draft: string,
  hysteresis: number,
): number | null {
  if (!/^\d{1,3}$/.test(draft.trim())) return null;
  const value = Number(draft);
  const { min, max } = CLAUDE_ACCOUNTS_BOUNDS.thresholdPercent;
  return value >= min && value <= max && value > hysteresis ? value : null;
}

/** Parse the hysteresis draft into a whole number of points within the bounds and below `threshold`, or null when it is not one. */
export function parseHysteresis(
  draft: string,
  threshold: number,
): number | null {
  if (!/^\d{1,2}$/.test(draft.trim())) return null;
  const value = Number(draft);
  const { min, max } = CLAUDE_ACCOUNTS_BOUNDS.hysteresisPercent;
  return value >= min && value <= max && value < threshold ? value : null;
}
