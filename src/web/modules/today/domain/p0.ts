import type { Card, Item } from "../../../../shared/types.js";
import { cardPriorityScore } from "../../../../shared/card-priority.js";
import { COLUMN_LABELS } from "../../../../shared/event-copy.js";

export type TodayWindow = "today" | "week";

export interface TodayEntry {
  key: string;
  kind: "card" | "item";
  tier: 1 | 2 | 3 | 4 | 5;
  source: string;
  title: string;
  time: string;
  priority: number;
  chips: string[];
  actionLabel: string;
  card?: Card;
  item?: Item;
}

const WEEK_MS = 604_800_000;
const AGENT_DONE_FLOOR = 75;

function cardTier(card: Card): TodayEntry["tier"] | null {
  if (card.column === "needs_input") return 1;
  if (card.priority === 1 && card.column !== "done" && card.column !== "parked")
    return 2;
  if (card.column === "agent_done") return 5;
  return null;
}

function cardAction(card: Card): string {
  if (card.column === "needs_input") return "Answer the agent";
  if (card.column === "agent_done") return "Review the result";
  if (card.column === "todo") return "Start";
  return "Open";
}

function cardEntry(card: Card, tier: TodayEntry["tier"]): TodayEntry {
  const mapped = cardPriorityScore(card.priority);
  return {
    key: card.id,
    kind: "card",
    tier,
    source: card.source ?? "linear",
    title: card.title,
    time: card.updatedAt,
    priority:
      card.column === "agent_done"
        ? Math.max(mapped, AGENT_DONE_FLOOR)
        : mapped,
    chips: [card.identifier, COLUMN_LABELS[card.column]],
    actionLabel: cardAction(card),
    card,
  };
}

function itemTier(item: Item): TodayEntry["tier"] {
  if (item.type === "pr_review") return 3;
  if (item.type.endsWith("mention")) return 4;
  return 5;
}

function itemChips(item: Item): string[] {
  const m = item.meta;
  if (item.source === "github") {
    const author = m.author?.trim();
    return [`${m.repo}#${m.number}`, author ? `by ${author}` : ""].filter(
      Boolean,
    );
  }
  if (item.source === "sentry")
    return [m.shortId ?? "", m.project ?? ""].filter(Boolean);
  const origin = m.channel ?? m.from;
  return origin ? [origin] : [];
}

function itemAction(item: Item): string {
  if (item.type === "pr_review") return "Review";
  if (item.type.endsWith("mention")) return "Reply";
  if (item.source === "sentry") return "Fix with agent";
  return "Open";
}

function itemEntry(item: Item): TodayEntry {
  return {
    key: item.id,
    kind: "item",
    tier: itemTier(item),
    source: item.source,
    title: item.title,
    time: item.createdAt,
    priority: item.priority,
    chips: itemChips(item),
    actionLabel: itemAction(item),
    item,
  };
}

function windowStart(window: TodayWindow, now: number): number {
  if (window === "week") return now - WEEK_MS;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime();
}

function timeOf(entry: TodayEntry): number {
  const t = Date.parse(entry.time);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function compareEntries(a: TodayEntry, b: TodayEntry): number {
  return (
    a.tier - b.tier ||
    b.priority - a.priority ||
    timeOf(b) - timeOf(a) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/**
 * Build the ordered Today pool from the board cards and the feed-filtered items.
 *
 * @remarks Cards waiting for input and finished agent results ignore the window because a column
 * move never bumps card.updatedAt (U3-04), so their age says nothing about whether they wait on
 * the user.
 */
export function rankToday(
  cards: readonly Card[],
  items: readonly Item[],
  window: TodayWindow,
  now: number,
): TodayEntry[] {
  const start = windowStart(window, now);
  const entries: TodayEntry[] = [];
  for (const card of cards) {
    if (card.groupId != null) continue;
    const tier = cardTier(card);
    if (tier !== null) entries.push(cardEntry(card, tier));
  }
  for (const item of items) {
    if (item.state === "done" || item.state === "snoozed") continue;
    entries.push(itemEntry(item));
  }
  return entries
    .filter(
      (entry) =>
        entry.tier === 1 ||
        entry.card?.column === "agent_done" ||
        timeOf(entry) >= start,
    )
    .sort(compareEntries);
}

export const P0_COUNTS = [3, 4, 5] as const;

/** Clamp a requested pick count to the 3 to 5 range the P0 card offers. */
export function clampCount(count: number): number {
  return Math.min(5, Math.max(3, Math.trunc(count) || 3));
}

/** Take the first picks from an already ranked pool, clamped to 3 to 5 entries. */
export function topPicks(
  pool: readonly TodayEntry[],
  count: number,
): TodayEntry[] {
  return pool.slice(0, clampCount(count));
}
