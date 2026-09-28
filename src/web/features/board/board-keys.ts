import { COLUMNS, type Card } from "../../../shared/types.js";

export type BoardDirection = "j" | "k" | "h" | "l";

export const CARD_DOM_PREFIX = "board-card-";

/** True for a Done card that still holds a session or a worktree, listed above the cleaned ones. */
export function awaitingCleanup(
  card: Pick<Card, "tmuxSession" | "workspacePath">,
): boolean {
  return card.tmuxSession != null || card.workspacePath != null;
}

/** The board's card ids per column in display order: ungrouped cards, Done cards awaiting first. */
export function boardLanes(cards: readonly Card[]): string[][] {
  return COLUMNS.map((column) => {
    const lane = cards.filter((c) => c.column === column && c.groupId == null);
    const ordered =
      column === "done"
        ? [
            ...lane.filter(awaitingCleanup),
            ...lane.filter((c) => !awaitingCleanup(c)),
          ]
        : lane;
    return ordered.map((c) => c.id);
  });
}

/**
 * The card id a board navigation key lands on, given the visible columns as ordered id lists.
 *
 * @remarks With no focused card, or one no longer on the board, any key lands on the first card of
 * the first non-empty column from `startLane` on. j and k clamp inside the column; h and l skip empty columns, keep the
 * row index clamped to the target column, and stay put at the edge of the board.
 */
export function nextFocusedCard(
  lanes: readonly (readonly string[])[],
  focused: string | null,
  direction: BoardDirection,
  startLane = 0,
): string | null {
  const col =
    focused == null ? -1 : lanes.findIndex((l) => l.includes(focused));
  if (col === -1 || focused == null)
    return (
      [...lanes.slice(startLane), ...lanes.slice(0, startLane)].find(
        (lane) => lane.length > 0,
      )?.[0] ?? null
    );
  const lane = lanes[col] ?? [];
  const row = lane.indexOf(focused);
  if (direction === "j")
    return lane[Math.min(row + 1, lane.length - 1)] ?? focused;
  if (direction === "k") return lane[Math.max(row - 1, 0)] ?? focused;
  const step = direction === "l" ? 1 : -1;
  for (let c = col + step; c >= 0 && c < lanes.length; c += step) {
    const target = lanes[c] ?? [];
    if (target.length > 0)
      return target[Math.min(row, target.length - 1)] ?? focused;
  }
  return focused;
}

/** The card id behind the focused board card element, read back from its DOM id. */
export function focusedCardId(): string | null {
  const id = document.activeElement?.id ?? "";
  return id.startsWith(CARD_DOM_PREFIX)
    ? id.slice(CARD_DOM_PREFIX.length)
    : null;
}

/** Give a board card DOM focus and scroll it fully into view so its focus ring shows. */
export function focusCard(id: string | null): void {
  if (id == null) return;
  const el = document.getElementById(`${CARD_DOM_PREFIX}${id}`);
  el?.focus();
  el?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
