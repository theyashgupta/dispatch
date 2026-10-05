import type { Item } from "../../../../shared/types.js";
import { isWebUrl } from "../../../../shared/item-actions.js";
import { topPicks, type TodayEntry, type TodayWindow } from "./p0.js";
import type { Page } from "../../../../shared/route.js";

export interface Paged<T> {
  rows: T[];
  page: number;
  pages: number;
}

export interface SourceCount {
  source: string;
  count: number;
}

export interface TodayModel {
  picks: TodayEntry[];
  chips: SourceCount[];
  filter: string | null;
  list: Paged<TodayEntry>;
}

export type EntryTarget =
  { kind: "card"; cardId: string } | { kind: "page"; page: Page; id?: string };

export const TODAY_PAGE_SIZE = 10;

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Return the greeting for the local hour: morning before 12:00, afternoon before 18:00, evening after. */
export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Format the long local date under the greeting, for example "Friday 25 September". */
export function longDate(now: Date): string {
  return DATE_FORMAT.format(now);
}

/** Slice one page of rows, clamping the page number into the 1 to page-count range. */
export function paginate<T>(
  rows: readonly T[],
  page: number,
  size: number,
): Paged<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(pages, Math.max(1, Math.trunc(page) || 1));
  const from = (current - 1) * size;
  return { rows: rows.slice(from, from + size), page: current, pages };
}

/** Count the pool per source, largest first, ties by source id. */
export function sourceCounts(pool: readonly TodayEntry[]): SourceCount[] {
  const counts = new Map<string, number>();
  for (const entry of pool) {
    counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1);
  }
  return [...counts]
    .map(([source, count]) => ({ source, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
    );
}

/**
 * Derive everything the Today page renders from the ranked pool.
 *
 * @remarks The picks always come from the unfiltered pool (the chip filter never touches the P0
 * card), and a filter whose source has left the pool reads as no filter, so the list can never be
 * stranded empty behind a chip that no longer renders.
 */
export function buildTodayModel(
  pool: readonly TodayEntry[],
  count: number,
  filter: string | null,
  page: number,
): TodayModel {
  const chips = sourceCounts(pool);
  const active = chips.some((chip) => chip.source === filter) ? filter : null;
  const rows = active ? pool.filter((entry) => entry.source === active) : pool;
  return {
    picks: topPicks(pool, count),
    chips,
    filter: active,
    list: paginate(rows, page, TODAY_PAGE_SIZE),
  };
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Keep the calendar events that start on the local date of `now`, earliest first. */
export function agendaItems(items: readonly Item[], now: Date): Item[] {
  return items
    .filter((item) => {
      if (item.source !== "calendar" || item.type !== "event") return false;
      const start = Date.parse(item.meta.start ?? "");
      return !Number.isNaN(start) && sameLocalDay(new Date(start), now);
    })
    .sort((a, b) => Date.parse(a.meta.start) - Date.parse(b.meta.start));
}

/**
 * Return the agenda rows to render, empty unless a calendar source is enabled.
 *
 * @remarks Calendar items stay in the board after the source is turned off, so the enabled-source
 * check keeps the agenda hidden until the Calendar source is on again.
 */
export function visibleAgenda(
  enabledSources: readonly string[] | undefined,
  items: readonly Item[],
  now: Date,
): Item[] {
  if (!enabledSources?.includes("calendar")) return [];
  return agendaItems(items, now);
}

/** Format an event start as local 24-hour HH:MM. */
export function agendaTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/**
 * Return an event's join link only when it is an http or https URL.
 *
 * @remarks The link is provider data that reaches window.open; any other scheme (javascript:,
 * data:, a relative path) would run in the app's origin, so it gets no Join button at all.
 */
export function joinLink(item: Item): string | null {
  const url = item.meta.joinUrl;
  return isWebUrl(url) ? url : null;
}

/** Decide where a click on a Today entry goes: the card panel or a source page (U3-07). */
export function entryTarget(entry: TodayEntry): EntryTarget {
  if (entry.card) return { kind: "card", cardId: entry.card.id };
  const item = entry.item;
  if (item?.source === "github")
    return { kind: "page", page: "pull-requests", id: item.id };
  if (item?.source === "sentry")
    return { kind: "page", page: "errors", id: item.id };
  return { kind: "page", page: "inbox" };
}

/** Read a stored window choice, falling back to "today" for anything but "week". */
export function parseRange(raw: string | null): TodayWindow {
  return raw === "week" ? "week" : "today";
}
