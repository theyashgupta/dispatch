import type { WorktreeRow } from "../../../../shared/types.js";

export interface WorkspacesSummary {
  count: number;
  totalKb: number;
  unknownSizes: number;
}

export type WorktreeSortKey = "due" | "size" | "age";

export const WORKTREE_SORT_LABELS: Record<WorktreeSortKey, string> = {
  due: "Sort by due date",
  size: "Sort by size",
  age: "Sort by age",
};

function nullsLast(
  a: number | null,
  b: number | null,
  order: (x: number, y: number) => number,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return order(a, b);
}

const ascending = (x: number, y: number) => x - y;
const descending = (x: number, y: number) => y - x;

/**
 * Order worktree rows by due date (soonest), size (largest) or age (oldest commit), nulls last.
 */
export function sortWorktreeRows(
  rows: readonly WorktreeRow[],
  key: WorktreeSortKey,
): WorktreeRow[] {
  const primary = (a: WorktreeRow, b: WorktreeRow): number => {
    if (key === "due")
      return nullsLast(a.cleanupDueAt, b.cleanupDueAt, ascending);
    if (key === "size") return nullsLast(a.sizeKb, b.sizeKb, descending);
    return nullsLast(a.lastCommitAt, b.lastCommitAt, ascending);
  };
  return [...rows].sort(
    (a, b) =>
      primary(a, b) ||
      a.identifier.localeCompare(b.identifier) ||
      a.sessionId.localeCompare(b.sessionId),
  );
}

export interface WorktreeActions {
  editor: "code" | "cursor" | null;
  cleanup: boolean;
}

/**
 * Decide a worktree row's actions: the editor on the active session, cleanup on a Done card.
 *
 * @remarks The open-editor route opens the card's active workspace, so offering it on a sibling
 * session would open a different folder than the row shows.
 */
export function worktreeActions(
  row: WorktreeRow,
  editors: { code: boolean; cursor: boolean } | undefined,
): WorktreeActions {
  const cleanup = row.column === "done";
  if (!row.active) return { editor: null, cleanup };
  const editor = editors?.code ? "code" : editors?.cursor ? "cursor" : null;
  return { editor, cleanup };
}
