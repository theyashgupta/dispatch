import { Router } from "express";
import type { z } from "zod";
import { ValidationError } from "../services/domain/errors.js";
import {
  archiveBoard,
  boardCounts,
  boardRefusal,
  createBoard,
  getBoard,
  isStaticBoardVariant,
  listBoards,
  restoreBoard,
  updateBoard,
} from "../services/orchestration/boards.js";
import {
  createBoardBodySchema,
  parseBoardKeyParam,
  patchBoardBodySchema,
} from "./boards-schemas.js";
import { httpErrorHandler } from "./error-handler.js";

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

boardsRouter.use(httpErrorHandler);
