import type { Card } from "../../../../shared/types.js";

/**
 * Determines what a drag actually moves when the grabbed card sits inside a selection.
 *
 * @remarks
 * A `null` result tells every caller to take the untouched single-card path. A grabbed card
 * outside the current selection drags alone and clears the selection first, so the drag always
 * matches what the user sees highlighted.
 */
export function dragSelectionIds(
  cardId: string,
  selectedIds: ReadonlySet<string>,
): string[] | null {
  if (!selectedIds.has(cardId) || selectedIds.size < 2) return null;
  return [...selectedIds];
}

/** Whether a resting (not physically grabbed) card should dim as if it were being dragged too. */
export function isForceDimmed(
  cardId: string,
  activeCardId: string | null,
  selectedIds: ReadonlySet<string>,
): boolean {
  return (
    activeCardId != null &&
    cardId !== activeCardId &&
    selectedIds.has(activeCardId) &&
    selectedIds.has(cardId)
  );
}

/** Whether a card can join a multi-selection: an ungrouped, non-group To Do card. */
export function isMultiSelectable(
  card: Pick<Card, "column" | "groupId" | "source">,
): boolean {
  return (
    card.column === "todo" && card.groupId == null && card.source !== "group"
  );
}

/**
 * The selection kept after a board update, as the same set when nothing was removed.
 *
 * @remarks
 * A card with a move still in flight keeps its place, because its column is only the optimistic
 * write until the server answers. Returning the same reference lets a state setter skip a
 * re-render when nothing was removed.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  cards: readonly Card[],
  pendingMoveIds: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const eligible = new Set(cards.filter(isMultiSelectable).map((c) => c.id));
  const pruned = new Set(
    [...selected].filter((id) => eligible.has(id) || pendingMoveIds.has(id)),
  );
  return pruned.size === selected.size ? selected : pruned;
}
