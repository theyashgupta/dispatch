import { Router } from "express";
import {
  COLUMNS,
  DEFAULT_FILTERS,
  type Column,
  type SourceFilters,
} from "../../shared/types.js";
import { store } from "../store/board.store.js";
import { sseHandler } from "./sse.js";
import { isLocalRequest } from "./loopback.js";
import { startSession } from "../services/startSession.js";
import { resumeSession } from "../services/resumeSession.js";
import { cleanupWorkspace } from "../services/cleanup.js";
import { ensureTerminal } from "../services/terminal.js";
import { editorPath, launchEditor } from "../adapters/editors.js";
import {
  getOrchestrationConfig,
  updateSourceFilters,
} from "../services/config-holder.js";
import {
  getSourceCapabilities,
  listSourceOptions,
  countSourceMatches,
  SourceNotFound,
} from "../adapters/source-gateway.js";
import { pollNow } from "../adapters/poller.js";
import {
  expandPath,
  validateFolder,
  discoverRepos,
  restatRepos,
} from "../services/workspaces.js";
import { loadPlaybooks } from "../services/playbooks.js";
import { buildFollowupKickoff } from "../services/kickoff.js";
import { sendFollowupKickoff } from "../services/steps.js";

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

apiRouter.post("/cards/:id/start", async (req, res) => {
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

  const body = req.body as
    | {
        extraDirection?: unknown;
        folder?: unknown;
        repos?: unknown;
        playbook?: unknown;
        targetColumn?: unknown;
      }
    | undefined;
  const extraDirection =
    typeof body?.extraDirection === "string" ? body.extraDirection : "";
  const playbook =
    typeof body?.playbook === "string" ? body.playbook : undefined;
  const targetColumn =
    body?.targetColumn === "in_planning"
      ? "in_planning"
      : body?.targetColumn === "in_progress"
        ? "in_progress"
        : undefined;

  if (playbook !== undefined) {
    const stage =
      targetColumn === "in_planning" ||
      (targetColumn === undefined && card.mode === "planning")
        ? "planning"
        : "implementation";
    const known = (await loadPlaybooks(stage)).some((p) => p.name === playbook);
    if (!known) {
      res.status(400).json({ error: "unknown playbook", variant: "config" });
      return;
    }
  }

  const folder = body?.folder;
  const rawRepos = body?.repos;
  const hasWorkspacePayload =
    typeof folder === "string" &&
    Array.isArray(rawRepos) &&
    rawRepos.length > 0 &&
    rawRepos.every(
      (r) =>
        r !== null &&
        typeof r === "object" &&
        typeof (r as { path?: unknown }).path === "string" &&
        typeof (r as { base?: unknown }).base === "string",
    );

  if (hasWorkspacePayload) {
    const repos = (rawRepos as { path: string; base: string }[]).map((r) => ({
      path: r.path,
      base: r.base,
    }));
    if (repos.some((r) => r.base.startsWith("-"))) {
      res.status(400).json({
        error: "invalid base branch",
        variant: "config",
      });
      return;
    }
    if (!(await restatRepos(repos))) {
      res.status(400).json({
        error: "Can't start — a selected repo is missing",
        variant: "config",
      });
      return;
    }
    await store.setCardWorkspace(id, { folder, repos });
  } else if (!card.workspace) {
    res.status(400).json({
      error: "No workspace selected for this ticket",
      variant: "config",
    });
    return;
  }

  void startSession(id, extraDirection, config, { playbook, targetColumn });
  res.status(202).json({ started: true });
});

