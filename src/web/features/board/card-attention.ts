import type { Card as CardModel, StartError } from "../../../shared/types.js";

/**
 * Ordered attention conditions: each entry returns its tooltip title when its condition holds,
 * or `null`. Both `needsAttention` and `attentionTitle` derive from this single list so a future
 * condition cannot be added to one surface without the other, and the order encodes CardView's
 * render priority (startError wins, then sessionLost, then cleanupBlocked).
 * @remarks Board and Orca cannot disagree about attention because both consume this one list —
 * `check-invariants.mjs`'s `checkAttentionSingleSource` (`NEW-22`) fails any `src/web` file outside
 * this one that exports a rival `needsAttention`/`attentionTitle`, or that ORs two or more of
 * `startError`/`sessionLost`/`cleanupBlocked` together into its own attention claim. Consumers
 * that IMPORT from here are unrestricted, and deliberately so: a closed consumer census would fire
 * on a correct new surface while staying blind to the duplication it exists to prevent.
 * @see docs/ARCHITECTURE.md#design-system-invariants
 */
const ATTENTION_TITLES: ReadonlyArray<(card: CardModel) => string | null> = [
  (card) =>
    card.startError != null
      ? errorCopy(card.startError, card.identifier).heading
      : null,
  (card) =>
    card.sessionLost === true && card.column !== "done" ? "Session lost" : null,
  (card) =>
    card.cleanupBlocked != null && card.cleanupBlocked.length > 0
      ? "Uncommitted work — cleanup blocked"
      : null,
];

/**
 * Returns true when a card needs human attention: a start failure, a lost session outside the
 * Done column, or blocked cleanup.
 * @remarks Shared by CardView's accent ring and the Orca sidebar's attention-badge override —
 * the Phase 64 UI-SPEC mandates a single predicate here so the two surfaces cannot drift apart.
 */
export function needsAttention(card: CardModel): boolean {
  return ATTENTION_TITLES.some((title) => title(card) != null);
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
 * card doesn't need attention. The first matching entry in `ATTENTION_TITLES` wins.
 */
export function attentionTitle(card: CardModel): string | null {
  for (const title of ATTENTION_TITLES) {
    const copy = title(card);
    if (copy != null) return copy;
  }
  return null;
}
