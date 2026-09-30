import { Router, type Request, type Response } from "express";
import { httpErrorHandler } from "./error-handler.js";
import { z } from "zod";
import { parseOrThrow } from "./parse-input.js";
import { boardRepository as store } from "../store/board-repository.js";

export const eventsRouter = Router();

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const querySchema = z.object(
  {
    cardId: z.string("invalid cardId").optional(),
    limit: z
      .string("invalid limit")
      .regex(/^\d+$/, "invalid limit")
      .transform(Number)
      .refine((n) => n >= 1 && n <= MAX_LIMIT, "limit out of range")
      .optional(),
  },
  "invalid cardId",
);

/**
 * REST event log at GET /api/events, newest-first, `?cardId=` scoped, `?limit=` clamped to [1,1000].
 * @remarks A bodyless GET never reaches the shared body-parser JSON-400 middleware, so the query is
 * validated in-route and rejected with a clean JSON 400 BEFORE any store/DB call — a malformed
 * query can never fall through to a raw node:sqlite error rendered as an HTML 500.
 */
function listEventsHandler(req: Request, res: Response): void {
  const { cardId, limit = DEFAULT_LIMIT } = parseOrThrow(
    querySchema,
    req.query,
  );

  res.status(200).json({ events: store.listEvents(cardId ?? null, limit) });
}

eventsRouter.get("/events", listEventsHandler);

eventsRouter.use(httpErrorHandler);
