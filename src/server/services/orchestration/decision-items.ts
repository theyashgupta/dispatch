import { randomUUID } from "node:crypto";
import type { DecisionItem } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../domain/errors.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import { callerPolicy, scopeTargetOf } from "./boards.js";

interface DecisionInput {
  cardId?: string | null | undefined;
  kind: DecisionItem["kind"];
  question: string;
  options: DecisionItem["options"];
  recommendedOptionId?: string | undefined;
  tickets?: NonNullable<DecisionItem["proposal"]>["tickets"] | undefined;
  plan?: DecisionItem["plan"] | undefined;
}

const ROADMAP_OPTIONS: DecisionItem["options"] = [
  { id: "approve", label: "Approve the roadmap" },
  { id: "reject", label: "Do not approve" },
];

const PROPOSAL_OPTIONS: DecisionItem["options"] = [
  { id: "approve", label: "Create these tickets" },
  { id: "reject", label: "Do not create" },
];

const PLAN_OPTIONS: DecisionItem["options"] = [
  { id: "approve", label: "Approve the plan" },
  { id: "reject", label: "Do not approve" },
];

const SERVER_OPTIONS: Partial<
  Record<DecisionItem["kind"], DecisionItem["options"]>
> = {
  roadmap_approval: ROADMAP_OPTIONS,
  ticket_proposal: PROPOSAL_OPTIONS,
  plan: PLAN_OPTIONS,
};

const AUTO_APPROVED_KINDS: readonly DecisionItem["kind"][] = [
  "ticket_proposal",
  "plan",
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
 * Store a decision item for the caller's board and record its event.
 *
 * @remarks
 * The caller checks that `cardId` belongs to the board, and the recommended option must be
 * one of the options, else the typed 400 `invalid-recommended-option`. A `roadmap_approval`,
 * `ticket_proposal` or `plan` item gets the server options, so the label the user picks always
 * matches the id the later tool checks. Under roadmapApproval `all` or
 * `rules` a `ticket_proposal` or `plan` item is stored answered with `approve` and records
 * `decision_answered`, so the orchestrator never answers its own item.
 */
export function createDecisionItem(
  caller: OrchestratorIdentity,
  input: DecisionInput,
): DecisionItem {
  if ((input.kind === "ticket_proposal") !== (input.tickets !== undefined)) {
    throw new ValidationError("invalid-tickets");
  }
  if ((input.kind === "plan") !== (input.plan !== undefined)) {
    throw new ValidationError("invalid-plan");
  }
  const forced = SERVER_OPTIONS[input.kind];
  const options = forced ?? input.options;
  const recommended = forced ? "approve" : (input.recommendedOptionId ?? null);
  if (
    recommended !== null &&
    !options.some((option) => option.id === recommended)
  ) {
    throw new ValidationError("invalid-recommended-option");
  }
  const owner = ownerOf(caller, input.cardId ?? null);
  const mode = AUTO_APPROVED_KINDS.includes(input.kind)
    ? callerPolicy({ boardKey: caller.boardKey, orchestratorId: owner })
        .roadmapApproval
    : "ask";
  const autoApprove = mode !== "ask";
  const createdAt = new Date().toISOString();
  const note = `Approved by the board policy (roadmapApproval: ${mode}).`;
  const item: DecisionItem = {
    id: randomUUID(),
    boardKey: caller.boardKey,
    cardId: input.cardId ?? null,
    orchestratorId: owner,
    kind: input.kind,
    question: input.question,
    options,
    recommendedOptionId: recommended,
    state: autoApprove ? "answered" : "open",
    answer: autoApprove ? { optionId: "approve", note } : null,
    createdAt,
    answeredAt: autoApprove ? createdAt : null,
    ...(input.tickets === undefined
      ? {}
      : { proposal: { tickets: input.tickets, usedIndexes: [] } }),
    ...(input.plan === undefined ? {} : { plan: input.plan }),
  };
  store.insertDecisionItem(item);
  store.appendOrchestrationEvent({
    boardKey: item.boardKey,
    cardId: item.cardId,
    sessionId: null,
    kind: autoApprove ? "decision_answered" : "decision_raised",
    data: {
      decisionId: item.id,
      kind: item.kind,
      orchestratorId: item.orchestratorId,
      ...item.answer,
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
