import { permissionFromStatus } from "../../shared/calendar-permission.js";
import type {
  CalendarChoice,
  CalendarErrorCode,
  CalendarPermission,
} from "../../shared/types.js";
import {
  CalendarReadError,
  type CalendarEvent,
} from "../sources/calendar/calendar-events.js";
import {
  helperPath,
  helperRead,
  helperRequest,
  helperStatus,
  parseHelperAnswer,
  statusErrorCode,
} from "./calendar-helper.js";
import { run } from "./exec.js";

export { calendarErrorCode } from "../sources/calendar/calendar-events.js";

const READ_TIMEOUT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 120_000;
const KILL_ESCALATION_MS = 5_000;
const NOTES_MAX = 4000;
const MAX_BUFFER = 16 * 1024 * 1024;

const IGNORED_CALENDAR_RE = /birthday|holiday|siri suggestions/i;

export const SCRIPT_MARKER = "dispatch-calendar:";

const mark = (kind: string): string => `"${SCRIPT_MARKER}${kind}";`;

const AUTHORIZATION_STATUS = `ObjC.import("EventKit");
function authorizationStatus() {
  return Number($.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent));
}
`;

export const EVENTS_SCRIPT = `${mark("events")}
${AUTHORIZATION_STATUS}
function run(argv) {
  var args = JSON.parse(argv[0] || "{}");
  if (args.selftest) return JSON.stringify({ selftest: "ok" });
  var store = $.EKEventStore.alloc.init;
  var status = authorizationStatus();
  if (status !== 3) return JSON.stringify({ error: "calendar-denied", status: status });
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
 * @remarks `calendar-denied` maps through its raw status, and a missing or invalid status is `unknown`;
 * `calendars-missing` keeps its code. Any other error field or shape is `failed`, never the raw text.
 */
function scriptAnswer(
  stdout: string,
  key: string,
): { list: unknown[]; body: Record<string, unknown> } {
  const { status, body } = parseHelperAnswer(stdout);
  if (body.error === "calendar-denied") {
    throw new CalendarReadError(statusErrorCode(status));
  }
  if (body.error === "calendars-missing") {
    throw new CalendarReadError("calendars-missing");
  }
  const list = body[key];
  if (!Array.isArray(list)) throw new CalendarReadError("failed");
  return { list, body };
}

/**
 * Validate a reader answer from the helper or the script and return its events.
 *
 * @remarks A denied answer maps to its permission code and any other bad shape is `failed`. An event
 * with a missing field is dropped rather than failing the whole read, so one odd entry cannot hide the day.
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

const CALENDARS_SCRIPT = `${mark("calendars")}
${AUTHORIZATION_STATUS}
function run() {
  var store = $.EKEventStore.alloc.init;
  var status = authorizationStatus();
  if (status !== 3) return JSON.stringify({ error: "calendar-denied", status: status });
  var calendars = ObjC.unwrap(store.calendarsForEntityType($.EKEntityTypeEvent)).map(function (c) {
    return { title: ObjC.unwrap(c.title) || "", source: ObjC.unwrap(c.source.title) || "" };
  });
  return JSON.stringify({ calendars: calendars });
}
`;

const STATUS_SCRIPT = `${mark("status")}
${AUTHORIZATION_STATUS}
function run() {
  return JSON.stringify({ status: authorizationStatus() });
}
`;

const REQUEST_SCRIPT = `${mark("request")}
${AUTHORIZATION_STATUS}
function authorize(store, waitMs) {
  var status = authorizationStatus();
  if (status === 0 && waitMs > 0) {
    var answered = false;
    var done = function () { answered = true; };
    if (store.respondsToSelector("requestFullAccessToEventsWithCompletion:")) {
      store.requestFullAccessToEventsWithCompletion(done);
    } else {
      store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, done);
    }
    var deadline = Date.now() + waitMs;
    while (!answered && Date.now() < deadline) {
      $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));
    }
    status = authorizationStatus();
  }
  return status;
}
function run(argv) {
  var args = JSON.parse(argv[0] || "{}");
  return JSON.stringify({ status: authorize($.EKEventStore.alloc.init, args.seconds * 1000) });
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

type TimeoutCode = "read-timeout" | "prompt-timeout";

/** Map an osascript failure to a code without passing its stderr on; a killed child gives `timeoutCode`. */
export function osascriptError(
  err: unknown,
  timeoutCode: TimeoutCode = "read-timeout",
): CalendarErrorCode {
  const stderr = (err as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.includes("-1743")) {
    return "calendar-denied";
  }
  return (err as { killed?: unknown }).killed === true ? timeoutCode : "failed";
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
  timeoutCode: TimeoutCode = "read-timeout",
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
    throw new CalendarReadError(osascriptError(err, timeoutCode));
  }
}

/**
 * Read the Calendar permission state without requesting access.
 *
 * @remarks A killed status read gives `read-timeout`; any other failure is thrown for the caller to map.
 */
export async function readPermission(
  timeoutMs = READ_TIMEOUT_MS,
): Promise<CalendarPermission> {
  try {
    const app = helperPath();
    const status =
      app !== null
        ? await helperStatus(app, timeoutMs)
        : parseHelperAnswer(await runScript(STATUS_SCRIPT, [], timeoutMs))
            .status;
    return permissionFromStatus(status);
  } catch (err) {
    if (err instanceof CalendarReadError && err.code === "read-timeout") {
      return "read-timeout";
    }
    throw err;
  }
}

/**
 * Ask macOS for full Calendar access and return the permission state once answered or when the wait ends.
 *
 * @remarks The only call that can raise the macOS prompt, and it never throws: a kill or a status still
 * `not-asked` after the wait gives `prompt-timeout`, and any other failure gives `unknown`.
 */
export async function requestCalendarAccess(
  timeoutMs = PROMPT_TIMEOUT_MS,
): Promise<CalendarPermission> {
  try {
    const app = helperPath();
    const status =
      app !== null
        ? await helperRequest(app, timeoutMs)
        : parseHelperAnswer(
            await runScript(
              REQUEST_SCRIPT,
              [JSON.stringify({ seconds: Math.floor(timeoutMs / 1000) })],
              timeoutMs + KILL_ESCALATION_MS,
              "prompt-timeout",
            ),
          ).status;
    const permission = permissionFromStatus(status);
    return permission === "not-asked" ? "prompt-timeout" : permission;
  } catch (err) {
    return err instanceof CalendarReadError && err.code === "prompt-timeout"
      ? "prompt-timeout"
      : "unknown";
  }
}

/**
 * Read this Mac's events in [from, to) through the helper app, or osascript JXA when it is absent.
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
  const app = helperPath();
  if (app !== null) {
    return parseMacOutput(await helperRead(app, "events", args, timeoutMs));
  }
  return parseMacOutput(await runScript(EVENTS_SCRIPT, [args], timeoutMs));
}

/** List this Mac's calendars by title, for the settings checklist (U4-03). */
export async function listMacCalendars(
  timeoutMs = READ_TIMEOUT_MS,
): Promise<CalendarChoice[]> {
  const app = helperPath();
  if (app !== null) {
    return parseMacCalendars(
      await helperRead(app, "calendars", undefined, timeoutMs),
    );
  }
  return parseMacCalendars(await runScript(CALENDARS_SCRIPT, [], timeoutMs));
}
