import { Router } from "express";
import { z } from "zod";
import { SESSION_INPUT_MAX } from "../../shared/orchestrator-limits.js";
import { NotFoundError } from "../services/domain/errors.js";
import {
  userResumeLoop,
  userSendInput,
} from "../services/orchestration/orchestrator-sessions.js";
import { boardRepository } from "../store/board-repository.js";
import { httpErrorHandler } from "./error-handler.js";
import { sessionCardParamsSchema } from "./orchestrator-schemas.js";
import { parseOrThrow } from "./parse-input.js";
import { unknownFieldError } from "./schema-primitives.js";

export const sessionInputRouter = Router({ caseSensitive: true });

const inputBodySchema = z.strictObject(
  {
    text: z
      .string("invalid-text")
      .min(1, "invalid-text")
      .max(SESSION_INPUT_MAX, "invalid-text"),
  },
  { error: unknownFieldError("invalid-text") },
);

function cardOf(params: unknown) {
  const { cardId } = parseOrThrow(sessionCardParamsSchema, params);
  const card = boardRepository.getCard(cardId);
  if (!card) throw new NotFoundError("unknown-card");
  return card;
}

sessionInputRouter.post("/sessions/:cardId/input", async (req, res) => {
  const card = cardOf(req.params);
  const { text } = parseOrThrow(inputBodySchema, req.body);
  res.status(200).json({ result: await userSendInput(card, text) });
});

sessionInputRouter.post("/sessions/:cardId/resume-loop", async (req, res) => {
  res.status(200).json({ result: await userResumeLoop(cardOf(req.params)) });
});

sessionInputRouter.use(httpErrorHandler);
