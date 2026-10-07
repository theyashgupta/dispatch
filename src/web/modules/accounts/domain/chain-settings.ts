export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 100;

/** Parse the threshold draft into a whole percent from 50 to 100, or null when it is not one. */
export function parseThreshold(draft: string): number | null {
  if (!/^\d{1,3}$/.test(draft.trim())) return null;
  const value = Number(draft);
  return value >= THRESHOLD_MIN && value <= THRESHOLD_MAX ? value : null;
}
