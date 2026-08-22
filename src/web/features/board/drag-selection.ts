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
