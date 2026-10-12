import { reviewPrompt } from "../../../../shared/agent-prompt.js";
import type { StartRequest } from "../../../../shared/start-request.js";
import {
  REVIEW_PLAYBOOK_NAME,
  REVIEW_PLAYBOOK_TAG,
} from "../../../../shared/review-playbook.js";
import type { PrRow } from "../../../../shared/pr-rows.js";
import type {
  BoardKey,
  PrDetail,
  ProviderResult,
  ReviewCardAnswer,
} from "../../../../shared/types.js";
import { prFailureText } from "./pr-error-copy.js";

export interface ReviewFlowDeps {
  currentBoard: BoardKey;
  loadDetail: () => Promise<ProviderResult<{ detail: PrDetail }>>;
  openReviewCard: () => Promise<ProviderResult<ReviewCardAnswer>>;
  switchBoard: (boardKey: BoardKey) => Promise<unknown>;
  moveToTodo: (cardId: string, boardKey: BoardKey) => Promise<void>;
  openStart: (request: StartRequest) => void;
  openCard: (cardId: string) => void;
  notice: (text: string) => void;
}

/**
 * Review a pull request: make or find its card, then open the Start dialog on that card.
 *
 * @remarks
 * The card can sit on another board than the current one, so the flow switches to the card's board
 * before it moves or shows the card. A card in the Inbox moves to To Do first, because the start
 * route refuses an Inbox card. A card that is past To Do already has its session, so the board
 * opens that card and no second session starts.
 */
export async function reviewPullRequestWithAgent(
  deps: ReviewFlowDeps,
  row: Pick<PrRow, "repo" | "number">,
): Promise<void> {
  try {
    const loaded = await deps.loadDetail();
    if (!loaded.ok) {
      deps.notice(prFailureText(loaded.error, loaded.message, loaded.ssoUrl));
      return;
    }
    const card = await deps.openReviewCard();
    if (!card.ok) {
      deps.notice(prFailureText(card.error, card.message, card.ssoUrl));
      return;
    }
    if (card.boardKey !== deps.currentBoard) {
      await deps.switchBoard(card.boardKey);
    }
    if (card.column !== "inbox" && card.column !== "todo") {
      deps.openCard(card.cardId);
      return;
    }
    if (card.column === "inbox")
      await deps.moveToTodo(card.cardId, card.boardKey);
    deps.openStart({
      cardId: card.cardId,
      extraDirection: reviewPrompt(loaded.detail, row.repo, row.number),
      playbookTag: REVIEW_PLAYBOOK_TAG,
      playbook: REVIEW_PLAYBOOK_NAME,
    });
  } catch {
    deps.notice("Couldn't start the review. Try again.");
  }
}
