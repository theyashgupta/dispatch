import type { CalendarEvent } from "./calendar-events.js";

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

type Zone =
  | { kind: "utc" }
  | { kind: "floating" }
  | { kind: "tz"; fmt: Intl.DateTimeFormat };

interface Stamp {
  wall: Wall;
  zone: Zone;
  date: boolean;
}

interface Rule {
  freq: "DAILY" | "WEEKLY";
  interval: number;
  count?: number;
  until?: number;
  byday?: number[];
  wkst: number;
}

type RawEvent = Map<string, Prop[]>;

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Partial<Record<string, number>> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 31,
  YEARLY: 366,
};
const MAX_ITERATIONS = 1000;
const STAMP_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;
const DURATION_RE =
  /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const RULE_KEYS = new Set([
  "FREQ",
  "INTERVAL",
  "COUNT",
  "UNTIL",
  "BYDAY",
  "WKST",
]);
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat | undefined {
  if (!formatters.has(tz)) {
    try {
      formatters.set(
        tz,
        new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        }),
      );
    } catch {
      return undefined;
    }
  }
  return formatters.get(tz);
}

function tzOffset(t: number, fmt: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(t)).map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second,
  );
  return asUtc - (t - (((t % 1000) + 1000) % 1000));
}

function toInstant(wall: Wall, zone: Zone): number {
  const { y, mo, d, h, mi, s } = wall;
  if (zone.kind === "floating")
    return new Date(y, mo - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (zone.kind === "utc") return guess;
  const first = guess - tzOffset(guess, zone.fmt);
  return guess - tzOffset(first, zone.fmt);
}

function addDays(wall: Wall, days: number): Wall {
  const t = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d + days));
  return {
    ...wall,
    y: t.getUTCFullYear(),
    mo: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
  };
}

function mondayIndex(wall: Wall): number {
  return (new Date(Date.UTC(wall.y, wall.mo - 1, wall.d)).getUTCDay() + 6) % 7;
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) =>
    c === "n" || c === "N" ? "\n" : c,
  );
}

function parseLine(line: string): Prop | undefined {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      const [name, ...rawParams] = line.slice(0, i).split(";");
      const params: Record<string, string> = {};
      for (const raw of rawParams) {
        const eq = raw.indexOf("=");
        if (eq > 0)
          params[raw.slice(0, eq).toUpperCase()] = raw
            .slice(eq + 1)
            .replace(/^"|"$/g, "");
      }
      return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
    }
  }
  return undefined;
}

function parseStamp(
  value: string,
  params: Record<string, string>,
): Stamp | undefined {
  const m = STAMP_RE.exec(value.trim());
  if (m === null) return undefined;
  const date = m[4] === undefined;
  const wall: Wall = {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: date ? 0 : Number(m[4]),
    mi: date ? 0 : Number(m[5]),
    s: date ? 0 : Number(m[6]),
  };
  const fmt =
    params.TZID !== undefined && !date ? formatter(params.TZID) : undefined;
  const zone: Zone =
    m[7] !== undefined
      ? { kind: "utc" }
      : fmt !== undefined
        ? { kind: "tz", fmt }
        : { kind: "floating" };
  return { wall, zone, date };
}

function parseDuration(value: string): number | undefined {
  const m = DURATION_RE.exec(value.trim());
  if (m === null) return undefined;
  const [w, d, h, mi, s] = m.slice(1).map((part) => Number(part ?? 0));
  return (((w * 7 + d) * 24 + h) * 60 + mi) * 60_000 + s * 1000;
}

function untilInstant(
  value: string | undefined,
  zone: Zone,
): number | undefined {
  const stamp = value !== undefined ? parseStamp(value, {}) : undefined;
  if (stamp === undefined) return undefined;
  const untilZone = stamp.zone.kind === "utc" ? stamp.zone : zone;
  return stamp.date
    ? toInstant(addDays(stamp.wall, 1), untilZone) - 1
    : toInstant(stamp.wall, untilZone);
}

function ruleParts(value: string): Map<string, string> {
  return new Map(
    value.split(";").map((part) => {
      const [key, v = ""] = part.split("=");
      return [key.toUpperCase(), v.toUpperCase()] as const;
    }),
  );
}

