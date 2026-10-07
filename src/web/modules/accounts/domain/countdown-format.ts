const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Format the time left until an ISO instant as "2 h 14 min" or "3 d 4 h".
 *
 * @remarks
 * Returns null for a missing, unreadable or past instant. Under a minute reads "under a minute".
 * A zero smaller unit is left out.
 */
export function formatTimeLeft(
  until: string | null,
  now: number,
): string | null {
  if (until === null) return null;
  const target = Date.parse(until);
  if (Number.isNaN(target)) return null;
  const left = target - now;
  if (left <= 0) return null;
  if (left < MINUTE_MS) return "under a minute";
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS);
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0)
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}

/** Format the reset countdown of a limited account, or null when there is nothing to count. */
export function formatCountdown(
  limitedUntil: string | null,
  now: number,
): string | null {
  const left = formatTimeLeft(limitedUntil, now);
  return left === null ? null : `Resets in ${left}`;
}
