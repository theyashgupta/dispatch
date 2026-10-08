import { Router } from "express";
import { z } from "zod";
import {
  listBoardSessions,
  resolveBoard,
} from "../services/orchestration/boards.js";
import { parseBoardParam } from "./boards-schemas.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import { booleanFilter } from "./schema-primitives.js";

export const sessionsRouter = Router();

const querySchema = z.object(
  {
    live: booleanFilter("invalid live").optional(),
  },
  "invalid live",
);

sessionsRouter.get("/sessions", (req, res) => {
  const { key } = resolveBoard(parseBoardParam(req.query));
  const { live } = parseOrThrow(querySchema, req.query);
  res.status(200).json({ sessions: listBoardSessions(key, live) });
});

sessionsRouter.use(httpErrorHandler);
