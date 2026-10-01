/**
 * Parse a whole number of days in [0, max], or null when the text is empty, fractional or out of range.
 */
export function parseWholeDays(text: string, max: number): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const days = Number(trimmed);
  return Number.isInteger(days) && days >= 0 && days <= max ? days : null;
}
