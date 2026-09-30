import { Router } from "express";
import { z } from "zod";
import { ASK_LIMITS } from "../../shared/types.js";
import {
  ConflictError,
  HttpError,
  UpstreamError,
} from "../services/domain/errors.js";
import { AskError, answerAsk } from "../services/orchestration/ask.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

export const askRouter = Router();

const turnSchema = z.object(
  {
    role: z.enum(["user", "assistant"], "invalid ask"),
    text: z
      .string("invalid ask")
      .refine((text) => text.length <= ASK_LIMITS.turnText, "invalid ask"),
  },
  "invalid ask",
);

/** The `POST /ask` body, checked against `ASK_LIMITS`; the question comes out trimmed. */
const askSchema = z.object(
  {
    question: z
      .string("invalid ask")
      .transform((question) => question.trim())
      .refine(
        (question) => question !== "" && question.length <= ASK_LIMITS.question,
        "invalid ask",
      ),
    history: z
      .array(turnSchema, "invalid ask")
      .refine((history) => history.length <= ASK_LIMITS.turns, "invalid ask"),
  },
  "invalid ask",
);

let askInFlight = false;

askRouter.post("/ask", async (req, res) => {
  const request = parseOrThrow(askSchema, req.body);
  if (askInFlight) throw new ConflictError("ask-in-progress");
  askInFlight = true;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const answer = await answerAsk(request, controller.signal);
    if (controller.signal.aborted) return;
    res.status(200).json({ answer });
  } catch (err) {
    if (controller.signal.aborted) return;
    const kind = err instanceof AskError ? err.kind : "exit";
    console.error("[ask] failed:", kind);
    if (kind === "timeout") throw new HttpError(504, "ask-timeout");
    throw new UpstreamError("ask-failed");
  } finally {
    askInFlight = false;
  }
});

askRouter.use(httpErrorHandler);
