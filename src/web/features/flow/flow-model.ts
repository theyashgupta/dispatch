import type { Card, Item } from "../../../shared/types.js";
import { chainPath, type Rect } from "../../lib/flow-geometry.js";
import { formatAge } from "../../lib/format-age.js";

export const FLOW_SOURCES = [
  { id: "github", label: "GitHub" },
  { id: "linear", label: "Linear" },
  { id: "slack", label: "Slack" },
  { id: "sentry", label: "Sentry" },
  { id: "meeting", label: "Meetings" },
  { id: "calendar", label: "Calendar" },
] as const;

export const TRAYS = [
  { id: "urgent", label: "Urgent", color: "var(--prio-urgent)" },
  { id: "today", label: "Today", color: "var(--prio-high)" },
  { id: "week", label: "This week", color: "var(--prio-medium)" },
  { id: "fyi", label: "FYI", color: "var(--text-muted)" },
] as const;

export type TrayId = (typeof TRAYS)[number]["id"];
export type PollerTone = "ok" | "stale" | "down";

export interface FlowRow {
  id: string;
  source: string;
  score: number;
  createdAt: string;
}

export interface SourceNode {
  id: string;
  label: string;
  lit: boolean;
  count: number;
}

export const STAGE_WIDTH = 1000;
export const STAGE_HEIGHT = 560;

export const SOURCE_RECTS: Record<string, Rect> = Object.fromEntries(
  FLOW_SOURCES.map((s, i) => [s.id, { x: 40, y: 40 + i * 80, w: 200, h: 56 }]),
);
export const POLLER_RECT: Rect = { x: 380, y: 232, w: 180, h: 96 };
export const TRIAGE_RECT: Rect = { x: 610, y: 252, w: 150, h: 56 };
export const TRAY_RECTS = Object.fromEntries(
  TRAYS.map((t, i) => [t.id, { x: 820, y: 40 + i * 130, w: 150, h: 80 }]),
) as Record<TrayId, Rect>;

export const POLLER_TONE_COLOR: Record<PollerTone, string> = {
  ok: "var(--status-ok)",
  stale: "var(--status-stale)",
  down: "var(--status-down)",
};

const CARD_SCORE: Record<number, number> = { 1: 100, 2: 75, 3: 50, 4: 25 };

/**
 * The rows the diagram counts: non-done items and Inbox cards, on one score scale.
 *
 * @remarks Card priority maps onto the item scale the same way the Inbox ranks them, so a card and
 * an item with the same urgency land in the same tray.
 */
export function flowRows(
  items: readonly Item[],
  cards: readonly Card[],
): FlowRow[] {
  return [
    ...items
      .filter((i) => i.state !== "done")
      .map((i) => ({
        id: i.id,
        source: i.source,
        score: i.priority,
        createdAt: i.createdAt,
      })),
    ...cards
      .filter((c) => c.column === "inbox")
      .map((c) => ({
        id: c.id,
        source: c.source ?? "linear",
        score: CARD_SCORE[c.priority] ?? 0,
        createdAt: c.updatedAt,
      })),
  ];
}

/** The tray a score lands in: urgent from 90, today from 70, this week from 40, FYI below. */
export function trayOf(score: number): TrayId {
  if (score >= 90) return "urgent";
  if (score >= 70) return "today";
  if (score >= 40) return "week";
  return "fyi";
}

/** The fixed source list, each lit only when its id is enabled, with its row count. */
export function sourceNodes(
  enabledSources: readonly string[],
  rows: readonly FlowRow[],
): SourceNode[] {
  return FLOW_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    lit: enabledSources.includes(s.id),
    count: rows.filter((r) => r.source === s.id).length,
  }));
}

/** Count the rows in each tray. */
export function trayCounts(rows: readonly FlowRow[]): Record<TrayId, number> {
  const counts: Record<TrayId, number> = {
    urgent: 0,
    today: 0,
    week: 0,
    fyi: 0,
  };
  for (const row of rows) counts[trayOf(row.score)] += 1;
  return counts;
}

/**
 * The rows that were not in the previous frame.
 *
 * @remarks A null previous set marks the first frame, which is a baseline: rows present at mount
 * never animate.
 */
export function diffArrivals(
  previousIds: ReadonlySet<string> | null,
  rows: readonly FlowRow[],
): FlowRow[] {
  if (previousIds === null) return [];
  return rows.filter((r) => !previousIds.has(r.id));
}

/**
 * The poller dot tone: down while unreachable, stale past two poll intervals, ok otherwise.
 *
 * @remarks The stale rule matches SyncStatus, which keeps it inline with no export to share.
 */
export function pollerTone(
  syncedAt: string | null,
  pollIntervalMs: number | undefined,
  syncUnreachable: boolean | undefined,
  now: number,
): PollerTone {
  if (syncUnreachable) return "down";
  const synced = syncedAt === null ? NaN : Date.parse(syncedAt);
  if (
    Number.isFinite(synced) &&
    pollIntervalMs != null &&
    now - synced > 2 * pollIntervalMs
  ) {
    return "stale";
  }
  return "ok";
}

/** The poller's last sync line: "Last sync 3m ago", or "Never synced" before the first poll. */
export function syncLine(syncedAt: string | null, now: number): string {
  if (syncedAt === null) return "Never synced";
  const age = formatAge(syncedAt, now);
  return age === "" ? "Never synced" : `Last sync ${age}`;
}

/** The path a row's token rides: its source node, the poller, triage, then its tray. */
export function ridePath(row: FlowRow): string {
  const head = Object.hasOwn(SOURCE_RECTS, row.source)
    ? [SOURCE_RECTS[row.source]]
    : [];
  return chainPath([
    ...head,
    POLLER_RECT,
    TRIAGE_RECT,
    TRAY_RECTS[trayOf(row.score)],
  ]);
}

/** The newest row by createdAt, or null when there are none. */
export function latestRow(rows: readonly FlowRow[]): FlowRow | null {
  let latest: FlowRow | null = null;
  let latestAt = -Infinity;
  for (const row of rows) {
    const at = Date.parse(row.createdAt);
    if (at > latestAt) {
      latest = row;
      latestAt = at;
    }
  }
  return latest;
}
