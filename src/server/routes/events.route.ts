import { Router, type Request, type Response } from "express";
import { store } from "../store/board.store.js";

export const eventsRouter = Router();

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * REST event log at GET /api/events, newest-first, `?cardId=` scoped, `?limit=` clamped to [1,1000].
 * @remarks A bodyless GET never reaches the shared body-parser JSON-400 middleware, so the query is
 * validated in-route and rejected with a clean JSON 400 BEFORE any store/DB call — a malformed
 * query can never fall through to a raw node:sqlite error rendered as an HTML 500.
 */
function listEventsHandler(req: Request, res: Response): void {
  const rawCardId = req.query.cardId;
  if (rawCardId !== undefined && typeof rawCardId !== "string") {
    res.status(400).json({ error: "invalid cardId" });
    return;
  }

  let limit = DEFAULT_LIMIT;
  const rawLimit = req.query.limit;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit)) {
      res.status(400).json({ error: "invalid limit" });
      return;
    }
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_LIMIT) {
      res.status(400).json({ error: "limit out of range" });
      return;
    }
  }

  res.status(200).json({ events: store.listEvents(rawCardId ?? null, limit) });
}

eventsRouter.get("/events", listEventsHandler);
