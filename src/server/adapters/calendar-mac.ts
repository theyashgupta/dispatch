import type { CalendarChoice, CalendarErrorCode } from "../../shared/types.js";
import {
  CalendarReadError,
  type CalendarEvent,
} from "../sources/calendar/calendar-events.js";
import { run } from "./exec.js";

export { calendarErrorCode } from "../sources/calendar/calendar-events.js";

const READ_TIMEOUT_MS = 30_000;
const KILL_ESCALATION_MS = 5_000;
const NOTES_MAX = 4000;
const MAX_BUFFER = 16 * 1024 * 1024;

const IGNORED_CALENDAR_RE = /birthday|holiday|siri suggestions/i;

const AUTHORIZE = `ObjC.import("EventKit");
function authorized(store) {
  var status = $.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent);
  if (status === 0) {
    var answered = false;
    var done = function () { answered = true; };
    if (store.respondsToSelector("requestFullAccessToEventsWithCompletion:")) {
      store.requestFullAccessToEventsWithCompletion(done);
    } else {
      store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, done);
    }
    var deadline = Date.now() + 25000;
    while (!answered && Date.now() < deadline) {
      $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));
    }
    status = $.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent);
  }
  return status === 3;
}
`;

export const EVENTS_SCRIPT = `${AUTHORIZE}
function run(argv) {
  var args = JSON.parse(argv[0] || "{}");
  if (args.selftest) return JSON.stringify({ selftest: "ok" });
  var store = $.EKEventStore.alloc.init;
  if (!authorized(store)) return JSON.stringify({ error: "calendar-denied" });
  var ignored = new RegExp(args.ignored, "i");
  var wanted = args.calendars || [];
  var titles = [];
  var calendars = ObjC.unwrap(store.calendarsForEntityType($.EKEntityTypeEvent)).filter(function (c) {
    var title = ObjC.unwrap(c.title);
    titles.push(title);
    return wanted.length > 0 ? wanted.indexOf(title) >= 0 : !ignored.test(title);
  });
  if (calendars.length === 0) {
    return JSON.stringify(wanted.length > 0 ? { error: "calendars-missing" } : { events: [] });
  }
  var partial = wanted.some(function (t) { return titles.indexOf(t) < 0; });
  var from = $.NSDate.dateWithTimeIntervalSince1970(Date.parse(args.from) / 1000);
  var to = $.NSDate.dateWithTimeIntervalSince1970(Date.parse(args.to) / 1000);
  var predicate = store.predicateForEventsWithStartDateEndDateCalendars(from, to, $(calendars));
  var iso = function (d) { return new Date(d.timeIntervalSince1970 * 1000).toISOString(); };
  var text = function (v) { var s = ObjC.unwrap(v); return typeof s === "string" && s !== "" ? s : undefined; };
  var events = ObjC.unwrap(store.eventsMatchingPredicate(predicate)).map(function (e) {
    var notes = text(e.notes);
    return {
      uid: text(e.calendarItemExternalIdentifier) || text(e.eventIdentifier) || "",
      title: text(e.title) || "",
      start: iso(e.startDate),
      end: iso(e.endDate),
      allDay: e.allDay === true,
      location: text(e.location),
      url: e.URL.isNil() ? undefined : text(e.URL.absoluteString),
      notes: notes === undefined ? undefined : notes.slice(0, ${NOTES_MAX}),
      calendar: text(e.calendar.title) || ""
    };
  });
  return JSON.stringify({ events: events, partial: partial });
}
`;

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function toMacEvent(raw: unknown): CalendarEvent | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const e = raw as Record<string, unknown>;
  if (
    typeof e.uid !== "string" ||
    e.uid === "" ||
    typeof e.title !== "string" ||
    typeof e.start !== "string" ||
    typeof e.end !== "string" ||
    Number.isNaN(Date.parse(e.start)) ||
    Number.isNaN(Date.parse(e.end)) ||
    typeof e.allDay !== "boolean" ||
    typeof e.calendar !== "string"
  ) {
    return undefined;
  }
  const location = optionalText(e.location);
  const url = optionalText(e.url);
  const notes = optionalText(e.notes)?.slice(0, NOTES_MAX);
  return {
    uid: e.uid,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    calendar: e.calendar,
    ...(location !== undefined ? { location } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

/**
 * Parse a script's JSON answer and return the array under `key` with the whole body.
 *
 * @remarks `calendar-denied` keeps its code; any other error field or shape is `failed`, never the raw
 * text.
 */
function scriptAnswer(
  stdout: string,
  key: string,
): { list: unknown[]; body: Record<string, unknown> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new CalendarReadError("failed");
  }
  const body = (
    typeof parsed === "object" && parsed !== null ? parsed : {}
  ) as Record<string, unknown>;
  if (body.error === "calendar-denied") {
    throw new CalendarReadError("calendar-denied");
  }
  const list = body[key];
  if (!Array.isArray(list)) throw new CalendarReadError("failed");
  return { list, body };
}

/**
 * Validate the reader script's JSON; calendar-denied keeps its code, any other answer is failed.
 *
 * @remarks An event with a missing field is dropped rather than failing the whole read, so one odd
 * calendar entry cannot hide the rest of the day.
 */
export function parseMacOutput(stdout: string): {
  events: CalendarEvent[];
  partial: boolean;
} {
  const { list, body } = scriptAnswer(stdout, "events");
  return {
    events: list.flatMap((raw) => toMacEvent(raw) ?? []),
    partial: body.partial === true,
  };
}

const CALENDARS_SCRIPT = `${AUTHORIZE}
function run() {
  var store = $.EKEventStore.alloc.init;
  if (!authorized(store)) return JSON.stringify({ error: "calendar-denied" });
  var calendars = ObjC.unwrap(store.calendarsForEntityType($.EKEntityTypeEvent)).map(function (c) {
    return { title: ObjC.unwrap(c.title) || "", source: ObjC.unwrap(c.source.title) || "" };
  });
  return JSON.stringify({ calendars: calendars });
}
`;

function parseMacCalendars(stdout: string): CalendarChoice[] {
  return scriptAnswer(stdout, "calendars").list.flatMap((raw: unknown) => {
    const c = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    if (typeof c.title !== "string" || c.title === "") return [];
    return [
      {
        title: c.title,
        source: typeof c.source === "string" ? c.source : "",
        ignoredByDefault: IGNORED_CALENDAR_RE.test(c.title),
      },
    ];
  });
}

/** Map an osascript failure to a code without passing its stderr on. */
export function osascriptError(err: unknown): CalendarErrorCode {
  const stderr = (err as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.includes("-1743")) {
    return "calendar-denied";
  }
  return (err as { killed?: unknown }).killed === true ? "timeout" : "failed";
}

/**
 * Run one JXA script under osascript and return its stdout, or throw its failure code.
 *
 * @remarks The script travels on stdin and its arguments as one JSON argv element, so no calendar
 * title or other config text is ever spliced into script source.
 * @see docs/ARCHITECTURE.md#calendar-source
 */
async function runScript(
  script: string,
  argv: string[],
  timeoutMs: number,
): Promise<string> {
  try {
    const { stdout } = await run(
      "osascript",
      ["-l", "JavaScript", "-", ...argv],
      {
        input: script,
        timeout: timeoutMs,
        killEscalationMs: KILL_ESCALATION_MS,
        maxBuffer: MAX_BUFFER,
      },
    );
    return stdout;
  } catch (err) {
    throw new CalendarReadError(osascriptError(err));
  }
}

/**
 * Read this Mac's events in [from, to) through EventKit, by osascript JXA.
 *
 * @remarks When no saved title matches a calendar the read fails, so a renamed calendar keeps the last
 * good items. When only some match, the rest are read and the pull is partial, so nothing auto-resolves.
 */
export async function readMacEvents(
  from: Date,
  to: Date,
  calendars: readonly string[],
  timeoutMs = READ_TIMEOUT_MS,
): Promise<{ events: CalendarEvent[]; partial: boolean }> {
  const args = JSON.stringify({
    from: from.toISOString(),
    to: to.toISOString(),
    calendars,
    ignored: IGNORED_CALENDAR_RE.source,
  });
  return parseMacOutput(await runScript(EVENTS_SCRIPT, [args], timeoutMs));
}

/** List this Mac's calendars by title, for the settings checklist (U4-03). */
export async function listMacCalendars(
  timeoutMs = READ_TIMEOUT_MS,
): Promise<CalendarChoice[]> {
  return parseMacCalendars(await runScript(CALENDARS_SCRIPT, [], timeoutMs));
}
