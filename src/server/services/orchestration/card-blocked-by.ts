import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { BoardKey, Card } from "../../../shared/types.js";
import {
  redactCard,
  boardRepository as store,
} from "../../store/board-repository.js";
import { checkBlockers } from "../domain/blocked-by.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";

function unwrap(result: ReturnType<typeof checkBlockers>): string[] {
  if (!result.ok) {
    throw new ValidationError(result.code, { reason: result.reason });
  }
  return result.ids;
}

/** Check blockers for a card that does not exist yet and return them without duplicates. */
export function assertBlockers(boardKey: BoardKey, ids: string[]): string[] {
  return unwrap(checkBlockers(boardKey, ids, (id) => store.getCard(id)));
}

/**
 * Check a new blocker list for an existing card and return it without duplicates.
 *
 * @remarks Pure: it throws the refusal and writes nothing, so a caller can run it before another write.
 */
export function checkCardBlockedBy(card: Card, ids: string[]): string[] {
  return unwrap(
    checkBlockers(
      card.boardKey ?? DEFAULT_BOARD_KEY,
      ids,
      (id) => store.getCard(id),
      card,
    ),
  );
}

/**
 * Replace the blockers of a card, or clear them with an empty list.
 *
 * @remarks Every rule runs before the write, so a refused list leaves the stored list as it was.
 */
export async function setCardBlockedBy(
  card: Card,
  ids: string[],
): Promise<Card> {
  await store.setBlockedBy(card.id, checkCardBlockedBy(card, ids));
  const live = store.getCard(card.id);
  if (!live) throw new NotFoundError("unknown-card");
  return redactCard(live);
}
