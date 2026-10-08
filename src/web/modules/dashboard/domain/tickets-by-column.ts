import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import { COLUMNS, type Card, type Column } from "../../../../shared/types.js";

const ROWS: ReadonlyArray<{ column: Column; label: string }> = COLUMNS.map(
  (column) => ({ column, label: COLUMN_LABELS[column] }),
);

export interface ColumnRow {
  column: Column;
  label: string;
  cards: Card[];
  byOrchestrator: number;
}

/** Groups cards into the seven board columns with the count that an orchestrator created. */
export function ticketsByColumn(cards: readonly Card[]): ColumnRow[] {
  return ROWS.map(({ column, label }) => {
    const inColumn = cards.filter((card) => card.column === column);
    return {
      column,
      label,
      cards: inColumn,
      byOrchestrator: inColumn.filter((card) => card.createdByOrchestrator)
        .length,
    };
  });
}

/** Keeps the cards of one group (its members and the group card) and of one column. */
export function filterCards(
  cards: readonly Card[],
  filter: { groupId?: string; column?: Column },
): Card[] {
  return cards.filter(
    (card) =>
      (filter.groupId === undefined ||
        card.groupId === filter.groupId ||
        card.id === filter.groupId) &&
      (filter.column === undefined || card.column === filter.column),
  );
}

/** Lists the group cards for the group select: a card with a loop and a card that others name as their group. */
export function groupOptions(
  cards: readonly Card[],
): { id: string; label: string }[] {
  const named = new Set(cards.map((card) => card.groupId));
  return cards
    .filter((card) => card.loopProgress !== undefined || named.has(card.id))
    .map((card) => ({ id: card.id, label: card.identifier }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
}
