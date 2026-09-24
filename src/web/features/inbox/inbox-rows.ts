import type { Card, FilterOption, Item } from "../../../shared/types.js";
import type { InboxRowModel } from "../../lib/actions.js";

export type InboxRange = "all" | "today" | "3d" | "week";
export type InboxGroupBy = "none" | "source" | "type";

interface InboxFilter {
  query: string;
  sources: string[];
  range: InboxRange;
  unreadOnly: boolean;
  now: number;
}

interface InboxGroup {
  key: string;
  label: string;
  rows: InboxRowModel[];
}

const CARD_PRIORITY: Record<number, number> = { 1: 100, 2: 75, 3: 50, 4: 25 };
const ACRONYMS: Record<string, string> = { pr: "PR", ci: "CI" };
const DAY_MS = 86_400_000;

/** Turn a connector type key such as `pr_review` into the label `PR review`. */
export function humanizeType(type: string): string {
  return capitalize(
    type
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => ACRONYMS[w] ?? w)
      .join(" "),
  );
}

function itemRow(item: Item): InboxRowModel {
  return {
    kind: "item",
    id: item.id,
    source: item.source,
    title: item.title,
    snippet: item.snippet,
    priority: item.priority,
    time: item.createdAt,
    unread: item.state === "unread",
    url: item.url,
    typeLabel: humanizeType(item.type),
    item,
  };
}

function cardRow(card: Card, opened: boolean): InboxRowModel {
  return {
    kind: "card",
    id: card.id,
    source: card.source ?? "linear",
    title: card.title,
    snippet: card.description ?? "",
    priority: CARD_PRIORITY[card.priority] ?? 0,
    time: card.updatedAt,
    unread: !opened,
    url: card.url,
    typeLabel: "Ticket",
    project: card.project?.name,
    card,
  };
}

/**
 * One ranked list from items and Inbox cards.
 *
 * @remarks Card priority maps onto the item scale (1 to 100, 2 to 75, 3 to 50, 4 to 25, 0 to 0) so
 * one comparator orders both kinds: priority descending, then time descending, id as the tiebreak.
 */
export function mergeInboxRows(
  items: readonly Item[],
  cards: readonly Card[],
  lastOpened: Record<string, unknown>,
): InboxRowModel[] {
  return [
    ...items.map(itemRow),
    ...cards.map((c) => cardRow(c, lastOpened[c.id] != null)),
  ].sort(
    (a, b) =>
      b.priority - a.priority ||
      (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0) ||
      a.id.localeCompare(b.id),
  );
}

function rangeStart(range: InboxRange, now: number): number {
  switch (range) {
    case "all":
      return 0;
    case "today":
      return new Date(now).setHours(0, 0, 0, 0);
    case "3d":
      return now - 3 * DAY_MS;
    case "week":
      return now - 7 * DAY_MS;
  }
}

function matchesQuery(row: InboxRowModel, q: string): boolean {
  return (
    row.title.toLowerCase().includes(q) ||
    (row.card?.identifier.toLowerCase().includes(q) ?? false)
  );
}

/** Keep the rows inside the source set, the time range, the unread toggle and the text query. */
export function filterInboxRows(
  rows: readonly InboxRowModel[],
  filter: InboxFilter,
): InboxRowModel[] {
  const q = filter.query.trim().toLowerCase();
  const start = rangeStart(filter.range, filter.now);
  return rows.filter(
    (row) =>
      (filter.sources.length === 0 || filter.sources.includes(row.source)) &&
      (filter.range === "all" || Date.parse(row.time) >= start) &&
      (!filter.unreadOnly || row.unread) &&
      (q === "" || matchesQuery(row, q)),
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Bucket rows by source or type, keeping the incoming order inside each group. */
export function groupInboxRows(
  rows: readonly InboxRowModel[],
  by: InboxGroupBy,
): InboxGroup[] {
  if (by === "none") return [{ key: "all", label: "All", rows: [...rows] }];
  const groups = new Map<string, InboxGroup>();
  for (const row of rows) {
    const label =
      by === "source" ? capitalize(row.source) : row.typeLabel || "Other";
    const group = groups.get(label) ?? { key: label, label, rows: [] };
    group.rows.push(row);
    groups.set(label, group);
  }
  return [...groups.values()];
}

/** Ids of the item rows a Mark all read call should touch: visible and unread, never a card. */
export function visibleUnreadIds(rows: readonly InboxRowModel[]): string[] {
  return rows.filter((r) => r.kind === "item" && r.unread).map((r) => r.id);
}

/** The PRIORITY_DOT key for a merged priority: 100 to 1, 75 to 2, 50 to 3, 25 to 4, below that none. */
export function priorityDotKey(priority: number): number | undefined {
  if (priority >= 100) return 1;
  if (priority >= 75) return 2;
  if (priority >= 50) return 3;
  if (priority >= 25) return 4;
  return undefined;
}

/** The source filter's options: every source present in the rows, capitalised, sorted. */
export function rowSourceOptions(
  rows: readonly InboxRowModel[],
): FilterOption[] {
  const ids = new Set(rows.map((r) => r.source));
  return [...ids]
    .map((id) => ({ id, label: capitalize(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