apiRouter.post("/cards/:id/kickoff", async (req, res) => {
  const { id } = req.params;

  const card = store.getCard(id);
  if (!card) {
    res.status(400).json({ error: `unknown card id: ${id}` });
    return;
  }

  if (!/^[A-Za-z0-9]+-\d+$/.test(card.identifier)) {
    res
      .status(400)
      .json({ error: `invalid ticket identifier: ${card.identifier}` });
    return;
  }

  if (store.isStarting(id)) {
    res.status(409).json({ error: "a start is in flight for this card" });
    return;
  }

  if (!card.tmuxSession) {
    res.status(409).json({ error: "card has no live session to hand off" });
    return;
  }

  if (card.column !== "in_planning" || card.planReady !== true) {
    res.status(409).json({ error: "card is not ready to hand off" });
    return;
  }

  const body = req.body as { playbook?: unknown; extra?: unknown } | undefined;
  if (body?.playbook !== undefined && typeof body.playbook !== "string") {
    res.status(400).json({ error: "invalid playbook" });
    return;
  }
  const playbook =
    typeof body?.playbook === "string" ? body.playbook : undefined;
  const extra = typeof body?.extra === "string" ? body.extra : "";

  const playbookBody = playbook
    ? (await loadPlaybooks("implementation")).find((p) => p.name === playbook)
        ?.body
    : undefined;
  if (playbook !== undefined && playbookBody === undefined) {
    res.status(409).json({ error: "unknown playbook" });
    return;
  }

  try {
    await sendFollowupKickoff(
      card.identifier,
      buildFollowupKickoff(playbookBody, extra),
    );
  } catch {
    res
      .status(409)
      .json({ error: "the live session is gone — resume it and retry" });
    return;
  }
  await store.handoffToImplementation(id);
  res.status(202).json({ handedOff: true });
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

apiRouter.get("/workspace-folders", (_req, res) => {
  const snap = store.snapshot();
  res.status(200).json({
    folders: snap.workspaceFolders ?? [],
    lastUsed: snap.lastUsed ?? null,
  });
});

apiRouter.post("/workspace-folders", async (req, res) => {
  const rawPath = (req.body as { path?: unknown } | undefined)?.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    res.status(400).json({ error: "path is required" });
    return;
  }

  const abs = expandPath(rawPath);
  const status = await validateFolder(abs);
  if (status === "missing") {
    res.status(400).json({ error: "Folder doesn't exist" });
    return;
  }
  if (status === "not-a-folder") {
    res.status(400).json({ error: "Not a folder" });
    return;
  }

  const repos = await discoverRepos(abs);
  if (repos.length === 0) {
    res.status(400).json({ error: "No git repositories found in this folder" });
    return;
  }

  await store.addWorkspaceFolder(abs);
  res.status(200).json({ repos });
});

apiRouter.get("/playbooks", async (req, res) => {
  const rawStage = req.query.stage;
  const stage =
    rawStage === "planning" || rawStage === "implementation"
      ? rawStage
      : undefined;
  if (rawStage !== undefined && stage === undefined) {
    res.status(400).json({ error: "Invalid stage" });
    return;
  }

  const playbooks = await loadPlaybooks(stage);
  res.status(200).json({ playbooks });
});

apiRouter.get("/workspace-folders/discover", async (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    res.status(400).json({ error: "path is required" });
    return;
  }

  const repos = await discoverRepos(expandPath(rawPath));
  res.status(200).json({ repos });
});

apiRouter.delete("/workspace-folders", async (req, res) => {
  const rawPath = (req.body as { path?: unknown } | undefined)?.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    res.status(400).json({ error: "path is required" });
    return;
  }

  await store.removeWorkspaceFolder(expandPath(rawPath));
  res.status(200).json({ ok: true });
});

/**
 * Validate an untrusted PUT/POST filter body before it can reach the secret-adjacent config file or
 * an upstream query. It rejects any non-array/non-boolean shape AND any key beyond the four declared
 * dimensions, so an unknown dimension can never be persisted or forwarded to Linear (tampering guard).
 */
function isValidFilters(x: unknown): x is SourceFilters {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const allowed = new Set(["assignees", "projects", "teams", "currentCycle"]);
  if (Object.keys(o).some((k) => !allowed.has(k))) return false;
  const isStrArray = (v: unknown): boolean =>
    Array.isArray(v) && v.every((s) => typeof s === "string");
  return (
    isStrArray(o.assignees) &&
    isStrArray(o.projects) &&
    isStrArray(o.teams) &&
    typeof o.currentCycle === "boolean"
  );
}

apiRouter.get("/sources/:source/filters", (req, res) => {
  const { source } = req.params;
  try {
    const capabilities = getSourceCapabilities(source);
    const filters =
      getOrchestrationConfig()?.sources?.linear?.filters ?? DEFAULT_FILTERS;
    res.status(200).json({ filters, capabilities });
  } catch (err) {
    if (err instanceof SourceNotFound) {
      res.status(404).json({ error: "unknown source" });
      return;
    }
    throw err;
  }
});

apiRouter.get("/sources/:source/options", async (req, res) => {
  const { source } = req.params;
  const dimension = req.query.dimension;
  if (
    dimension !== "assignees" &&
    dimension !== "projects" &&
    dimension !== "teams"
  ) {
    res.status(400).json({ error: "invalid dimension" });
    return;
  }
  try {
    const { options, truncated } = await listSourceOptions(source, dimension);
    res.status(200).json({ options, truncated });
  } catch (err) {
    if (err instanceof SourceNotFound) {
      res.status(404).json({ error: "unknown source" });
      return;
    }
    res.status(502).json({ error: "source options unavailable" });
  }
});

apiRouter.post("/sources/:source/preview", async (req, res) => {
  const { source } = req.params;
  const filters = (req.body as { filters?: unknown } | undefined)?.filters;
  if (!isValidFilters(filters)) {
    res.status(400).json({ error: "invalid filters" });
    return;
  }
  try {
    const { count, more } = await countSourceMatches(source, filters);
    res.status(200).json({ count, more });
  } catch (err) {
    if (err instanceof SourceNotFound) {
      res.status(404).json({ error: "unknown source" });
      return;
    }
    res.status(502).json({ error: "preview unavailable" });
  }
});

apiRouter.put("/sources/:source/filters", (req, res) => {
  const { source } = req.params;
  try {
    getSourceCapabilities(source);
  } catch (err) {
    if (err instanceof SourceNotFound) {
      res.status(404).json({ error: "unknown source" });
      return;
    }
    throw err;
  }
  const filters = (req.body as { filters?: unknown } | undefined)?.filters;
  if (!isValidFilters(filters)) {
    res.status(400).json({ error: "invalid filters" });
    return;
  }
  updateSourceFilters(source, filters);
  pollNow();
  res.status(200).json({ filters });
});
