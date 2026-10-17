import type { Card } from "../../../shared/types.js";
import { isHiddenCard } from "../../../shared/hidden-card.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError, ValidationError } from "../domain/errors.js";

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

/**
 * The card a user start or Run Claude targets: `actionableCard`, plus a 409 for a hidden orchestrator card.
 *
 * @remarks Only the orchestrator lifecycle starts or relaunches a hidden card, so its record and
 * token stay in step with the session.
 */
export function launchableCard(id: string): Card {
  const card = actionableCard(id);
  if (isHiddenCard(card)) {
    throw new ConflictError("orchestrator-card", {
      reason: "use the orchestrator panel",
    });
  }
  return card;
}
