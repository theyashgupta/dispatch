import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { ORCHESTRATOR_TOKEN_HEADER } from "../../shared/orchestrator-limits.js";
import type { BoardKey } from "../../shared/types.js";
import {
  ForbiddenError,
  HttpError,
  UnauthorizedError,
} from "../services/domain/errors.js";
import type { OrchestratorIdentity } from "../services/domain/orchestrator-scope.js";
import { resolveOrchestratorToken } from "../services/orchestration/orchestrator-tokens.js";
import { boardRepository } from "../store/board-repository.js";
import { httpErrorHandler } from "./error-handler.js";
import {
  addCommentHandler,
  approveRoadmapHandler,
  createBaseBranchHandler,
  createDecisionItemHandler,
  createGroupHandler,
  createTicketHandler,
  getCardHandler,
  getGroupProgressHandler,
  getPolicyHandler,
  getShipStateHandler,
  listCardsHandler,
  listEventsHandler,
  listSessionsHandler,
  moveCardHandler,
  readPaneTailHandler,
  readStateHandler,
  requestHandoffHandler,
  resumeLoopHandler,
  sendInputHandler,
  startGroupHandler,
  startShipHandler,
  stopSessionHandler,
  updateTicketHandler,
  waitForEventHandler,
  writeStateHandler,
  type ToolCall,
  type ToolHandler,
} from "./orchestrator.handlers.js";
import { orchestratorTokenHeaderSchema } from "./orchestrator-schemas.js";

const UNAUTHENTICATED_BOARD = "-" as BoardKey;
const ARG_TEXT_MAX = 4096;

export const orchestratorRouter = Router({ caseSensitive: true });

/** Copy a value with every string inside it cut to {@link ARG_TEXT_MAX} characters. */
function clipStrings(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, ARG_TEXT_MAX);
  if (Array.isArray(value)) return value.map(clipStrings);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, clipStrings(v)]),
    );
  }
  return value;
}

/**
 * Append the one `tool_call` event of a finished orchestrator call, accepted or refused.
 *
 * @remarks A call with no token or an unknown token goes under board `-`, which no board read lists.
 * It runs from the response `close` listener, so a failed write is logged and never thrown.
 */
function recordToolCall(res: Response, call: ToolCall): void {
  const err = call.error;
  const code =
    err instanceof HttpError
      ? err.code
      : err === undefined
        ? undefined
        : "internal-error";
  const reason =
    err instanceof HttpError && typeof err.details?.reason === "string"
      ? err.details.reason
      : code;
  try {
    boardRepository.appendOrchestrationEvent({
      boardKey: call.caller?.boardKey ?? UNAUTHENTICATED_BOARD,
      cardId: call.cardId,
      sessionId: null,
      kind: "tool_call",
      data: {
        orchestratorId: call.caller?.orchestratorId ?? null,
        tool: call.tool,
        args: call.args,
        status: res.statusCode,
        result: code ?? call.result,
        ...(reason === undefined ? {} : { reason }),
      },
      ts: new Date().toISOString(),
    });
  } catch (failure) {
    console.error(
      `[orchestrator] tool_call record failed for ${call.tool}:`,
      (failure as Error).message,
    );
  }
}

/**
 * The params, query and body of a call, kept apart, with every string cut.
 *
 * @remarks They stay apart so a query or body key can never stand in for a path param in the
 * record. They are read at entry because Express resets `req.params` before the error handler.
 */
function argsOf(req: Request): unknown {
  const body = req.body as unknown;
  const parts = {
    params: { ...req.params },
    query: { ...(req.query as Record<string, unknown>) },
    body: typeof body === "object" && body !== null ? body : {},
  };
  return clipStrings(
    Object.fromEntries(
      Object.entries(parts).filter(([, v]) => Object.keys(v).length > 0),
    ),
  );
}

/** The card a call names in its path, before any check, so a refused call still points at it. */
function claimedCardId(req: Request): string | null {
  const id = req.params.id ?? req.params.cardId;
  return typeof id === "string" ? id.slice(0, 64) : null;
}

/**
 * Resolve the call's token to its orchestrator, or throw the typed 401.
 *
 * @remarks A revoked token sets the caller before the refusal, so the record lands on its board.
 */
function authenticate(req: Request, call: ToolCall): OrchestratorIdentity {
  const header = orchestratorTokenHeaderSchema.safeParse(
    req.headers[ORCHESTRATOR_TOKEN_HEADER],
  );
  if (!header.success) {
    throw new UnauthorizedError("orchestrator-token-required");
  }
  const entry = resolveOrchestratorToken(header.data);
  if (!entry) throw new UnauthorizedError("orchestrator-token-invalid");
  call.caller = {
    boardKey: entry.boardKey,
    orchestratorId: entry.orchestratorId,
  };
  if (entry.revoked) throw new UnauthorizedError("orchestrator-token-invalid");
  return call.caller;
}

