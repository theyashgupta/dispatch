import type { Request, Response } from "express";
import { isHiddenCard } from "../../shared/hidden-card.js";
import type { Card } from "../../shared/types.js";
import { ForbiddenError, NotFoundError } from "../services/domain/errors.js";
import {
  checkScope,
  type OrchestratorIdentity,
  type ScopeTarget,
} from "../services/domain/orchestrator-scope.js";
import {
  listBoardCards,
  listBoardSessions,
  scopeTargetOf,
} from "../services/orchestration/boards.js";
import {
  cardWithMembers,
  eventsAfter,
  groupProgress,
  paneTail,
  policySummary,
  workspaceSummary,
} from "../services/orchestration/orchestrator-read.js";
import { createDecisionItem } from "../services/orchestration/decision-items.js";
import { waitForEvent } from "../services/orchestration/orchestrator-wait.js";
import { recordDelivered } from "../services/orchestration/orchestrator-wake.js";
import {
  commentOnTicket,
  createOrchestratorTicket,
  moveTicket,
  updateTicket,
} from "../services/orchestration/orchestrator-tickets.js";
import {
  createBaseBranch,
  createOrchestratorGroup,
  startOrchestratorGroup,
} from "../services/orchestration/orchestrator-groups.js";
import {
  readState,
  writeState,
} from "../services/orchestration/orchestrator-session.js";
import {
  approveGroupPlan,
  requestHandoff,
  resumeLoop,
  sendInput,
  stopSession,
} from "../services/orchestration/orchestrator-sessions.js";
import { startShip } from "../services/orchestration/ship-flow.js";
import { boardRepository } from "../store/board-repository.js";
import {
  approveBodySchema,
  baseBranchBodySchema,
  cardParamsSchema,
  commentBodySchema,
  createDecisionBodySchema,
  createGroupBodySchema,
  createTicketBodySchema,
  handoffBodySchema,
  listCardsQuerySchema,
  listEventsQuerySchema,
  listSessionsQuerySchema,
  moveBodySchema,
  paneQuerySchema,
  sendInputBodySchema,
  sessionCardParamsSchema,
  shipBodySchema,
  updateTicketBodySchema,
  waitBodySchema,
  writeStateBodySchema,
} from "./orchestrator-schemas.js";
import { parseOrThrow } from "./parse-input.js";

export interface ToolCall {
  tool: string;
  args: unknown;
  caller: OrchestratorIdentity | null;
  cardId: string | null;
  result: string | null;
  error: unknown;
}

export type ToolHandler = (
  req: Request,
  res: Response,
  caller: OrchestratorIdentity,
  call: ToolCall,
) => Promise<void> | void;

/** Throw the typed 403 when the target is outside the caller's scope. */
function assertInScope(
  caller: OrchestratorIdentity,
  target: ScopeTarget,
): void {
  const scope = checkScope(caller, target);
  if (!scope.ok) throw new ForbiddenError(scope.reason);
}

/**
 * Load a card by id and check it is on the caller's board and, unless told not to, owned by it.
 *
 * @remarks
 * The id goes on the call first, so a refused or unknown card still shows in the record.
 * The ship routes skip the owner check because the main ships the groups of every extra. An
 * orchestrator session card is unknown to every tool, so no orchestrator steers another one.
 */
function scopedCard(
  caller: OrchestratorIdentity,
  call: ToolCall,
  id: string,
  ownerCheck = true,
): Card {
  call.cardId = id;
  const card = boardRepository.getCard(id);
  if (!card || isHiddenCard(card)) throw new NotFoundError("unknown-card");
  assertInScope(
    caller,
    ownerCheck ? scopeTargetOf(card) : { boardKey: card.boardKey },
  );
  return card;
}

/** List the cards of the caller board, filtered by column, source or text. */
export const listCardsHandler: ToolHandler = (req, res, caller, call) => {
  const filters = parseOrThrow(listCardsQuerySchema, req.query);
  const listed = listBoardCards(caller.boardKey, filters);
  call.result = `${listed.total} cards`;
  res.status(200).json(listed);
};

/** Answer one card of the caller board with its members. */
export const getCardHandler: ToolHandler = (req, res, caller, call) => {
  const { id } = parseOrThrow(cardParamsSchema, req.params);
  const card = scopedCard(caller, call, id);
  call.result = card.id;
  res.status(200).json(cardWithMembers(card));
};

