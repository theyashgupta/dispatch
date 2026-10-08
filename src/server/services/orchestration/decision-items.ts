import { randomUUID } from "node:crypto";
import type { DecisionItem } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../domain/errors.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import { scopeTargetOf } from "./boards.js";

interface DecisionInput {
  cardId?: string | null | undefined;
  kind: DecisionItem["kind"];
  question: string;
  options: DecisionItem["options"];
  recommendedOptionId?: string | undefined;
  tickets?: NonNullable<DecisionItem["proposal"]>["tickets"] | undefined;
}

const ROADMAP_OPTIONS: DecisionItem["options"] = [
  { id: "approve", label: "Approve the roadmap" },
  { id: "reject", label: "Do not approve" },
];

const PROPOSAL_OPTIONS: DecisionItem["options"] = [
  { id: "approve", label: "Create these tickets" },
  { id: "reject", label: "Do not create" },
];

/**
 * Resolve the orchestrator that owns a decision.
 *
 * @remarks
 * A decision about a card goes to that card's owner, who can differ from the caller.
 */
function ownerOf(caller: OrchestratorIdentity, cardId: string | null): string {
  const card = cardId === null ? undefined : store.getCard(cardId);
  return (card && scopeTargetOf(card).owner) || caller.orchestratorId;
}

/**
 * Store an open decision item for the caller's board and record `decision_raised`.
 *
 * @remarks
 * The caller checks that `cardId` belongs to the board. The recommended option must be
 * one of the options, else the typed 400 `invalid-recommended-option`. A `roadmap_approval` or
 * `ticket_proposal` item gets the server options, so the label the user picks always matches the id
 * the later tool checks.
 */
export function createDecisionItem(
  caller: OrchestratorIdentity,
  input: DecisionInput,
): DecisionItem {
  const proposal = input.kind === "ticket_proposal";
  if (proposal !== (input.tickets !== undefined)) {
    throw new ValidationError("invalid-tickets");
  }
  const serverOptions = proposal || input.kind === "roadmap_approval";
  const options = proposal
    ? PROPOSAL_OPTIONS
    : serverOptions
      ? ROADMAP_OPTIONS
      : input.options;
  const recommended = serverOptions
    ? "approve"
    : (input.recommendedOptionId ?? null);
  if (
    recommended !== null &&
    !options.some((option) => option.id === recommended)
  ) {
    throw new ValidationError("invalid-recommended-option");
  }
  const item: DecisionItem = {
    id: randomUUID(),
    boardKey: caller.boardKey,
    cardId: input.cardId ?? null,
    orchestratorId: ownerOf(caller, input.cardId ?? null),
    kind: input.kind,
    question: input.question,
    options,
    recommendedOptionId: recommended,
    state: "open",
    answer: null,
    createdAt: new Date().toISOString(),
    answeredAt: null,
    ...(input.tickets === undefined
      ? {}
      : { proposal: { tickets: input.tickets, usedIndexes: [] } }),
  };
  store.insertDecisionItem(item);
  store.appendOrchestrationEvent({
    boardKey: item.boardKey,
    cardId: item.cardId,
    sessionId: null,
    kind: "decision_raised",
    data: {
      decisionId: item.id,
      kind: item.kind,
      orchestratorId: item.orchestratorId,
    },
    ts: item.createdAt,
  });
  return item;
}

/**
 * Answer an open decision item and record `decision_answered` on its board.
 *
 * @remarks The store answer is the single gate: it returns null for an item that is already
 * answered, so two racing answers cannot both write an event.
 */
export function answerDecisionItem(
  id: string,
  answer: { optionId: string; note: string | null },
): DecisionItem {
  const item = store.getDecisionItem(id);
  if (!item) throw new NotFoundError("unknown-decision");
  if (!item.options.some((option) => option.id === answer.optionId)) {
    throw new ValidationError("invalid-option");
  }
  const answered = store.answerDecisionItem(id, answer);
  if (!answered) throw new ConflictError("already-answered");
  store.appendOrchestrationEvent({
    boardKey: item.boardKey,
    cardId: item.cardId,
    sessionId: null,
    kind: "decision_answered",
    data: {
      decisionId: id,
      kind: item.kind,
      orchestratorId: item.orchestratorId,
      optionId: answer.optionId,
      note: answer.note,
    },
    ts: new Date().toISOString(),
  });
  return answered;
}
