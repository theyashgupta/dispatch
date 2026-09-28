import type { SessionFilter, SessionRow } from "../../lib/sessions.js";
import { sessionSection } from "../../lib/sessions.js";

/** Keep the rows inside the live toggle, the account, the section and the text query. */
export function filterSessionRows(
  rows: readonly SessionRow[],
  filter: SessionFilter,
): SessionRow[] {
  const q = filter.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!filter.liveOnly || !row.lost) &&
      (filter.account === "" || row.account === filter.account) &&
      (filter.status === "" || sessionSection(row) === filter.status) &&
      (q === "" ||
        row.identifier.toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q)),
  );
}

/**
 * Which bulk actions a selection allows.
 *
 * @remarks Cleanup needs every selected card in Done and not cleaning up. Resume needs every row
 * lost on a card whose active session is also dead, one row per card, because resuming a sibling
 * next to a live session would move the card off its live terminal.
 */
export function bulkEligibility(selected: readonly SessionRow[]): {
  cleanup: boolean;
  resume: boolean;
} {
  if (selected.length === 0) return { cleanup: false, resume: false };
  return {
    cleanup: selected.every((r) => r.column === "done" && !r.cleaningUp),
    resume:
      selected.every((r) => r.lost && !r.cardLive) &&
      new Set(selected.map((r) => r.cardId)).size === selected.length,
  };
}