/** List the sessions of the caller board, only the live ones when asked. */
export const listSessionsHandler: ToolHandler = (req, res, caller, call) => {
  const { live } = parseOrThrow(listSessionsQuerySchema, req.query);
  const sessions = listBoardSessions(caller.boardKey, live);
  call.result = `${sessions.length} sessions`;
  res.status(200).json({ sessions });
};

/** Answer the loop progress of one group card. */
export const getGroupProgressHandler: ToolHandler = (
  req,
  res,
  caller,
  call,
) => {
  const { id } = parseOrThrow(cardParamsSchema, req.params);
  const progress = groupProgress(scopedCard(caller, call, id));
  call.result = id;
  res.status(200).json(progress);
};

/** Answer the last lines of the terminal of a session. */
export const readPaneTailHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, req.params);
  const { lines } = parseOrThrow(paneQuerySchema, req.query);
  const tail = await paneTail(scopedCard(caller, call, cardId), lines);
  call.result = `${tail.lines.length} lines`;
  res.status(200).json(tail);
};

/** Answer the board events after a cursor, oldest first. */
export const listEventsHandler: ToolHandler = (req, res, caller, call) => {
  const { since = 0, limit = 200 } = parseOrThrow(
    listEventsQuerySchema,
    req.query,
  );
  const page = eventsAfter(caller.boardKey, since, limit);
  recordDelivered(
    caller.boardKey,
    caller.orchestratorId,
    page.events.map((e) => e.id),
  );
  call.result = `${page.events.length} events`;
  res.status(200).json(page);
};

/** Answer the board policy with its running loop count, group costs and playbook names. */
export const getPolicyHandler: ToolHandler = async (
  _req,
  res,
  caller,
  call,
) => {
  const summary = await policySummary(caller);
  call.result = `${summary.runningLoops} running`;
  res.status(200).json(summary);
};

/** Answer the board folder, repositories, playbook names and group playbook. */
export const getBoardWorkspaceHandler: ToolHandler = async (
  _req,
  res,
  caller,
  call,
) => {
  const workspace = await workspaceSummary(caller);
  call.result = `${workspace.repos.length} repos`;
  res.status(200).json(workspace);
};

/** Create a local ticket marked as created by the caller. */
export const createTicketHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const input = parseOrThrow(createTicketBodySchema, req.body);
  const card = await createOrchestratorTicket(caller, input);
  call.cardId = card.id;
  call.result = card.id;
  res.status(201).json({ card });
};

/** Change the title or description of a local ticket. */
export const updateTicketHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { id } = parseOrThrow(cardParamsSchema, req.params);
  const patch = parseOrThrow(updateTicketBodySchema, req.body);
  const card = await updateTicket(scopedCard(caller, call, id), patch);
  call.result = card.id;
  res.status(200).json({ card });
};

/** Move a card to a column under the manual move rules. */
export const moveCardHandler: ToolHandler = async (req, res, caller, call) => {
  const { id } = parseOrThrow(cardParamsSchema, req.params);
  const { column } = parseOrThrow(moveBodySchema, req.body);
  const card = await moveTicket(caller, scopedCard(caller, call, id), column);
  call.result = card.column;
  res.status(200).json({ card });
};

/** Add a comment to a card, local or on Linear. */
export const addCommentHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { id } = parseOrThrow(cardParamsSchema, req.params);
  const { body } = parseOrThrow(commentBodySchema, req.body);
  const comment = await commentOnTicket(
    caller,
    scopedCard(caller, call, id),
    body,
  );
  call.result = comment?.id ?? "linear";
  res.status(201).json(comment === null ? { ok: true } : { comment });
};

/** Create a local base branch in a board repository. */
export const createBaseBranchHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const input = parseOrThrow(baseBranchBodySchema, req.body);
  const branch = await createBaseBranch(caller, input);
  call.result = branch.name;
  res.status(201).json(branch);
};

/** Create a group card without starting it. */
export const createGroupHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const input = parseOrThrow(createGroupBodySchema, req.body);
  const card = await createOrchestratorGroup(caller, input);
  call.cardId = card.id;
  call.result = `${card.id} playbook ${card.launch?.playbook ?? "none"}`;
  res.status(201).json({ card });
};