/**
 * Wrap an orchestrator route so it authenticates first and records exactly one `tool_call` row.
 *
 * @remarks The record runs on the response `close` event, so a refusal answered later by the error
 * handler is recorded with its final status too. A close before the response finished means the
 * client went away, recorded as `client-closed`.
 */
function tool(name: string, handler: ToolHandler): RequestHandler {
  return async (req, res) => {
    const call: ToolCall = {
      tool: name,
      args: argsOf(req),
      caller: null,
      cardId: claimedCardId(req),
      result: null,
      error: undefined,
    };
    res.on("close", () => {
      if (!res.writableFinished) call.result = "client-closed";
      recordToolCall(res, call);
    });
    try {
      await handler(req, res, authenticate(req, call), call);
    } catch (err) {
      call.error = err;
      throw err;
    }
  };
}

/**
 * Refuse a state-changing user route call that carries an orchestrator token.
 *
 * @remarks Mounted once at the top of the API router, so every user route outside `/orchestrator`
 * is covered, the token mint route included.
 */
export const refuseOrchestratorTokenOnUserRoute: RequestHandler = (
  req,
  _res,
  next,
) => {
  const userRoute =
    req.path !== "/orchestrator" && !req.path.startsWith("/orchestrator/");
  const readOnly = req.method === "GET" || req.method === "HEAD";
  if (
    userRoute &&
    !readOnly &&
    req.headers[ORCHESTRATOR_TOKEN_HEADER] !== undefined
  ) {
    throw new ForbiddenError("orchestrator-token-on-user-route");
  }
  next();
};

orchestratorRouter.get("/cards", tool("list_cards", listCardsHandler));
orchestratorRouter.get("/cards/:id", tool("get_card", getCardHandler));
orchestratorRouter.get("/sessions", tool("list_sessions", listSessionsHandler));
orchestratorRouter.get(
  "/groups/:id/progress",
  tool("get_group_progress", getGroupProgressHandler),
);
orchestratorRouter.get(
  "/sessions/:cardId/pane",
  tool("read_pane_tail", readPaneTailHandler),
);
orchestratorRouter.get("/events", tool("list_events", listEventsHandler));
orchestratorRouter.get("/policy", tool("get_policy", getPolicyHandler));
orchestratorRouter.post("/tickets", tool("create_ticket", createTicketHandler));
orchestratorRouter.patch(
  "/tickets/:id",
  tool("update_ticket", updateTicketHandler),
);
orchestratorRouter.post(
  "/tickets/:id/move",
  tool("move_card", moveCardHandler),
);
orchestratorRouter.post(
  "/tickets/:id/comments",
  tool("add_comment", addCommentHandler),
);
orchestratorRouter.post(
  "/base-branches",
  tool("create_base_branch", createBaseBranchHandler),
);
orchestratorRouter.post("/groups", tool("create_group", createGroupHandler));
orchestratorRouter.post(
  "/groups/:id/start",
  tool("start_group", startGroupHandler),
);
orchestratorRouter.post(
  "/sessions/:cardId/input",
  tool("send_input", sendInputHandler),
);
orchestratorRouter.post(
  "/groups/:cardId/approve-roadmap",
  tool("approve_roadmap", approveRoadmapHandler),
);
orchestratorRouter.post(
  "/sessions/:cardId/handoff",
  tool("request_handoff", requestHandoffHandler),
);
orchestratorRouter.post(
  "/sessions/:cardId/resume",
  tool("resume_loop", resumeLoopHandler),
);
orchestratorRouter.post(
  "/sessions/:cardId/stop",
  tool("stop_session", stopSessionHandler),
);
orchestratorRouter.post(
  "/decisions",
  tool("create_decision_item", createDecisionItemHandler),
);
orchestratorRouter.post(
  "/events/wait",
  tool("wait_for_event", waitForEventHandler),
);
orchestratorRouter.post(
  "/groups/:cardId/ship",
  tool("start_ship", startShipHandler),
);
orchestratorRouter.get(
  "/groups/:cardId/ship",
  tool("get_ship_state", getShipStateHandler),
);
orchestratorRouter.get("/state", tool("read_state", readStateHandler));
orchestratorRouter.put("/state", tool("write_state", writeStateHandler));

orchestratorRouter.use(httpErrorHandler);
