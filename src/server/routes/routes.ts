import { Router } from "express";
import { COLUMNS, type Column } from "../../shared/types.js";
import { store } from "../store/boardStore.js";
import { sseHandler } from "./sse.js";
import { isLocalRequest } from "./loopback.js";
import { startSession } from "../services/startSession.js";
import { resumeSession } from "../services/resumeSession.js";
import { cleanupWorkspace } from "../services/cleanup.js";
import { ensureTerminal } from "../services/terminal.js";
import { editorPath, launchEditor } from "../adapters/editors.js";
import { getOrchestrationConfig } from "../services/config-holder.js";
import { validateOrchestrationConfig } from "../services/validateConfig.js";

export const apiRouter = Router();

apiRouter.use((req, res, next) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "non-local requests are not allowed" });
    return;
  }
  next();
});

apiRouter.get("/board", (_req, res) => {
  res.status(200).json(store.snapshot());
});

apiRouter.get("/events", sseHandler);

apiRouter.post("/cards/:id/move", async (req, res) => {
  const { id } = req.params;
  const column = (req.body as { column?: unknown } | undefined)?.column;

  if (typeof column !== "string" || !COLUMNS.includes(column as Column)) {
    res
      .status(400)
      .json({ error: `invalid column; must be one of: ${COLUMNS.join(", ")}` });
    return;
  }
  if (!store.hasCard(id)) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  await store.moveCardManual(id, column as Column);
  res.status(200).json(store.snapshot());
});

apiRouter.post("/cards/:id/start", (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (card.column === "done") {
    res.status(409).json({ error: "cannot start a session for a Done card" });
    return;
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    res
      .status(400)
      .json({ error: `invalid ticket identifier: ${card.identifier}` });
    return;
  }

  const config = getOrchestrationConfig();
  if (!config) {
    res
      .status(400)
      .json({ error: "orchestration config is not loaded", variant: "config" });
    return;
  }
  const configError = validateOrchestrationConfig(config);
  if (configError) {
    res.status(400).json({ error: configError, variant: "config" });
    return;
  }

  const body = req.body as { extraDirection?: unknown } | undefined;
  const extraDirection =
    typeof body?.extraDirection === "string" ? body.extraDirection : "";

  void startSession(id, extraDirection, config);
  res.status(202).json({ started: true });
});

apiRouter.post("/cards/:id/resume", (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (card.column === "done") {
    res.status(409).json({ error: "cannot resume a session for a Done card" });
    return;
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    res
      .status(400)
      .json({ error: `invalid ticket identifier: ${card.identifier}` });
    return;
  }

  if (!card.workspacePath) {
    res.status(400).json({ error: "card has no workspace to resume" });
    return;
  }

  if (card.tmuxSession) {
    res.status(409).json({ error: "session is already live" });
    return;
  }

  if (card.sessionLost !== true) {
    res.status(409).json({ error: "card has no lost session to resume" });
    return;
  }

  if (store.isStarting(id)) {
    res.status(409).json({ error: "a start is in flight for this card" });
    return;
  }

  void resumeSession(id);
  res.status(202).json({ resuming: true });
});

apiRouter.post("/cards/:id/terminal", (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (!card.tmuxSession) {
    res.status(400).json({ error: "card has no live session" });
    return;
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    res
      .status(400)
      .json({ error: `invalid ticket identifier: ${card.identifier}` });
    return;
  }

  void ensureTerminal(card.id, card.tmuxSession);
  res.status(202).json({ ensuring: true });
});

apiRouter.post("/cards/:id/open-editor", (req, res) => {
  const { id } = req.params;

  const editor = (req.body as { editor?: unknown } | undefined)?.editor;
  if (editor !== "code" && editor !== "cursor") {
    res
      .status(400)
      .json({ error: `invalid editor; must be one of: code, cursor` });
    return;
  }

  if (editorPath(editor) == null) {
    res.status(400).json({ error: `editor "${editor}" is not available` });
    return;
  }

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (!card.workspacePath) {
    res.status(400).json({ error: "card has no workspace" });
    return;
  }

  void launchEditor(editor, card.workspacePath).catch((err) => {
    console.error(`[open-editor] launch failed for card ${id}:`, err);
  });
  res.status(204).end();
});

apiRouter.post("/cards/:id/cleanup", (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }
  if (card.column !== "done") {
    res.status(409).json({ error: "cleanup is only available for Done cards" });
    return;
  }
  if (store.isStarting(id)) {
    res.status(409).json({ error: "a start is in flight for this card" });
    return;
  }

  void cleanupWorkspace(id).catch((err) => {
    console.error(`[cleanup] failed for card ${id}:`, (err as Error).message);
  });
  res.status(202).json({ cleaning: true });
});
