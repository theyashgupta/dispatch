import { ARCHIVE_RETENTION_MAX_DAYS } from "../../../shared/types.js";

/** Parse the retention input: a whole number of days in [0, 365], or null when invalid. */
export function parseArchiveRetention(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const days = Number(trimmed);
  return Number.isInteger(days) &&
    days >= 0 &&
    days <= ARCHIVE_RETENTION_MAX_DAYS
    ? days
    : null;
}
