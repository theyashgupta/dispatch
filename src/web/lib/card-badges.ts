import type { Card } from "../../shared/types.js";
import { isUnseen, type LastOpenedMap } from "./unseen-activity.js";

/**
 * Single source of truth for the "gone from Linear" badge, shared by the board
 * card and the drag-overlay clone so the two can never drift apart. Cards in
 * the first column are exempt: they are removed outright instead of badged.
 */
export function deriveShowGone(card: Card): boolean {
  return (
    card.goneFromLinear === true &&
    card.column !== "todo" &&
    card.column !== "inbox"
  );
}

/**
 * Single source of truth for the unseen-activity dot, shared by the board card
 * and the drag-overlay clone so the two can never drift apart. Suppressed while
 * the card is selected (the open panel means the user is watching) and when the
 * session is lost (stale output can no longer accrue meaning).
 */
export function deriveShowDot(
  card: Card,
  selected: boolean,
  lastOpenedMap: LastOpenedMap,
): boolean {
  return (
    card.tmuxSession != null &&
    card.sessionLost !== true &&
    !selected &&
    isUnseen(card.outputChangedAt, lastOpenedMap[card.id])
  );
}
