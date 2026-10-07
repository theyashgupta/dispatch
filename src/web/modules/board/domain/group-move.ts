import {
  blocksAgentDoneManualEntry,
  isManualMoveAllowed,
} from "../../../../shared/column-transitions.js";
import type { Card, Column as ColumnId } from "../../../../shared/types.js";

export interface GroupMove {
  id: string;
  from: ColumnId;
}

export type GroupMovePlan =
  { refused: true } | { refused: false; moves: GroupMove[] };

/** The cards named in `cardIds` that are not already in the target column. */
export function groupMoveCandidates(
  cards: readonly Card[],
  cardIds: readonly string[],
  target: ColumnId,
): Card[] {
  return cards.filter((c) => cardIds.includes(c.id) && c.column !== target);
}

/**
 * The moves a group drop performs, or a refusal when the target takes no manual entry.
 *
 * @remarks
 * A candidate whose own move the manual allowlist refuses is dropped from the plan rather than
 * failing the group, so an empty `moves` list means there is nothing to send.
 */
export function planGroupMove(
  candidates: readonly Card[],
  target: ColumnId,
): GroupMovePlan {
  if (blocksAgentDoneManualEntry(target)) return { refused: true };
  return {
    refused: false,
    moves: candidates
      .filter((c) => isManualMoveAllowed(c.column, target))
      .map((c) => ({ id: c.id, from: c.column })),
  };
}

/** The cards with every planned move written into the target column. */
export function applyMoves(
  cards: readonly Card[],
  moves: readonly GroupMove[],
  target: ColumnId,
): Card[] {
  const ids = new Set(moves.map((m) => m.id));
  return cards.map((c) => (ids.has(c.id) ? { ...c, column: target } : c));
}

/**
 * The cards with each planned move undone.
 *
 * @remarks
 * A card that has since left the target column, for example through a stream frame, is left where
 * it is.
 */
export function restoreMoves(
  cards: readonly Card[],
  moves: readonly GroupMove[],
  target: ColumnId,
): Card[] {
  const fromById = new Map(moves.map((m) => [m.id, m.from]));
  return cards.map((c) => {
    const from = fromById.get(c.id);
    return from != null && c.column === target ? { ...c, column: from } : c;
  });
}

function succeeded(
  moves: readonly GroupMove[],
  results: readonly PromiseSettledResult<unknown>[],
): GroupMove[] {
  return moves.filter((_, i) => results[i]?.status === "fulfilled");
}

/** The succeeded moves that can be sent back, because the allowlist accepts the return trip. */
export function compensationTargets(
  moves: readonly GroupMove[],
  results: readonly PromiseSettledResult<unknown>[],
  target: ColumnId,
): GroupMove[] {
  return succeeded(moves, results).filter((m) =>
    isManualMoveAllowed(target, m.from),
  );
}

/** The succeeded moves the allowlist refuses to send back; these cards stay in the target column. */
export function strandedMoves(
  moves: readonly GroupMove[],
  results: readonly PromiseSettledResult<unknown>[],
  target: ColumnId,
): GroupMove[] {
  return succeeded(moves, results).filter(
    (m) => !isManualMoveAllowed(target, m.from),
  );
}
