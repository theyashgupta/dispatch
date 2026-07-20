import {
  COLUMNS,
  type Card as CardModel,
  type Column,
} from "../../../shared/types.js";
import type { LastOpenedMap } from "../../hooks/useUnseenActivity.js";

/** Side-nav section order: Inbox first, then the board's exact column order — exactly 7 sections. */
export const ORCA_SECTIONS: readonly Column[] = ["inbox", ...COLUMNS];

/**
 * Groups cards by column for the side nav, preserving the board's incoming card order within
 * each section (no re-sorting — the SSE snapshot's order is the source of truth).
 */
export function groupCardsByColumn(
  cards: CardModel[],
): Map<Column, CardModel[]> {
  const grouped = new Map<Column, CardModel[]>();
  for (const column of ORCA_SECTIONS) {
    grouped.set(column, []);
  }
  for (const card of cards) {
    if (card.groupId != null) continue;
    grouped.get(card.column)?.push(card);
  }
  return grouped;
}

/**
 * The most recently opened card still present on the board, excluding the `"__feed__"` sentinel
 * key stamped by the activity-feed dot (not a card id). Used to auto-select on empty Orca
 * selection.
 */
export function mostRecentCardId(
  lastOpened: LastOpenedMap,
  cards: CardModel[],
): string | null {
  let best: { id: string; ts: string } | null = null;
  for (const [id, ts] of Object.entries(lastOpened)) {
    if (id === "__feed__") continue;
    if (!cards.some((c) => c.id === id)) continue;
    if (best == null || ts > best.ts) best = { id, ts };
  }
  return best?.id ?? null;
}
