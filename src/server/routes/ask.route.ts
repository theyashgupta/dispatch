import { Router } from "express";
import {
  ASK_LIMITS,
  type AskRequest,
  type AskTurn,
} from "../../shared/types.js";
import { AskError, answerAsk } from "../services/orchestration/ask.js";

export const askRouter = Router();

function isTurn(value: unknown): value is AskTurn {
  const turn = value as Partial<AskTurn> | null;
  return (
    typeof turn === "object" &&
    turn !== null &&
    (turn.role === "user" || turn.role === "assistant") &&
    typeof turn.text === "string" &&
    turn.text.length <= ASK_LIMITS.turnText
  );
}

/**
 * Validate an Ask body against `ASK_LIMITS`, or return null.
 */
function parseAskRequest(body: unknown): AskRequest | null {
  const { question, history } = (body ?? {}) as Partial<
    Record<keyof AskRequest, unknown>
  >;
  if (typeof question !== "string") return null;
  const trimmed = question.trim();
  if (trimmed === "" || trimmed.length > ASK_LIMITS.question) return null;
  if (!Array.isArray(history) || history.length > ASK_LIMITS.turns) return null;
  if (!history.every(isTurn)) return null;
  return { question: trimmed, history };
}

let askInFlight = false;

askRouter.post("/ask", (req, res) => {
  const request = parseAskRequest(req.body);
  if (request === null) {
    res.status(400).json({ error: "invalid ask" });
    return;
  }
  if (askInFlight) {
    res.status(409).json({ error: "ask-in-progress" });
    return;
  }
  askInFlight = true;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  answerAsk(request, controller.signal)
    .then((answer) => {
      if (controller.signal.aborted) return;
      res.status(200).json({ answer });
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) return;
      const kind = err instanceof AskError ? err.kind : "exit";
      console.error("[ask] failed:", kind);
      if (kind === "timeout") res.status(504).json({ error: "ask-timeout" });
      else res.status(502).json({ error: "ask-failed" });
    })
    .finally(() => {
      askInFlight = false;
    });
});
