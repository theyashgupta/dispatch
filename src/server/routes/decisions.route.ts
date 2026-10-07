import { Router } from "express";
import { z } from "zod";
import { answerDecisionItem } from "../services/orchestration/decision-items.js";
import { boardRepository } from "../store/board-repository.js";
import { resolveBoard } from "../services/orchestration/boards.js";
import { parseBoardParam } from "./boards-schemas.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

export const decisionsRouter = Router({ caseSensitive: true });

const listQuerySchema = z.object({
  state: z.enum(["open", "answered"], "invalid-state").optional(),
});

const idParamsSchema = z.object({
  id: z.string("unknown-decision").min(1, "unknown-decision").max(200),
});

const answerBodySchema = z.object(
  {
    optionId: z.string("invalid-option").min(1, "invalid-option").max(40),
    note: z.string("invalid-note").max(2000, "invalid-note").optional(),
  },
  "invalid-option",
);

decisionsRouter.get("/decisions", (req, res) => {
  const { state } = parseOrThrow(listQuerySchema, req.query);
  const { key } = resolveBoard(parseBoardParam(req.query));
  res
    .status(200)
    .json({ items: boardRepository.listDecisionItems(key, state) });
});

decisionsRouter.post("/decisions/:id/answer", (req, res) => {
  const { id } = parseOrThrow(idParamsSchema, req.params);
  const { optionId, note } = parseOrThrow(answerBodySchema, req.body);
  const item = answerDecisionItem(id, { optionId, note: note ?? null });
  res.status(200).json({ item });
});

decisionsRouter.use(httpErrorHandler);
