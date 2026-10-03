import type { Card } from "../../../../shared/types.js";
import {
  isTicketCard,
  stateTypeRank,
} from "../../../../shared/linear-state.js";

export type TicketsGroupBy =
  "none" | "status" | "priority" | "project" | "cycle" | "team";

export interface TicketGroup {
  key: string;
  label: string;
  rows: Card[];
}

export const TICKETS_GROUP_BY: readonly TicketsGroupBy[] = [
  "none",
  "status",
  "priority",
  "project",
  "cycle",
  "team",
];

export const TICKETS_GROUP_BY_KEY = "dsp.tickets.groupBy";
const PRIORITY_GROUP: Record<number, string> = {
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

function priorityRank(priority: number): number {
  return PRIORITY_GROUP[priority] ? priority : 5;
}

/**
 * Pick the Linear cards the Tickets page lists, ordered by priority then recency.
 *
 * @remarks Priority 1 to 4 sorts first and 0 (none) last, then updatedAt descending with the id
 * as the tiebreak.
 */
export function ticketRows(cards: readonly Card[]): Card[] {
  return cards
    .filter(isTicketCard)
    .sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) ||
        a.id.localeCompare(b.id),
    );
}

/** Keep the rows whose identifier or title contains the query, ignoring case. */
export function filterTicketRows(rows: readonly Card[], query: string): Card[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter(
    (r) =>
      r.identifier.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q),
  );
}

interface Bucket {
  key: string;
  label: string;
  rank: number;
}

const LAST = Number.MAX_SAFE_INTEGER;

function bucketFor(card: Card, by: TicketsGroupBy): Bucket {
  switch (by) {
    case "none":
      return { key: "all", label: "All tickets", rank: 0 };
    case "status":
      return card.linearState
        ? {
            key: `status:${card.linearState.name}`,
            label: card.linearState.name,
            rank: stateTypeRank(card.linearState.type),
          }
        : { key: "status:none", label: "No status", rank: LAST };
    case "priority": {
      const label = PRIORITY_GROUP[card.priority];
      return label
        ? { key: `priority:${card.priority}`, label, rank: card.priority }
        : { key: "priority:none", label: "No priority", rank: LAST };
    }
    case "project":
      return card.project
        ? {
            key: `project:${card.project.id}`,
            label: card.project.name,
            rank: 0,
          }
        : { key: "project:none", label: "No project", rank: LAST };
    case "cycle":
      return card.cycle != null
        ? {
            key: `cycle:${card.cycle}`,
            label: `Cycle ${card.cycle}`,
            rank: card.cycle,
          }
        : { key: "cycle:none", label: "No cycle", rank: LAST };
    case "team":
      return card.team
        ? { key: `team:${card.team.id}`, label: card.team.name, rank: 0 }
        : { key: "team:none", label: "No team", rank: LAST };
  }
}

/**
 * Split the rows into labelled groups for one dimension, keeping the row order inside each group.
 *
 * @remarks Groups sort by rank (state type order, priority, cycle number) then label, so status,
 * project and team fall back to name order; rows without the dimension form the last group.
 */
export function groupTicketRows(
  rows: readonly Card[],
  by: TicketsGroupBy,
): TicketGroup[] {
  const buckets = new Map<string, Bucket & { rows: Card[] }>();
  for (const row of rows) {
    const b = bucketFor(row, by);
    const existing = buckets.get(b.key);
    if (existing) existing.rows.push(row);
    else buckets.set(b.key, { ...b, rows: [row] });
  }
  return [...buckets.values()]
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .map(({ key, label, rows: members }) => ({ key, label, rows: members }));
}

/**
 * Parse a stored group-by choice, falling back to status.
 *
 * @remarks A stored value may be stale or tampered, so every unknown value lands on "status".
 */
export function parseTicketsGroupBy(value: string | null): TicketsGroupBy {
  return TICKETS_GROUP_BY.find((by) => by === value) ?? "status";
}
