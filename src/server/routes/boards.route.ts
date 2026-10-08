import { Router } from "express";
import type { z } from "zod";
import { ValidationError } from "../services/domain/errors.js";
import type { OrchestratorIdentity } from "../services/domain/orchestrator-scope.js";
import {
  archiveBoard,
  boardCounts,
  boardRefusal,
  createBoard,
  getBoard,
  isStaticBoardVariant,
  listBoards,
  resolveBoard,
  resolveOpenBoard,
  restoreBoard,
  updateBoard,
} from "../services/orchestration/boards.js";
import { orchestrationSummary } from "../services/orchestration/orchestration-summary.js";
import {
  mintOrchestratorToken,
  revokeOrchestratorToken,
} from "../services/orchestration/orchestrator-tokens.js";
import {
  createBoardBodySchema,
  parseBoardKeyParam,
  orchestrationEventsQuerySchema,
  patchBoardBodySchema,
} from "./boards-schemas.js";
import { httpErrorHandler } from "./error-handler.js";
import { orchestratorIdSchema } from "./orchestrator-schemas.js";
import { parseOrThrow } from "./parse-input.js";
import { boardRepository } from "../store/board-repository.js";

export const boardsRouter = Router({ caseSensitive: true });

/**
 * Parse a board body, turning a schema issue that names a fixed-copy variant into its typed error.
 *
 * @remarks Any other schema issue stays a plain 400 with the issue message as the code.
 */
function parseBoardBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const message = result.error.issues[0]?.message ?? "invalid";
  throw isStaticBoardVariant(message)
    ? boardRefusal(message)
    : new ValidationError(message);
}

boardsRouter.get("/boards", async (_req, res) => {
  res.status(200).json(await listBoards());
});

boardsRouter.get("/boards/counts", (_req, res) => {
  res.status(200).json(boardCounts());
});

boardsRouter.post("/boards", async (req, res) => {
  const input = parseBoardBody(createBoardBodySchema, req.body);
  res.status(201).json({ board: await createBoard(input) });
});

boardsRouter.get("/boards/:key", (req, res) => {
  res.status(200).json({ board: getBoard(parseBoardKeyParam(req.params.key)) });
});

boardsRouter.get("/boards/:key/orchestration", (req, res) => {
  const key = parseBoardKeyParam(req.params.key);
  resolveOpenBoard(key);
  res.status(200).json(orchestrationSummary(key));
});

boardsRouter.get("/boards/:key/orchestration/events", (req, res) => {
  const key = parseBoardKeyParam(req.params.key);
  const { since, limit } = parseOrThrow(
    orchestrationEventsQuerySchema,
    req.query,
  );
  resolveOpenBoard(key);
  const events =
    since === undefined
      ? boardRepository.listLatestOrchestrationEvents(key, limit)
      : boardRepository.listOrchestrationEvents(key, since, limit);
  res.status(200).json({ events });
});

boardsRouter.patch("/boards/:key", async (req, res) => {
  const key = parseBoardKeyParam(req.params.key);
  const patch = parseBoardBody(patchBoardBodySchema, req.body);
  res.status(200).json({ board: await updateBoard(key, patch) });
});

boardsRouter.post("/boards/:key/archive", async (req, res) => {
  res
    .status(200)
    .json({ board: await archiveBoard(parseBoardKeyParam(req.params.key)) });
});

boardsRouter.post("/boards/:key/restore", async (req, res) => {
  res
    .status(200)
    .json({ board: await restoreBoard(parseBoardKeyParam(req.params.key)) });
});

/** The `{ boardKey, orchestratorId }` a token route names, or the typed 400 or 404. */
function orchestratorOf(params: {
  key: string;
  id: string;
}): OrchestratorIdentity {
  const boardKey = parseBoardKeyParam(params.key);
  const orchestratorId = parseOrThrow(orchestratorIdSchema, params.id);
  resolveBoard(boardKey);
  return { boardKey, orchestratorId };
}

boardsRouter.post("/boards/:key/orchestrators/:id/token", (req, res) => {
  res
    .status(201)
    .json({ token: mintOrchestratorToken(orchestratorOf(req.params)) });
});

boardsRouter.delete("/boards/:key/orchestrators/:id/token", (req, res) => {
  res
    .status(200)
    .json({ revoked: revokeOrchestratorToken(orchestratorOf(req.params)) });
});

boardsRouter.use(httpErrorHandler);
