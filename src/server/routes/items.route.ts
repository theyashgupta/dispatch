import { Router, type Request, type Response } from "express";
import type { ItemState, SettableItemState } from "../../shared/types.js";
import { ITEM_STATES } from "../../shared/types.js";
import { redactCard, store } from "../store/board.store.js";

export const itemsRouter = Router();

const MAX_SNOOZE_MS = Date.UTC(9999, 11, 31, 23, 59, 59);

function isItemState(value: unknown): value is ItemState {
  return (
    typeof value === "string" &&
    (ITEM_STATES as readonly string[]).includes(value)
  );
}

function isSettableState(value: unknown): value is SettableItemState {
  return isItemState(value) && value !== "snoozed";
}

/** A future ISO time, normalized; undefined when malformed or not in the future. */
function futureIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= Date.now() || ms > MAX_SNOOZE_MS)
    return undefined;
  return new Date(ms).toISOString();
}

function listItemsHandler(req: Request, res: Response): void {
  const rawState = req.query.state;
  if (rawState !== undefined && !isItemState(rawState)) {
    res.status(400).json({ error: "invalid state" });
    return;
  }
  const rawSource = req.query.source;
  if (rawSource !== undefined && typeof rawSource !== "string") {
    res.status(400).json({ error: "invalid source" });
    return;
  }
  const items = store
    .wireItems()
    .filter((i) => rawState === undefined || i.state === rawState)
    .filter((i) => rawSource === undefined || i.source === rawSource);
  res.status(200).json({ items });
}

itemsRouter.get("/items", listItemsHandler);

itemsRouter.post("/items/:id/state", async (req, res) => {
  const state = (req.body as { state?: unknown } | undefined)?.state;
  if (!isSettableState(state)) {
    res.status(400).json({ error: "invalid state" });
    return;
  }
  const outcome = await store.setItemState(req.params.id, state);
  if (outcome === "unknown") {
    res.status(404).json({ error: "unknown item" });
    return;
  }
  if (outcome === "promoted") {
    res.status(409).json({ error: "item is promoted" });
    return;
  }
  res.status(204).end();
});

itemsRouter.post("/items/:id/snooze", async (req, res) => {
  const until = futureIso((req.body as { until?: unknown } | undefined)?.until);
  if (until === undefined) {
    res.status(400).json({ error: "until must be a future ISO time" });
    return;
  }
  const outcome = await store.snoozeItem(req.params.id, until);
  if (outcome === "unknown") {
    res.status(404).json({ error: "unknown item" });
    return;
  }
  if (outcome === "promoted") {
    res.status(409).json({ error: "item is promoted" });
    return;
  }
  res.status(204).end();
});

itemsRouter.post("/items/:id/promote", async (req, res) => {
  const result = await store.promoteItem(req.params.id);
  if (!result) {
    res.status(404).json({ error: "unknown item" });
    return;
  }
  res
    .status(result.created ? 201 : 200)
    .json({ card: redactCard(result.card) });
});
