import type { Card, LoopProgress } from "./types.js";

/** True for a card with a session that is neither starting nor lost. */
export function hasLiveSession(card: Card): boolean {
  return (
    card.provisioningStep == null &&
    card.sessionLost !== true &&
    card.tmuxSession != null
  );
}

/** True for a card that is not Done and has a live session or a provisioning step. */
export function isActiveCard(card: Card): boolean {
  return (
    card.column !== "done" &&
    (hasLiveSession(card) || card.provisioningStep != null)
  );
}

/**
 * True for a group that holds a loop slot on the client.
 *
 * @remarks The server count also includes a start in flight, which the client cannot see.
 */
export function isRunningGroup(card: Card): boolean {
  return card.source === "group" && isActiveCard(card);
}

/** True when the card has loop progress with at least one unit. */
export function hasLoopProgress(
  card: Card,
): card is Card & { loopProgress: LoopProgress } {
  return (card.loopProgress?.units.length ?? 0) > 0;
}
