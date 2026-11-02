const formatters = new Map<string, Intl.DateTimeFormat>();

/** Returns the shared formatter for a time zone, building it once. */
function formatter(
  timeZone: string | undefined,
  kind: "time" | "weekday",
): Intl.DateTimeFormat {
  const key = `${timeZone ?? ""}|${kind}`;
  let found = formatters.get(key);
  if (found === undefined) {
    found = new Intl.DateTimeFormat(
      "en-GB",
      kind === "time"
        ? { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }
        : { weekday: "short", timeZone },
    );
    formatters.set(key, found);
  }
  return found;
}

/**
 * Formats an ISO time as a 24 hour clock time, with the short weekday in front when asked.
 *
 * @remarks Returns null for a time that does not parse, since Intl throws a RangeError on it.
 */
export function clock(
  iso: string,
  timeZone: string | undefined,
  weekday: boolean,
): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const time = formatter(timeZone, "time").format(date);
  if (!weekday) return time;
  return `${formatter(timeZone, "weekday").format(date)} ${time}`;
}
