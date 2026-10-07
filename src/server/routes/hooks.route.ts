import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { resolveHookToken } from "../services/orchestration/hook-tokens.js";
import { applyHookEvent } from "../services/orchestration/hook-events.js";
import { HttpError } from "../services/domain/errors.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import { fieldsOf } from "./schema-primitives.js";

export const hooksRouter = Router();

/** The payload fields the hook handler reads; any other body reads as none, so it never fails. */
const hookBodySchema = z.preprocess(
  fieldsOf,
  z.object({
    hook_event_name: z.unknown().optional(),
    last_assistant_message: z.unknown().optional(),
    session_id: z.unknown().optional(),
    tool_name: z.unknown().optional(),
    tool_use_id: z.unknown().optional(),
    error: z.unknown().optional(),
    transcript_path: z.unknown().optional(),
  }),
);

/**
 * Warn-once latch for a Stop payload whose last_assistant_message is missing or non-string —
 * the payload-shape regression guard: a CLI upgrade that drops the field degrades to the pane
 * watcher with one content-free log line, never a crash or per-turn log spam.
 */
let warnedStopShape = false;

/**
 * Token-gated hook ingestion for POST /hook/claude: the x-dispatch-token header IS the auth
 * (any local process can reach the loopback port), and card AND session identity derive
 * exclusively from the token registry — ids claimed in the body are ignored, so a valid token
 * minted for one session can never move another. A timing-safe compare is deliberately
 * not layered on the Map lookup: loopback-only reach plus a 256-bit random token makes a timing
 * oracle irrelevant on this single-user machine (accepted in the phase threat register). Unknown
 * events fall through to 204 so future CLI additions stay no-ops. Rejections propagate to
 * Express 5 error middleware. Never logs tokens, payloads, or message content.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
async function handleHookEvent(req: Request, res: Response): Promise<void> {
  const token = req.headers["x-dispatch-token"];
  const entry =
    typeof token === "string" && token.length > 0
      ? resolveHookToken(token)
      : undefined;
  if (!entry) throw new HttpError(401, "invalid hook token");
  const body = parseOrThrow(hookBodySchema, req.body);
  if (
    body.hook_event_name === "Stop" &&
    typeof body.last_assistant_message !== "string" &&
    !warnedStopShape
  ) {
    warnedStopShape = true;
    console.warn(
      "[hooks] Stop payload without a string last_assistant_message; degrading to the pane watcher",
    );
  }
  await applyHookEvent(entry.cardId, entry.sessionId, body);
  res.status(204).end();
}

hooksRouter.post("/hook/claude", handleHookEvent);

hooksRouter.use(httpErrorHandler);
