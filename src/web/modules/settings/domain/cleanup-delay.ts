import { parseWholeDays } from "../../../../shared/whole-days.js";

export const CLEANUP_DELAY_MAX_DAYS = 90;

/** Parse the cleanup delay input: a whole number of days in [0, 90], or null when invalid. */
export function parseCleanupDelay(text: string): number | null {
  return parseWholeDays(text, CLEANUP_DELAY_MAX_DAYS);
}
