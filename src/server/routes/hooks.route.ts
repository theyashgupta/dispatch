import { Router, type Request, type Response } from "express";
import { resolveHookToken } from "../services/hook-tokens.js";
import { applyPromptSubmit, applyStopEvent } from "../services/hook-events.js";

export const hooksRouter = Router();

/**
 * Warn-once latch for a Stop payload whose last_assistant_message is missing or non-string —
 * the payload-shape regression guard: a CLI upgrade that drops the field degrades to the pane
 * watcher with one content-free log line, never a crash or per-turn log spam.
 */
let warnedStopShape = false;

/**
 * Token-gated hook ingestion for POST /hook/claude: the x-dispatch-token header IS the auth
 * (any local process can reach the loopback port), and card identity derives exclusively from
 * the token registry — ids claimed in the body are ignored, so a valid token for one card can
 * never move another. A timing-safe compare is deliberately not layered on the Map lookup:
 * loopback-only reach plus a 256-bit random token makes a timing oracle irrelevant on this
 * single-user machine (accepted in the phase threat register). Unknown events fall through to
 * 204 so future CLI additions stay no-ops. Rejections propagate to Express 5 error middleware.
 * Never logs tokens, payloads, or message content.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
async function handleHookEvent(req: Request, res: Response): Promise<void> {
  const token = req.headers["x-dispatch-token"];
  const cardId =
    typeof token === "string" && token.length > 0
      ? resolveHookToken(token)
      : undefined;
  if (!cardId) {
    res.status(401).json({ error: "invalid hook token" });
    return;
  }
  const body = req.body as
    { hook_event_name?: unknown; last_assistant_message?: unknown } | undefined;
  if (body?.hook_event_name === "Stop") {
    if (typeof body.last_assistant_message === "string") {
      await applyStopEvent(cardId, body.last_assistant_message);
    } else if (!warnedStopShape) {
      warnedStopShape = true;
      console.warn(
        "[hooks] Stop payload without a string last_assistant_message; degrading to the pane watcher",
      );
    }
  } else if (body?.hook_event_name === "UserPromptSubmit") {
    await applyPromptSubmit(cardId);
  }
  res.status(204).end();
}

hooksRouter.post("/hook/claude", handleHookEvent);
