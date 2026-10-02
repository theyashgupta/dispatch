import { ARCHIVE_RETENTION_MAX_DAYS } from "./types.js";
import { parseWholeDays } from "./whole-days.js";

/** Parse the retention input: a whole number of days in [0, 365], or null when invalid. */
export function parseArchiveRetention(text: string): number | null {
  return parseWholeDays(text, ARCHIVE_RETENTION_MAX_DAYS);
}
