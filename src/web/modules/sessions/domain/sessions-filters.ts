import type { SessionFilter, SessionRow } from "../../../../shared/sessions.js";
import { sessionSection } from "../../../../shared/sessions.js";

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
 * The filter state after a toolbar edit, keeping a chosen account whose sessions are gone.
 *
 * @remarks The toolbar shows `shown`, with that account cleared, but legacy kept the raw account in
 * state, so the filter applies again when the account's sessions come back.
 */
export function applyFilterEdit(
  next: SessionFilter,
  shown: SessionFilter,
  current: SessionFilter,
): SessionFilter {
  return next.account === shown.account
    ? { ...next, account: current.account }
    : next;
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

/**
 * The ticket labels a bulk confirm lists, one per ticket in selection order.
 *
 * @remarks A cleanup removes every session of a ticket, so a ticket with siblings names their count.
 */
export function ticketLabels(
  targets: readonly SessionRow[],
  verb: "Clean up" | "Resume",
): string[] {
  const seen = new Map<string, number>();
  for (const row of targets) seen.set(row.identifier, row.siblings);
  return [...seen].map(([identifier, siblings]) =>
    verb === "Clean up" && siblings > 1
      ? `${identifier} (all ${siblings} sessions)`
      : identifier,
  );
}
