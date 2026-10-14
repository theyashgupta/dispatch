/**
 * Build the stale badge text "Data from 12:41", or null while the stream is up or nothing has loaded.
 *
 * @remarks The time is a 24-hour clock in the given zone, the local zone when none is given.
 */
export function staleText(
  stale: boolean,
  updatedAt: number,
  timeZone?: string,
): string | null {
  if (!stale || updatedAt === 0) return null;
  const time = new Date(updatedAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  return `Data from ${time}`;
}
