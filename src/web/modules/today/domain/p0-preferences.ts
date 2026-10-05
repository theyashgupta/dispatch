import { clampCount } from "./p0.js";

/** Parse a stored P0 pick count, falling back to 3 for a missing or invalid value and clamping to 3 to 5. */
export function parseCount(raw: string | null): number {
  return clampCount(Number(raw));
}
