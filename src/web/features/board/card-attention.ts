import type { Card as CardModel, StartError } from "../../../shared/types.js";

/**
 * Returns true when a card needs human attention: a start failure, a lost session outside the
 * Done column, or blocked cleanup.
 * @remarks Shared by CardView's accent ring and the Orca sidebar's attention-badge override —
 * the Phase 64 UI-SPEC mandates a single predicate here so the two surfaces cannot drift apart.
 */
export function needsAttention(card: CardModel): boolean {
  return (
    card.startError != null ||
    (card.sessionLost === true && card.column !== "done") ||
    (card.cleanupBlocked != null && card.cleanupBlocked.length > 0)
  );
}

/**
 * Maps a `startError` variant to the exact heading/detail copy shown in the board's destructive
 * Notice and reused verbatim as the Orca attention-badge tooltip.
 * @remarks Takes the `StartError` itself (not the card) so the "error exists" precondition lives
 * in the signature — callers narrow `card.startError` first, and no non-null assertion is needed.
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
        heading: "Start failed — branch checked out elsewhere",
        detail: `Branch ${identifier} is attached to another worktree.`,
      };
    case "repl-timeout":
      return { heading: "Start failed — Claude didn't start" };
    default:
      return { heading: `Start failed — ${err.step}` };
  }
}

/**
 * Returns the tooltip string for the Orca sidebar's attention-badge override, or `null` when the
 * card doesn't need attention.
 * @remarks Mirrors CardView's own branch priority (startError wins, then sessionLost, then
 * cleanupBlocked) so the two surfaces never disagree on which condition "wins" when more than one
 * is true at once.
 */
export function attentionTitle(card: CardModel): string | null {
  if (card.startError != null)
    return errorCopy(card.startError, card.identifier).heading;
  if (card.sessionLost === true && card.column !== "done")
    return "Session lost";
  if (card.cleanupBlocked != null && card.cleanupBlocked.length > 0)
    return "Uncommitted work — cleanup blocked";
  return null;
}
