import type { Card, Item } from "../../../../shared/types.js";

export interface AgendaDay {
  key: string;
  label: string;
  items: Item[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TITLE_MAX = 300;
const TICKET_RE = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
const MARKER = "DISPATCH_STATUS:";
const LINE_BREAK_RUN_RE =
  /[\s\u0085]*[\n\r\v\f\u0085\u2028\u2029]+[\s\u0085]*/g;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(date: Date, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  );
  if (dayKey(date) === dayKey(today)) return "Today";
  if (dayKey(date) === dayKey(tomorrow)) return "Tomorrow";
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Group calendar events from one hour ago to 48 hours ahead by local day, in start order.
 */
export function agendaDays(items: readonly Item[], now: Date): AgendaDay[] {
  const from = now.getTime() - HOUR;
  const to = now.getTime() + 48 * HOUR;
  const events = items
    .filter(
      (item) =>
        item.source === "calendar" &&
        item.type === "event" &&
        Date.parse(item.meta.start) < to &&
        Date.parse(item.meta.end) > from,
    )
    .sort(
      (a, b) =>
        Date.parse(a.meta.start) - Date.parse(b.meta.start) ||
        a.title.localeCompare(b.title),
    );
  const days = new Map<string, AgendaDay>();
  for (const item of events) {
    const start = new Date(item.meta.start);
    const shown = start.getTime() < now.getTime() ? now : start;
    const key = dayKey(shown);
    const day = days.get(key) ?? {
      key,
      label: dayLabel(shown, now),
      items: [],
    };
    day.items.push(item);
    days.set(key, day);
  }
  return [...days.values()];
}

/**
 * Return "Now" while a timed event runs, "In <n> min" when it starts within 15 minutes, else nothing.
 *
 * @remarks An all-day event gets no label: it is "in progress" all day, which would bury the
 * meetings that actually start soon.
 */
export function soonLabel(item: Item, now: Date): string | undefined {
  if (item.meta.allDay === "true") return undefined;
  const start = Date.parse(item.meta.start);
  const end = Date.parse(item.meta.end);
  const t = now.getTime();
  if (start <= t && t < end) return "Now";
  const until = start - t;
  if (until > 0 && until <= 15 * MINUTE)
    return `In ${Math.ceil(until / MINUTE)} min`;
  return undefined;
}

/** Return the row's time: "HH:MM to HH:MM" in local 24-hour time, or "All day". */
export function timeRange(item: Item): string {
  if (item.meta.allDay === "true") return "All day";
  return `${clock(new Date(item.meta.start))} to ${clock(new Date(item.meta.end))}`;
}

function unmarked(text: string): string {
  return text.replaceAll(MARKER, "DISPATCH-STATUS:");
}

function oneLine(text: string): string {
  return text.replace(LINE_BREAK_RUN_RE, " ");
}

/** Build the prepare ticket's title on one line, marker-safe and cut to 300 characters. */
export function prepareTitle(item: Item): string {
  const head = unmarked(oneLine(`Prepare: ${item.title}`)).slice(0, TITLE_MAX);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

/**
 * Build the prepare ticket's description from the time, link, refs and brief.
 *
 * @remarks Only the refs extracted on the server reach the prompt, never the invite notes, because
 * invite text is untrusted. The title, calendar name, join link and card titles are flattened to one
 * line so they cannot add prompt lines, and every status marker in the prompt is rewritten.
 */
export function preparePrompt(item: Item, cards: readonly Card[]): string {
  const start = new Date(item.meta.start);
  const weekday = start.toLocaleDateString("en-GB", { weekday: "long" });
  const refs = (item.meta.refs ?? "").split(",").filter((ref) => ref !== "");
  const tickets = refs.filter((ref) => TICKET_RE.test(ref));
  const pulls = refs.filter((ref) => !TICKET_RE.test(ref));
  const ticketLines = tickets.map((id) => {
    const card = cards.find((c) => c.identifier === id);
    return card === undefined
      ? `- ${id} (not on the board)`
      : `- ${id}: ${oneLine(card.title)}`;
  });
  return unmarked(
    [
      `Prepare the user for the meeting "${oneLine(item.title)}" at ${weekday} ${clock(start)} (${oneLine(item.meta.calendar ?? "")}).`,
      ...(item.meta.joinUrl !== undefined
        ? [`Join link: ${oneLine(item.meta.joinUrl)}`]
        : []),
      "Tickets mentioned in the invite:",
      ...(ticketLines.length > 0 ? ticketLines : ["- none"]),
      "Pull requests mentioned in the invite:",
      ...(pulls.length > 0 ? pulls.map((ref) => `- ${ref}`) : ["- none"]),
      "Gather the current state of each ticket and pull request above, then write a short brief: what each one is, where it stands, and what the user should raise in the meeting. Do not change any ticket or pull request.",
    ].join("\n"),
  );
}
