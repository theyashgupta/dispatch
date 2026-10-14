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

/** True when the card has loop progress with at least one unit. */
export function hasLoopProgress(
  card: Card,
): card is Card & { loopProgress: LoopProgress } {
  return (card.loopProgress?.units.length ?? 0) > 0;
}

/** True for a group card or a ticket card that an orchestrator launched. */
export function isLoopCard(card: Card): boolean {
  return card.source === "group" || card.launch !== undefined;
}

/** True for a loop card with a live session or a provisioning step. */
export function isRunningLoopCard(card: Card): boolean {
  return isLoopCard(card) && isActiveCard(card);
}
