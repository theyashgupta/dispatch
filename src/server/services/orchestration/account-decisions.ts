import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import { answerDecisionItem, createDecisionItem } from "./decision-items.js";

export const ACCOUNT_DECISIONS_ORCHESTRATOR = "dispatch-accounts";

/**
 * Raise the decision that asks the user to log an account in again and return its id.
 */
export function raiseLoginDecision(accountId: string, email: string): string {
  const item = createDecisionItem(
    {
      boardKey: DEFAULT_BOARD_KEY,
      orchestratorId: ACCOUNT_DECISIONS_ORCHESTRATOR,
    },
    {
      cardId: null,
      kind: "other",
      question: `Account ${email} needs a login. Open /#/accounts/${accountId} to finish the login.`,
      options: [
        { id: "login", label: "Start the login" },
        { id: "later", label: "Not now" },
      ],
      recommendedOptionId: "login",
    },
  );
  return item.id;
}

/**
 * Answer an account decision, leaving it alone when it is already answered or gone.
 *
 * @remarks The user can answer a decision between the chain's check and its close, so a conflict
 * or a missing item is not an error.
 */
export function closeAccountDecision(
  decisionId: string,
  optionId: string,
  note: string,
): void {
  try {
    answerDecisionItem(decisionId, { optionId, note });
  } catch (err) {
    if (err instanceof ConflictError || err instanceof NotFoundError) return;
    throw err;
  }
}
