import type { Card, Column } from "../../../shared/types.js";
import { isDemoteEligible } from "../../../shared/demote-eligibility.js";
import {
  blocksAgentDoneManualEntry,
  blocksTodoToInProgressManualMove,
  isManualMoveAllowed,
} from "../../../shared/column-transitions.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError, ValidationError } from "../domain/errors.js";
import { pushColumnChanges } from "./linear-outbound.js";

/**
 * The 409 copy for an Inbox move the board does not allow, or null when it is legal.
 *
 * @remarks From the Inbox the only legal move is promotion to To Do. Into the Inbox only a To Do
 * card that passes `isDemoteEligible` and has no start in flight may travel.
 */
function inboxTransitionError(card: Card, column: Column): string | null {
  if (card.column === "inbox" && column !== "todo")
    return "inbox cards can only be promoted to To Do";
  if (column !== "inbox") return null;
  if (card.column !== "todo") return "only To Do cards can be moved to Inbox";
  if (store.isStarting(card.id)) return "a start is in flight for this card";
  if (!isDemoteEligible(card))
    return "cards with session history cannot be moved to Inbox";
  return null;
}

/**
 * The 409 copy for a pair `isManualMoveAllowed` blocks, or null when the move is allowed.
 *
 * @remarks The fallthrough is a refusal, so a pair added to the blocked set without its own copy
 * still answers 409 instead of a 200 that `moveCardManual` silently ignores.
 */
function manualMoveTransitionError(card: Card, column: Column): string | null {
  if (isManualMoveAllowed(card.column, column)) return null;
  if (blocksAgentDoneManualEntry(column))
    return "Agent Done is set automatically by a real agent completion signal. It is never a manual move target";
  if (blocksTodoToInProgressManualMove(card.column, column))
    return "starting a To Do card requires the start flow: drag it to In Progress (or use Start) rather than posting a bare move";
  return `moving ${card.column} → ${column} is not an allowed manual transition`;
}

/**
 * The 409 copy for a grouped member, or null for an ungrouped card or a group card.
 *
 * @remarks A grouped member is never progressed on its own, also before its group starts, because
 * the session and workspace fields live only on the group card.
 */
export function groupedMemberError(card: Card): string | null {
  if (card.groupId == null) return null;
  return `card is grouped under ${card.groupId}, act on the group card`;
}

/** The card a single-card action targets, or a 400 for an unknown id and a 409 for a grouped member. */
export function actionableCard(id: string): Card {
  const card = store.getCard(id);
  if (!card) throw new ValidationError(`unknown card id: ${id}`);
  const groupError = groupedMemberError(card);
  if (groupError != null) throw new ConflictError(groupError);
  return card;
}

/** Move a card to a column by hand under the board's manual move rules, then push the change to Linear. */
export async function moveCard(id: string, column: Column): Promise<void> {
  const card = actionableCard(id);
  const transitionError =
    inboxTransitionError(card, column) ??
    manualMoveTransitionError(card, column);
  if (transitionError != null) throw new ConflictError(transitionError);
  void pushColumnChanges(await store.moveCardManual(id, column));
}
