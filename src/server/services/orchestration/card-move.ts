import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { Card, Column } from "../../../shared/types.js";
import { isDemoteEligible } from "../../../shared/demote-eligibility.js";
import {
  blocksAgentDoneManualEntry,
  blocksTodoToInProgressManualMove,
  isManualMoveAllowed,
} from "../../../shared/column-transitions.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError } from "../domain/errors.js";
import { startUnblockedCards } from "./blocked-start.js";
import { actionableCard } from "./card-target.js";
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

/** Move a card to a column by hand under the board's manual move rules, push the change to Linear, and start the cards a move to Done unblocks. */
export async function moveCard(id: string, column: Column): Promise<void> {
  const card = actionableCard(id);
  const transitionError =
    inboxTransitionError(card, column) ??
    manualMoveTransitionError(card, column);
  if (transitionError != null) throw new ConflictError(transitionError);
  void pushColumnChanges(await store.moveCardManual(id, column));
  if (column === "done") {
    void startUnblockedCards(card.boardKey ?? DEFAULT_BOARD_KEY);
  }
}
