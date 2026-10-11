import { Router } from "express";
import { resolveBoard } from "../services/orchestration/boards.js";
import { readOrchestratorConversation } from "../services/orchestration/orchestrator-conversation.js";
import {
  addOrchestrator,
  editOrchestrator,
  listOrchestrators,
  removeOrchestrator,
  resumeOrchestrator,
  startOrchestrator,
  stopOrchestrator,
} from "../services/orchestration/orchestrator-session.js";
import { parseBoardKeyParam } from "./boards-schemas.js";
import { httpErrorHandler, orFail } from "./error-handler.js";
import {
  addBodySchema,
  conversationQuerySchema,
  editBodySchema,
  orchestratorIdSchema,
} from "./orchestrators-schemas.js";
import { refuseOrchestratorToken } from "./orchestrator.route.js";
import { parseOrThrow } from "./parse-input.js";

export const orchestratorsRouter = Router({ caseSensitive: true });

orchestratorsRouter.get("/boards/:key/orchestrators", (req, res) => {
  const board = resolveBoard(parseBoardKeyParam(req.params.key));
  res.status(200).json({ orchestrators: listOrchestrators(board) });
});

orchestratorsRouter.get(
  "/boards/:key/orchestrators/:id/conversation",
  async (req, res) => {
    refuseOrchestratorToken(req);
    const board = resolveBoard(parseBoardKeyParam(req.params.key));
    const id = parseOrThrow(orchestratorIdSchema, req.params.id);
    const { limit } = parseOrThrow(conversationQuerySchema, req.query);
    res.status(200).json(await readOrchestratorConversation(board, id, limit));
  },
);

orchestratorsRouter.post("/boards/:key/orchestrators", async (req, res) => {
  const board = resolveBoard(parseBoardKeyParam(req.params.key));
  const input = parseOrThrow(addBodySchema, req.body);
  res.status(201).json({ orchestrator: await addOrchestrator(board, input) });
});

orchestratorsRouter.patch(
  "/boards/:key/orchestrators/:id",
  async (req, res) => {
    const board = resolveBoard(parseBoardKeyParam(req.params.key));
    const patch = parseOrThrow(editBodySchema, req.body);
    const id = parseOrThrow(orchestratorIdSchema, req.params.id);
    res
      .status(200)
      .json({ orchestrator: await editOrchestrator(board, id, patch) });
  },
);

orchestratorsRouter.delete(
  "/boards/:key/orchestrators/:id",
  async (req, res) => {
    const board = resolveBoard(parseBoardKeyParam(req.params.key));
    await removeOrchestrator(
      board,
      parseOrThrow(orchestratorIdSchema, req.params.id),
    );
    res.status(204).end();
  },
);

orchestratorsRouter.post(
  "/boards/:key/orchestrators/:id/start",
  async (req, res) => {
    const board = resolveBoard(parseBoardKeyParam(req.params.key));
    const id = parseOrThrow(orchestratorIdSchema, req.params.id);
    const { record } = await orFail(
      "orchestrator-start-failed",
      () => startOrchestrator(board, id),
      "[orchestrator] start failed:",
    );
    res.status(202).json({ orchestrator: record });
  },
);

orchestratorsRouter.post(
  "/boards/:key/orchestrators/:id/stop",
  async (req, res) => {
    const board = resolveBoard(parseBoardKeyParam(req.params.key));
    const { record } = await stopOrchestrator(
      board,
      parseOrThrow(orchestratorIdSchema, req.params.id),
    );
    res.status(202).json({ orchestrator: record });
  },
);

orchestratorsRouter.post(
  "/boards/:key/orchestrators/:id/resume",
  async (req, res) => {
    const board = resolveBoard(parseBoardKeyParam(req.params.key));
    const id = parseOrThrow(orchestratorIdSchema, req.params.id);
    const { record } = await orFail(
      "orchestrator-resume-failed",
      () => resumeOrchestrator(board, id),
      "[orchestrator] resume failed:",
    );
    res.status(202).json({ orchestrator: record });
  },
);

orchestratorsRouter.use(httpErrorHandler);
