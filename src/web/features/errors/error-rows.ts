import type { Item } from "../../../shared/types.js";
import { isListedError } from "../../lib/feed-items.js";

export type ErrorGroupBy = "project" | "level";

export interface ErrorRow {
  key: string;
  issueId: string;
  shortId: string;
  title: string;
  culprit: string;
  project: string;
  level: string;
  assigned: boolean;
  count: number;
  time: string;
  unread: boolean;
  url?: string;
  itemId: string;
  cardId?: string;
}

export interface ErrorGroup {
  key: string;
  label: string;
  rows: ErrorRow[];
}

/** Build one row per Sentry item that is neither done nor snoozed, ordered by priority then recency. */
export function buildErrorRows(items: readonly Item[]): ErrorRow[] {
  const ranked = items.filter(isListedError).map((item) => {
    const count = Number(item.meta.count);
    const row: ErrorRow = {
      key: item.id,
      issueId: item.id.replace(/^sentry:/, ""),
      shortId: item.meta.shortId ?? "",
      title: item.title,
      culprit: item.meta.culprit ?? "",
      project: item.meta.project ?? "",
      level: item.meta.level ?? "",
      assigned: item.meta.category === "assigned",
      count: Number.isFinite(count) ? count : 0,
      time: item.createdAt,
      unread: item.state === "unread",
      url: item.url,
      itemId: item.id,
      cardId: item.cardId,
    };
    return { row, priority: item.priority };
  });
  ranked.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.row.time.localeCompare(a.row.time) ||
      a.row.key.localeCompare(b.row.key),
  );
  return ranked.map((entry) => entry.row);
}

/** Group rows by project or level, keeping each group's rows in their incoming order. */
export function groupErrorRows(
  rows: readonly ErrorRow[],
  by: ErrorGroupBy,
): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const row of rows) {
    const key = by === "project" ? row.project : row.level;
    const label =
      by === "project"
        ? row.project || "No project"
        : row.level
          ? row.level.charAt(0).toUpperCase() + row.level.slice(1)
          : "Unknown";
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Map a Sentry level to the chip tone it renders with. */
export function levelTone(level: string): "danger" | "warning" | "neutral" {
  if (level === "fatal" || level === "error") return "danger";
  if (level === "warning") return "warning";
  return "neutral";
}
