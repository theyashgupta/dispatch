import { Router } from "express";
import { ConflictError, NotFoundError } from "../services/domain/errors.js";
import {
  redactCard,
  boardRepository as store,
} from "../store/board-repository.js";
import { httpErrorHandler } from "./error-handler.js";
import {
  listQuerySchema,
  promoteBodySchema,
  setStateBodySchema,
  snoozeBodySchema,
} from "./items-schemas.js";
import { parseOrThrow } from "./parse-input.js";

export const itemsRouter = Router();

itemsRouter.get("/items", (req, res) => {
  const { state, source } = parseOrThrow(listQuerySchema, req.query);
  const items = store
    .wireItems()
    .filter((i) => state === undefined || i.state === state)
    .filter((i) => source === undefined || i.source === source);
  res.status(200).json({ items });
});

itemsRouter.post("/items/:id/state", async (req, res) => {
  const { state } = parseOrThrow(setStateBodySchema, req.body);
  const outcome = await store.setItemState(req.params.id, state);
  if (outcome === "unknown") throw new NotFoundError("unknown item");
  if (outcome === "promoted") throw new ConflictError("item is promoted");
  res.status(204).end();
});

itemsRouter.post("/items/:id/snooze", async (req, res) => {
  const { until } = parseOrThrow(snoozeBodySchema, req.body);
  const outcome = await store.snoozeItem(req.params.id, until);
  if (outcome === "unknown") throw new NotFoundError("unknown item");
  if (outcome === "promoted") throw new ConflictError("item is promoted");
  res.status(204).end();
});

itemsRouter.post("/items/:id/promote", async (req, res) => {
  const { context } = parseOrThrow(promoteBodySchema, req.body);
  const result = await store.promoteItem(req.params.id, context);
  if (!result) throw new NotFoundError("unknown item");
  res
    .status(result.created ? 201 : 200)
    .json({ card: redactCard(result.card) });
});

itemsRouter.use(httpErrorHandler);
