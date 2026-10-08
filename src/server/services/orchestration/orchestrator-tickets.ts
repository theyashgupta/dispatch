import { randomUUID } from "node:crypto";
import type { Card, Column, LinearComment } from "../../../shared/types.js";
import {
  redactCard,
  boardRepository as store,
} from "../../store/board-repository.js";
import {
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  ValidationError,
} from "../domain/errors.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import { moveCard } from "./card-move.js";
import { postComment, type OutboundDeps } from "./linear-outbound.js";
import { appendToExtraScope } from "./orchestrator-session.js";
import { createTicket } from "./ticket-create.js";

export const commentOutbound: { deps: OutboundDeps | undefined } = {
  deps: undefined,
};

/** The redacted live copy of a card after a write. */
function liveCard(id: string): Card {
  const card = store.getCard(id);
  if (!card) throw new NotFoundError("unknown-card");
  return redactCard(card);
}

/**
 * Create a local ticket on the orchestrator's board from one entry of an approved proposal.
 *
 * @remarks
 * The index is marked used in one guarded store write before the ticket is created, so two
 * racing calls cannot both pass. If the create then fails, the index is released again.
 */
export async function createOrchestratorTicket(
  caller: OrchestratorIdentity,
  input: { proposalItemId: string; index: number },
): Promise<Card> {
  const item = store.getDecisionItem(input.proposalItemId);
  if (item?.boardKey !== caller.boardKey) {
    throw new NotFoundError("unknown-proposal");
  }
  if (item.kind !== "ticket_proposal" || item.proposal === undefined) {
    throw new ValidationError("not-a-proposal");
  }
  if (item.orchestratorId !== caller.orchestratorId) {
    throw new ForbiddenError("other-owner");
  }
  if (item.state === "open") throw new ConflictError("proposal-open");
  if (item.answer?.optionId !== "approve") {
    throw new ConflictError("proposal-rejected");
  }
  const entry = item.proposal.tickets[input.index];
  if (entry === undefined) throw new ValidationError("invalid-index");
  if (!store.useProposalIndex(item.id, input.index)) {
    throw new ConflictError("proposal-index-used");
  }
  let card: Card;
  try {
    card = await createTicket(caller.boardKey, {
      title: entry.title,
      fullDescription: entry.description,
    });
  } catch (err) {
    store.releaseProposalIndex(item.id, input.index);
    throw err;
  }
  await store.setOrchestratorFields(card.id, {
    createdByOrchestrator: caller.orchestratorId,
  });
  await appendToExtraScope(caller, "ticketIds", card.id);
  return liveCard(card.id);
}

/**
 * Change the title or description of a local ticket.
 *
 * @remarks A group card is not a ticket. Any other non-local card is owned by its source, so the
 * edit belongs there.
 */
export async function updateTicket(
  card: Card,
  patch: { title?: string; description?: string },
): Promise<Card> {
  if (card.source === "group") throw new ConflictError("not-a-ticket");
  if (card.source !== "local") {
    throw new ConflictError("linear-card", {
      reason: "linear card: edit in Linear",
    });
  }
  if (!(await store.updateLocalCardText(card.id, patch))) {
    throw new NotFoundError("unknown-card");
  }
  return liveCard(card.id);
}

/**
 * Move a card for the orchestrator under the same rules as a move by hand.
 *
 * @remarks Done is allowed only for a card this orchestrator created, so it never closes work a
 * person or another orchestrator owns. A Done group counts as merged for its dependents, so only
 * the ship flow or the user moves a group to Done.
 */
export async function moveTicket(
  caller: OrchestratorIdentity,
  card: Card,
  column: Column,
): Promise<Card> {
  if (column === "done" && card.source === "group") {
    throw new ConflictError("group-done-by-ship");
  }
  if (
    column === "done" &&
    card.createdByOrchestrator !== caller.orchestratorId
  ) {
    throw new ForbiddenError("done-not-own-card", {
      reason: "move to Done: card was not created by this orchestrator",
    });
  }
  await moveCard(card.id, column);
  return liveCard(card.id);
}

/**
 * Add a comment to a card: a local entry on a local card, a Linear comment on any other card.
 *
 * @returns The local entry, or null for a comment posted to Linear.
 */
export async function commentOnTicket(
  caller: OrchestratorIdentity,
  card: Card,
  body: string,
): Promise<LinearComment | null> {
  if (card.source === "local") {
    const comment: LinearComment = {
      id: `local-${randomUUID()}`,
      body,
      createdAt: new Date().toISOString(),
      author: `orchestrator:${caller.orchestratorId}`,
    };
    if (!(await store.addLocalComment(card.id, comment))) {
      throw new NotFoundError("unknown-card");
    }
    return comment;
  }
  const outcome = await postComment(card.id, body, commentOutbound.deps);
  if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
  return null;
}
