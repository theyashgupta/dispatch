/**
 * Determines what a drag actually moves when the grabbed card sits inside a selection.
 * @remarks `dragSelectionIds` returning `null` is the load-bearing signal every caller in this
 * phase branches on: take the untouched single-card path, byte for byte. A grabbed card that is
 * not part of the current selection drags alone and clears the selection first (100-CONTEXT.md's
 * locked decision), so the drag always matches what the user sees highlighted.
 */
export function dragSelectionIds(
  cardId: string,
  selectedIds: ReadonlySet<string>,
): string[] | null {
  if (!selectedIds.has(cardId) || selectedIds.size < 2) return null;
  return [...selectedIds];
}

/**
 * The stacked-deck back-face offsets, in pixels, ordered back to front (the 8px face, then the
 * 4px face).
 * @remarks Pure translation, deliberately no rotation and no scale: a rotated face's bounding rect
 * would no longer equal the front face's rect translated by a constant, and that arithmetic is
 * exactly how `panel-100.mjs` verifies the deck without a screenshot.
 */
export const DECK_BACK_OFFSETS_PX = [8, 4] as const;

/**
 * Whether a resting (not physically grabbed) card should dim as if it were being dragged too.
 */
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
