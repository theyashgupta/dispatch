import type { CalendarErrorCode, Item } from "../../../shared/types.js";

/**
 * A calendar read failure carrying only its code.
 *
 * @remarks The message is the code itself because the poller logs `err.message`, and an iCal URL or
 * a raw osascript stderr must never reach a log line.
 */
export class CalendarReadError extends Error {
  /** Wrap one error code. */
  constructor(readonly code: CalendarErrorCode) {
    super(code);
    this.name = "CalendarReadError";
  }
}

/** The read failure code of a thrown value, `failed` for anything that is not a CalendarReadError. */
export function calendarErrorCode(err: unknown): CalendarErrorCode {
  return err instanceof CalendarReadError ? err.code : "failed";
}

export interface CalendarEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  location?: string;
  notes?: string;
  url?: string;
  conference?: string;
}

const MINUTE = 60_000;
const TITLE_MAX = 300;
const NOTES_SNIPPET_MAX = 280;
const REFS_MAX = 20;
const HTTPS_URL_RE = /https:\/\/[^\s<>"'()[\]{}]+/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;
const TICKET_RE = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
const PR_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const SHORT_PR_RE = /(?<![\w./-])[\w.-]+\/[\w.-]+#\d+\b/g;

function cut(text: string, max: number): string {
  const head = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

function sameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Rank an event for the item list: running or starting soon first, then later today, then the rest.
 *
 * @remarks An all-day event has no start time worth counting down to, so it only ranks as today or
 * not today (R-21).
 */
export function calendarPriority(
  event: Pick<CalendarEvent, "start" | "end" | "allDay">,
  now: Date,
): number {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  const t = now.getTime();
  if (event.allDay) return start <= t && t < end ? 64 : 52;
  if (start <= t) return end > t ? 92 : 52;
  const until = start - t;
  if (until <= 15 * MINUTE) return 92;
  if (until <= 60 * MINUTE) return 84;
  return sameLocalDate(new Date(start), now) ? 64 : 52;
}

function httpsOnly(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  const trimmed = link.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function firstHttpsUrl(text: string | undefined): string | undefined {
  for (const match of text?.matchAll(HTTPS_URL_RE) ?? []) {
    const url = httpsOnly(match[0].replace(TRAILING_PUNCTUATION_RE, ""));
    if (url !== undefined) return url;
  }
  return undefined;
}

/** Pick the link a Join button opens: conference, event URL, location, then notes, https only. */
export function joinLink(
  event: Pick<CalendarEvent, "conference" | "url" | "location" | "notes">,
): string | undefined {
  return (
    httpsOnly(event.conference) ??
    httpsOnly(event.url) ??
    firstHttpsUrl(event.location) ??
    firstHttpsUrl(event.notes)
  );
}

/** Ticket ids and GitHub pull request references in text, de-duplicated in order of appearance. */
export function extractRefs(text: string): string[] {
  const found = [TICKET_RE, PR_URL_RE, SHORT_PR_RE]
    .flatMap((re) => [...text.matchAll(re)])
    .sort((a, b) => a.index - b.index)
    .map((match) => match[0]);
  return [...new Set(found)].slice(0, REFS_MAX);
}

/**
 * Turn one calendar event into the item the Calendar page and the Today agenda read (R-19).
 *
 * @remarks Only the first 280 characters of the notes reach the item; the rest is read for refs and
 * the join link, then dropped, because invites often carry dial-in codes and private agendas.
 */
export function eventToItem(event: CalendarEvent, now: Date): Item {
  const start = new Date(event.start).toISOString();
  const end = new Date(event.end).toISOString();
  const url = joinLink(event);
  const location = event.location?.trim() ?? "";
  const notes = event.notes?.trim() ?? "";
  const refs = extractRefs(notes);
  const title = event.title.trim() === "" ? "(No title)" : event.title.trim();
  return {
    id: `calendar:${event.uid}:${start}`,
    source: "calendar",
    type: "event",
    title: cut(title, TITLE_MAX),
    snippet: [location, cut(notes, NOTES_SNIPPET_MAX)]
      .filter((part) => part !== "")
      .join("\n\n"),
    ...(url !== undefined ? { url } : {}),
    createdAt: start,
    priority: calendarPriority({ ...event, start, end }, now),
    state: "unread",
    meta: {
      start,
      end,
      allDay: event.allDay ? "true" : "false",
      calendar: event.calendar,
      ...(url !== undefined ? { joinUrl: url } : {}),
      ...(location !== "" ? { location } : {}),
      ...(refs.length > 0 ? { refs: refs.join(",") } : {}),
    },
  };
}
