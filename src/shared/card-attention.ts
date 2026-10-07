import type { Card as CardModel, StartError } from "./types.js";

const ATTENTION_TITLES: ReadonlyArray<(card: CardModel) => string | null> = [
  (card) =>
    card.startError != null
      ? errorCopy(card.startError, card.identifier).heading
      : null,
  (card) =>
    card.sessionLost === true && card.column !== "done" ? "Session lost" : null,
  (card) =>
    card.cleanupBlocked != null && card.cleanupBlocked.length > 0
      ? "Uncommitted work: cleanup blocked"
      : null,
];

/**
 * Whether a card needs attention: a start failure, a lost session outside Done, or blocked cleanup.
 *
 * @remarks
 * Derives from the same ordered list as `attentionTitle`, so the board and the Orca sidebar cannot
 * disagree. `checkAttentionSingleSource` (NEW-22) fails any other `src/web` or `src/shared` file
 * that exports a rival predicate.
 */
export function needsAttention(card: CardModel): boolean {
  return ATTENTION_TITLES.some((title) => title(card) != null);
}

/**
 * Maps a `startError` variant to the heading/detail copy for the board Notice and Orca tooltip.
 *
 * @remarks
 * Takes the `StartError` itself, not the card, so the "error exists" precondition lives in the
 * signature and callers need no non-null assertion.
 */
export function errorCopy(
  err: StartError,
  identifier: string,
): {
  heading: string;
  detail?: string;
} {
  switch (err.variant) {
    case "branch-conflict":
      return {
        heading: "Start failed: branch checked out elsewhere",
        detail: `Branch ${identifier} is attached to another worktree.`,
      };
    case "repl-timeout":
      return { heading: "Start failed: Claude didn't start" };
    default:
      return { heading: `Start failed: ${err.step}` };
  }
}

/**
 * Returns the Orca attention-badge tooltip, or `null` when the card needs no attention.
 *
 * @remarks
 * The first matching entry in `ATTENTION_TITLES` wins, so the list order is the render priority.
 */
export function attentionTitle(card: CardModel): string | null {
  for (const title of ATTENTION_TITLES) {
    const copy = title(card);
    if (copy != null) return copy;
  }
  return null;
}