/** Start a group, or queue it behind its dependencies. */
export const startGroupHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { id } = parseOrThrow(cardParamsSchema, req.params);
  const outcome = await startOrchestratorGroup(
    caller,
    scopedCard(caller, call, id),
  );
  call.result = "started" in outcome ? "started" : "queued";
  res.status(202).json(outcome);
};

/** Type text into a running session. */
export const sendInputHandler: ToolHandler = async (req, res, caller, call) => {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, req.params);
  const { text } = parseOrThrow(sendInputBodySchema, req.body);
  const result = await sendInput(
    caller,
    scopedCard(caller, call, cardId),
    text,
  );
  call.result = result;
  res.status(200).json({ result });
};

/** Tell a group loop that its plan is approved. */
export const approveRoadmapHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, req.params);
  const { decisionIds } = parseOrThrow(approveBodySchema, req.body);
  const result = await approveGroupPlan(
    caller,
    scopedCard(caller, call, cardId),
    decisionIds,
  );
  call.result = result;
  res.status(200).json({ result });
};

/** Ask a session loop to hand off its context. */
export const requestHandoffHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, req.params);
  const { hard = false } = parseOrThrow(handoffBodySchema, req.body);
  const result = await requestHandoff(scopedCard(caller, call, cardId), hard);
  call.result = result;
  res.status(202).json({ result });
};

/** Resume a loop stopped by `stop_session` or a supervisor give-up. */
export const resumeLoopHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, req.params);
  const result = await resumeLoop(caller, scopedCard(caller, call, cardId));
  call.result = result;
  res.status(200).json({ result });
};

/** Press Escape in a session pane and park it at `needs_input`. */
export const stopSessionHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, req.params);
  await stopSession(caller, scopedCard(caller, call, cardId));
  call.result = "stopped";
  res.status(200).json({ stopped: true });
};

/** Raise a decision item for the user to answer. */
export const createDecisionItemHandler: ToolHandler = (
  req,
  res,
  caller,
  call,
) => {
  const input = parseOrThrow(createDecisionBodySchema, req.body);
  if (input.cardId) scopedCard(caller, call, input.cardId);
  const item = createDecisionItem(caller, input);
  call.result = item.id;
  res.status(201).json({ item });
};

/** Hold the call until a board event matches or the time limit passes. */
export const waitForEventHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { timeoutSeconds, ...filter } = parseOrThrow(waitBodySchema, req.body);
  const gone = new AbortController();
  res.on("close", () => gone.abort());
  const outcome = await waitForEvent(
    caller.boardKey,
    filter,
    timeoutSeconds * 1000,
    gone.signal,
  );
  if (outcome === null) return;
  if ("event" in outcome)
    recordDelivered(caller.boardKey, caller.orchestratorId, [outcome.event.id]);
  call.result = "event" in outcome ? outcome.event.kind : "timed-out";
  res.status(200).json(outcome);
};

/** Start the ship flow of a finished group card. */
export const startShipHandler: ToolHandler = async (req, res, caller, call) => {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, req.params);
  const input = parseOrThrow(shipBodySchema, req.body);
  const flow = await startShip(
    caller,
    scopedCard(caller, call, cardId, false),
    input,
  );
  call.result = flow.state;
  res.status(202).json({ flow });
};

/** Answer the stored ship flow of a group card. */
export const getShipStateHandler: ToolHandler = (req, res, caller, call) => {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, req.params);
  const flow = scopedCard(caller, call, cardId, false).shipFlow;
  if (!flow) throw new NotFoundError("no-ship-flow");
  call.result = flow.state;
  res.status(200).json({ flow });
};

/** Answer the saved state of the calling orchestrator. */
export const readStateHandler: ToolHandler = (_req, res, caller, call) => {
  const state = readState(caller);
  call.result = `${Buffer.byteLength(state.markdown)} bytes`;
  res.status(200).json(state);
};

/** Replace the saved state of the calling orchestrator. */
export const writeStateHandler: ToolHandler = async (
  req,
  res,
  caller,
  call,
) => {
  const { markdown, handoffReady = false } = parseOrThrow(
    writeStateBodySchema,
    req.body,
  );
  const state = await writeState(caller, markdown, handoffReady);
  call.result = `${Buffer.byteLength(markdown)} bytes`;
  res
    .status(200)
    .json({ updatedAt: state.updatedAt, handoffReady: state.handoffReady });
};