function parseRule(value: string, zone: Zone): Rule | undefined {
  const parts = ruleParts(value);
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY") return undefined;
  if ([...parts.keys()].some((key) => !RULE_KEYS.has(key))) return undefined;
  const byday = parts.get("BYDAY");
  if (
    byday !== undefined &&
    (freq !== "WEEKLY" ||
      byday.split(",").some((day) => !WEEKDAYS.includes(day)))
  ) {
    return undefined;
  }
  const wkst = WEEKDAYS.indexOf(parts.get("WKST") ?? "MO");
  if (wkst < 0) return undefined;
  const until = untilInstant(parts.get("UNTIL"), zone);
  return {
    freq,
    wkst,
    interval: Math.max(1, Number(parts.get("INTERVAL") ?? 1) || 1),
    ...(parts.has("COUNT") ? { count: Number(parts.get("COUNT")) } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(byday !== undefined
      ? {
          byday: [
            ...new Set(byday.split(",").map((day) => WEEKDAYS.indexOf(day))),
          ].sort((a, b) => a - b),
        }
      : {}),
  };
}

/**
 * Wall-clock starts of a DAILY or WEEKLY series from DTSTART up to `to`.
 *
 * @remarks Stepping wall-clock dates keeps a 10:00 meeting at 10:00 local across a DST change. After
 * the first period the series jumps whole periods to just before the window, counting the skipped
 * instances against COUNT, so a meeting that began years ago fits inside the 1000-iteration cap;
 * hitting the cap anyway reports `capped` so the pull is marked partial.
 */
function expand(
  start: Stamp,
  rule: Rule,
  spanMs: number,
  from: number,
  to: number,
): { walls: Wall[]; capped: boolean } {
  const first = toInstant(start.wall, start.zone);
  const period = rule.freq === "DAILY" ? rule.interval : 7 * rule.interval;
  const fromWeekStart = (day: number) => (day - rule.wkst + 7) % 7;
  const offsets =
    rule.freq === "DAILY"
      ? [0]
      : (rule.byday ?? [mondayIndex(start.wall)])
          .map(fromWeekStart)
          .sort((a, b) => a - b);
  let base =
    rule.freq === "DAILY"
      ? start.wall
      : addDays(start.wall, -fromWeekStart(mondayIndex(start.wall)));
  const out: Wall[] = [];
  let count = 0;
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    for (const offset of offsets) {
      const wall = addDays(base, offset);
      const t = toInstant(wall, start.zone);
      if (t < first) continue;
      if (t > (rule.until ?? Infinity) || t >= to) {
        return { walls: out, capped: false };
      }
      out.push(wall);
      count += 1;
      if (rule.count !== undefined && count >= rule.count) {
        return { walls: out, capped: false };
      }
    }
    base = addDays(base, period);
    if (i === 0) {
      const skip = Math.floor(
        (from - spanMs - 8 * DAY_MS - toInstant(base, start.zone)) /
          (period * DAY_MS),
      );
      if (skip > 0) {
        base = addDays(base, skip * period);
        count += skip * offsets.length;
        if (rule.count !== undefined && count >= rule.count) {
          return { walls: out, capped: false };
        }
      }
    }
  }
  return { walls: out, capped: true };
}

function one(event: RawEvent, name: string): Prop | undefined {
  return event.get(name)?.[0];
}

function text(event: RawEvent, name: string): string | undefined {
  const prop = one(event, name);
  return prop === undefined ? undefined : unescapeText(prop.value);
}

function stampOf(event: RawEvent, name: string): Stamp | undefined {
  const prop = one(event, name);
  return prop === undefined ? undefined : parseStamp(prop.value, prop.params);
}

function instantsOf(event: RawEvent, name: string): number[] {
  return (event.get(name) ?? []).flatMap((prop) =>
    prop.value.split(",").flatMap((value) => {
      const stamp = parseStamp(value, prop.params);
      return stamp === undefined ? [] : [toInstant(stamp.wall, stamp.zone)];
    }),
  );
}

