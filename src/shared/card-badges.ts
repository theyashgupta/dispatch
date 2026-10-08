import type { Card } from "./types.js";
import { isUnseen, type LastOpenedMap } from "./unseen-activity.js";

/**
 * Decides whether a card shows the "gone from Linear" badge.
 *
 * @remarks
 * Shared by the board card and the drag-overlay clone so the two cannot drift apart. Cards in the
 * first columns are exempt because they are removed outright instead of badged.
 */
export function deriveShowGone(card: Card): boolean {
  return (
    card.goneFromLinear === true &&
    card.column !== "todo" &&
    card.column !== "inbox"
  );
}

/**
 * Decides whether a card shows the unseen-activity dot.
 *
 * @remarks
 * Shared by the board card and the drag-overlay clone so the two cannot drift apart. The dot is
 * suppressed while the card is selected (the open panel means the user is watching) and when the
 * session is lost (stale output carries no meaning).
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
