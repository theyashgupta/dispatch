import type { PrRow, PrStateText } from "../../../../shared/pr-rows.js";
import type { PrTone } from "./pr-detail-state.js";

export interface PrChip {
  label: string;
  tone: PrTone;
}

export type PrGroupBy = "repo" | "state" | "none";

export interface PrGroup {
  key: string;
  label: string;
  rows: PrRow[];
}

export const PR_GROUP_BY_KEY = "dsp.prs.groupBy";

export const PR_GROUP_BY_LABELS: Record<PrGroupBy, string> = {
  repo: "Group by repository",
  state: "Group by state",
  none: "No grouping",
};

const CHECKS_CHIP: Record<PrRow["checks"], PrChip> = {
  pass: { label: "Checks pass", tone: "success" },
  fail: { label: "Checks fail", tone: "danger" },
  pending: { label: "Checks pending", tone: "warning" },
  "": { label: "No checks", tone: "neutral" },
};

const REVIEW_CHIP: Record<PrStateText, PrChip> = {
  "Review requested from me": { label: "Review requested", tone: "accent" },
  "Changes requested": { label: "Changes requested", tone: "warning" },
  Approved: { label: "Approved", tone: "success" },
  Draft: { label: "Draft", tone: "neutral" },
  Open: { label: "Awaiting review", tone: "neutral" },
};

const MERGEABLE_CHIP: Record<PrRow["mergeable"], PrChip> = {
  mergeable: { label: "Mergeable", tone: "success" },
  conflicting: { label: "Conflicts", tone: "danger" },
  unknown: { label: "Merge unknown", tone: "neutral" },
};

const STATE_ORDER: readonly PrStateText[] = [
  "Review requested from me",
  "Changes requested",
  "Open",
  "Approved",
  "Draft",
];

export function prChips(row: PrRow): PrChip[] {
  return [
    CHECKS_CHIP[row.checks],
    REVIEW_CHIP[row.state],
    MERGEABLE_CHIP[row.mergeable],
  ];
}

/**
 * Split the rows into labelled groups, keeping the row order inside each group.
 *
 * @remarks Repository groups sort by repository name and state groups follow the review chip
 * order. A group with no row is never returned, and "none" returns one group keyed "all".
 */
export function groupPrRows(
  rows: readonly PrRow[],
  groupBy: PrGroupBy,
): PrGroup[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "All pull requests", rows: [...rows] }];
  }
  if (groupBy === "state") {
    return STATE_ORDER.map((state) => ({
      key: state,
      label: REVIEW_CHIP[state].label,
      rows: rows.filter((row) => row.state === state),
    })).filter((group) => group.rows.length > 0);
  }
  const byRepo = new Map<string, PrRow[]>();
  for (const row of rows) {
    const members = byRepo.get(row.repo);
    if (members) members.push(row);
    else byRepo.set(row.repo, [row]);
  }
  return [...byRepo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, members]) => ({ key: repo, label: repo, rows: members }));
}

/**
 * Parse a stored group-by choice, falling back to repository.
 *
 * @remarks A stored value may be stale or tampered, so every unknown value lands on "repo".
 */
export function parsePrGroupBy(value: string | null): PrGroupBy {
  return value === "state" || value === "none" ? value : "repo";
}

export function initialsOf(author: string): string {
  return author === "" ? "?" : author.slice(0, 2).toUpperCase();
}