function readBlocks(icsText: string): { events: RawEvent[]; calendar: string } {
  const lines = icsText.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: RawEvent[] = [];
  let calendar = "iCal";
  let current: RawEvent | undefined;
  let nested = 0;
  for (const line of lines) {
    const prop = parseLine(line);
    if (prop === undefined) continue;
    if (prop.name === "BEGIN") {
      if (current !== undefined) nested += 1;
      else if (prop.value.toUpperCase() === "VEVENT") current = new Map();
    } else if (prop.name === "END") {
      if (nested > 0) nested -= 1;
      else if (current !== undefined && prop.value.toUpperCase() === "VEVENT") {
        events.push(current);
        current = undefined;
      }
    } else if (current !== undefined && nested === 0) {
      current.set(prop.name, [...(current.get(prop.name) ?? []), prop]);
    } else if (current === undefined && prop.name === "X-WR-CALNAME") {
      calendar = unescapeText(prop.value).trim() || calendar;
    }
  }
  return { events, calendar };
}

function cancelled(event: RawEvent): boolean {
  return one(event, "STATUS")?.value.trim().toUpperCase() === "CANCELLED";
}

function toEvent(
  event: RawEvent,
  fallback: RawEvent,
  calendar: string,
  startMs: number,
  endMs: number,
  allDay: boolean,
): CalendarEvent {
  const pick = (name: string) => text(event, name) ?? text(fallback, name);
  const location = pick("LOCATION");
  const notes = pick("DESCRIPTION");
  const url = pick("URL");
  const conference = pick("X-GOOGLE-CONFERENCE");
  return {
    uid: (text(event, "UID") ?? "").trim(),
    title: pick("SUMMARY") ?? "",
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    allDay,
    calendar,
    ...(location !== undefined ? { location } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(conference !== undefined ? { conference } : {}),
  };
}

function span(event: RawEvent, start: Stamp): { ms: number; days: number } {
  const startMs = toInstant(start.wall, start.zone);
  const end = stampOf(event, "DTEND");
  if (start.date) {
    const endMs =
      end !== undefined
        ? toInstant(end.wall, end.zone)
        : toInstant(addDays(start.wall, 1), start.zone);
    return {
      ms: endMs - startMs,
      days: Math.max(1, Math.round((endMs - startMs) / DAY_MS)),
    };
  }
  if (end !== undefined)
    return { ms: toInstant(end.wall, end.zone) - startMs, days: 0 };
  const duration = one(event, "DURATION");
  return {
    ms: duration !== undefined ? (parseDuration(duration.value) ?? 0) : 0,
    days: 0,
  };
}

function overlaps(
  startMs: number,
  endMs: number,
  from: number,
  to: number,
): boolean {
  return (
    startMs < to && (endMs > from || (endMs === startMs && startMs >= from))
  );
}

/**
 * Whether a series the parser skips could have an instance that reaches [from, to).
 *
 * @remarks A feed carries its whole history, so a series that ended before the window must not mark
 * the pull partial, or auto-resolve would stop for good. COUNT ends a series within four times COUNT
 * gaps, where a gap is INTERVAL x the FREQ period or the longer floor its BY parts imply (a leap day
 * recurs every fourth year); an unreadable UNTIL or COUNT, or another FREQ, counts as open.
 */
function reachesWindow(
  ruleValue: string,
  start: Stamp,
  from: number,
  to: number,
): boolean {
  const startMs = toInstant(start.wall, start.zone);
  if (startMs >= to) return false;
  const parts = ruleParts(ruleValue);
  const until = untilInstant(parts.get("UNTIL"), start.zone);
  if (until !== undefined && until < from) return false;
  const count = Number(parts.get("COUNT"));
  const periodDays = PERIOD_DAYS[parts.get("FREQ") ?? ""];
  if (!(count > 0) || periodDays === undefined) return true;
  const interval = Math.max(1, Number(parts.get("INTERVAL") ?? 1) || 1);
  const gapDays = Math.max(interval * periodDays, byPartFloorDays(parts));
  return startMs + 4 * count * gapDays * DAY_MS >= from;
}

/**
 * The longest gap in days a rule's BY parts alone can put between two occurrences.
 */
function byPartFloorDays(parts: ReadonlyMap<string, string>): number {
  if (["BYMONTH", "BYYEARDAY", "BYWEEKNO"].some((k) => parts.has(k)))
    return 366;
  if (
    parts.has("BYMONTHDAY") ||
    parts.has("BYSETPOS") ||
    /\d/.test(parts.get("BYDAY") ?? "")
  ) {
    return 31;
  }
  return parts.has("BYDAY") ? 7 : 0;
}

/**
 * Read the events of an iCalendar document that overlap [from, to), expanding DAILY and WEEKLY rules.
 *
 * @remarks Any other recurrence (MONTHLY, BYMONTHDAY, a numbered BYDAY) or an RDATE is not expanded;
 * it reports partial only when it can reach the window, so the poller never auto-resolves items it
 * could not read. A VEVENT without a UID is skipped, since its item id would collide.
 */
export function parseIcs(
  icsText: string,
  from: Date,
  to: Date,
): { events: CalendarEvent[]; partial: boolean } {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const { events: raw, calendar } = readBlocks(icsText);
  const masters: [string, RawEvent][] = [];
  const masterByUid = new Map<string, RawEvent>();
  const overrides = new Map<string, RawEvent[]>();
  for (const event of raw) {
    const uid = text(event, "UID")?.trim() ?? "";
    if (uid === "") continue;
    if (one(event, "RECURRENCE-ID") === undefined) {
      masters.push([uid, event]);
      if (!masterByUid.has(uid)) masterByUid.set(uid, event);
    } else {
      overrides.set(uid, [...(overrides.get(uid) ?? []), event]);
    }
  }
  const out: CalendarEvent[] = [];
  const unreadable = new Set<string>();
  let partial = false;

  for (const [uid, master] of masters) {
    const start = stampOf(master, "DTSTART");
    if (start === undefined) continue;
    const ruleProp = one(master, "RRULE");
    const rule =
      ruleProp !== undefined
        ? parseRule(ruleProp.value, start.zone)
        : undefined;
    if (cancelled(master)) continue;
    const { ms, days } = span(master, start);
    const rdates = (master.get("RDATE") ?? []).flatMap((prop) =>
      prop.value
        .split(",")
        .map((value) => parseStamp(value.split("/")[0], prop.params)),
    );
    if (
      rdates.some(
        (stamp) =>
          stamp === undefined ||
          overlaps(
            toInstant(stamp.wall, stamp.zone),
            toInstant(stamp.wall, stamp.zone) + ms,
            fromMs,
            toMs,
          ),
      )
    ) {
      partial = true;
    }
    if (ruleProp !== undefined && rule === undefined) {
      unreadable.add(uid);
      if (reachesWindow(ruleProp.value, start, fromMs, toMs)) partial = true;
      continue;
    }
    const expanded =
      rule !== undefined
        ? expand(start, rule, ms, fromMs, toMs)
        : { walls: [start.wall], capped: false };
    if (expanded.capped) partial = true;
    const skipped = new Set([
      ...instantsOf(master, "EXDATE"),
      ...(overrides.get(uid) ?? []).flatMap((o) =>
        instantsOf(o, "RECURRENCE-ID"),
      ),
    ]);
    for (const wall of expanded.walls) {
      const startMs = toInstant(wall, start.zone);
      if (skipped.has(startMs)) continue;
      const endMs = start.date
        ? toInstant(addDays(wall, days), start.zone)
        : startMs + ms;
      if (overlaps(startMs, endMs, fromMs, toMs)) {
        out.push(toEvent(master, master, calendar, startMs, endMs, start.date));
      }
    }
  }

  for (const [uid, list] of overrides) {
    const master = masterByUid.get(uid);
    for (const override of list) {
      const start = stampOf(override, "DTSTART");
      if (
        start === undefined ||
        cancelled(override) ||
        (master !== undefined && cancelled(master))
      ) {
        continue;
      }
      const startMs = toInstant(start.wall, start.zone);
      const endMs = startMs + span(override, start).ms;
      if (unreadable.has(uid)) {
        if (overlaps(startMs, endMs, fromMs, toMs)) partial = true;
      } else if (overlaps(startMs, endMs, fromMs, toMs)) {
        out.push(
          toEvent(
            override,
            master ?? override,
            calendar,
            startMs,
            endMs,
            start.date,
          ),
        );
      }
    }
  }

  out.sort(
    (a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid),
  );
  return { events: out, partial };
}
