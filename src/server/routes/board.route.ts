import { Router, type Request, type Response } from "express";
import {
  DEFAULT_CLAUDE_ARGS,
  DEFAULT_CLEANUP_DELAY_DAYS,
  DEFAULT_FILTERS,
} from "../../shared/types.js";
import { DONE_PAGE_SIZE } from "../../shared/done-limit.js";
import { DEFAULT_TERMINAL_APPEARANCE } from "../../shared/terminal-appearance.js";
import { SEARCH_RESULT_LIMIT } from "../../shared/search.js";
import { boardRepository as store } from "../store/board-repository.js";
import {
  ConflictError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "../services/domain/errors.js";
import {
  getOrchestrationConfig,
  updateClaudeArgs,
  updateCleanupDelayDays,
  updateArchiveRetentionDays,
  updateTerminalAppearance,
  updateSourceFilters,
} from "../services/infra/config-holder.js";
import {
  getSourceCapabilities,
  listSourceOptions,
  countSourceMatches,
  SourceNotFound,
  sourceState,
} from "../adapters/source-gateway.js";
import { pollNow } from "../adapters/poller.js";
import {
  expandPath,
  validateFolder,
  discoverRepos,
  browseDirectory,
} from "../services/orchestration/workspaces.js";
import {
  archiveRetentionBodySchema,
  boardQuerySchema,
  claudeArgsBodySchema,
  cleanupDelayBodySchema,
  dirsQuerySchema,
  filtersBodySchema,
  optionsQuerySchema,
  searchQuerySchema,
  terminalBodySchema,
  workspacePathSchema,
} from "./board-schemas.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

export const boardRouter = Router();

/**
 * `GET /api/board` carries the windowed Done page (`BOARD-08`): an absent `doneLimit` defaults to
 * {@link DONE_PAGE_SIZE}, an invalid one 400s rather than clamping silently (`T-82-01`) — unlike
 * `GET /api/stream`, a REST request has no persistent connection to keep alive, so refusing it
 * outright is safe here in a way it is not for SSE.
 */
function getBoard(req: Request, res: Response): void {
  const { doneLimit = DONE_PAGE_SIZE } = parseOrThrow(
    boardQuerySchema,
    req.query,
  );
  res.status(200).json(store.snapshot(DEFAULT_BOARD_KEY, { doneLimit }));
}

boardRouter.get("/board", getBoard);

/**
 * `GET /api/search?q=` answers SCALE-03: the board's windowed wire snapshot deliberately hides
 * cards outside the loaded Done page, so this route scans the FULL live store instead of the
 * client's partial view. `q` is trimmed and length-bounded to `[SEARCH_QUERY_MIN, SEARCH_QUERY_MAX]`
 * BEFORE any scan (`T-82-02`) — a Denial-of-Service control on scan/response cost, NEVER an
 * injection control: the query only ever reaches a plain `String.includes` argument, never SQL, a
 * shell, or a template. No `await`, no try/catch — `store.searchCards` is a synchronous in-memory
 * scan, not a network call.
 */
function getSearch(req: Request, res: Response): void {
  const { q } = parseOrThrow(searchQuerySchema, req.query);
  res
    .status(200)
    .json(store.searchCards(DEFAULT_BOARD_KEY, q, SEARCH_RESULT_LIMIT));
}

boardRouter.get("/search", getSearch);

boardRouter.get("/workspace-folders", (_req, res) => {
  const { folders, lastUsed } = store.getWorkspaceFolders(DEFAULT_BOARD_KEY);
  res.status(200).json({ folders, lastUsed });
});

boardRouter.post("/workspace-folders", async (req, res) => {
  const { path: rawPath } = parseOrThrow(workspacePathSchema, req.body);

  const abs = expandPath(rawPath);
  const status = await validateFolder(abs);
  if (status === "missing") throw new ValidationError("Folder doesn't exist");
  if (status === "not-a-folder") throw new ValidationError("Not a folder");

  const repos = await discoverRepos(abs);
  if (repos.length === 0) {
    throw new ValidationError("No git repositories found in this folder");
  }

  await store.addWorkspaceFolder(DEFAULT_BOARD_KEY, abs);
  res.status(200).json({ repos });
});

boardRouter.get("/workspace-folders/discover", async (req, res) => {
  const { path: rawPath } = parseOrThrow(workspacePathSchema, req.query);

  const repos = await discoverRepos(expandPath(rawPath));
  res.status(200).json({ repos });
});

boardRouter.get("/fs/dirs", async (req, res) => {
  const { path: rawPath } = parseOrThrow(dirsQuerySchema, req.query);
  const result = await browseDirectory(rawPath);
  if (!result.ok) throw new ValidationError("Outside allowed directory");
  res.status(200).json(result.listing);
});

boardRouter.delete("/workspace-folders", async (req, res) => {
  const { path: rawPath } = parseOrThrow(workspacePathSchema, req.body);

  await store.removeWorkspaceFolder(DEFAULT_BOARD_KEY, expandPath(rawPath));
  res.status(200).json({ ok: true });
});

/** Throw the 404 `unknown source` when `err` is the gateway's `SourceNotFound`. */
function throwIfUnknownSource(err: unknown): void {
  if (err instanceof SourceNotFound) throw new NotFoundError("unknown source");
}

boardRouter.get("/sources/:source/filters", (req, res) => {
  const { source } = req.params;
  try {
    const capabilities = getSourceCapabilities(source);
    const filters =
      getOrchestrationConfig()?.sources?.linear?.filters ?? DEFAULT_FILTERS;
    res.status(200).json({ filters, capabilities });
  } catch (err) {
    throwIfUnknownSource(err);
    throw err;
  }
});

boardRouter.get("/sources/:source/options", async (req, res) => {
  const { source } = req.params;
  const { dimension } = parseOrThrow(optionsQuerySchema, req.query);
  try {
    const { options, truncated } = await listSourceOptions(source, dimension);
    res.status(200).json({ options, truncated });
  } catch (err) {
    throwIfUnknownSource(err);
    throw new UpstreamError("source options unavailable");
  }
});

boardRouter.post("/sources/:source/preview", async (req, res) => {
  const { source } = req.params;
  const { filters } = parseOrThrow(filtersBodySchema, req.body);
  try {
    const { count, more } = await countSourceMatches(source, filters);
    res.status(200).json({ count, more });
  } catch (err) {
    throwIfUnknownSource(err);
    throw new UpstreamError("preview unavailable");
  }
});

boardRouter.post("/sources/:source/poll", (req, res) => {
  const { source } = req.params;
  const state = sourceState(source);
  if (state === "unknown") throw new NotFoundError("unknown source");
  if (state === "disabled") throw new ConflictError("source disabled");
  if (!pollNow(source)) throw new ConflictError("source not polling");
  res.status(202).json({ polling: source });
});

boardRouter.put("/sources/:source/filters", (req, res) => {
  const { source } = req.params;
  try {
    getSourceCapabilities(source);
  } catch (err) {
    throwIfUnknownSource(err);
    throw err;
  }
  const { filters } = parseOrThrow(filtersBodySchema, req.body);
  updateSourceFilters(source, filters);
  pollNow(source);
  res.status(200).json({ filters });
});

boardRouter.get("/config/cleanup-delay", (_req, res) => {
  res.status(200).json({
    cleanupDelayDays:
      getOrchestrationConfig()?.cleanupDelayDays ?? DEFAULT_CLEANUP_DELAY_DAYS,
  });
});

boardRouter.put("/config/cleanup-delay", (req, res) => {
  const { cleanupDelayDays: days } = parseOrThrow(
    cleanupDelayBodySchema,
    req.body,
  );
  updateCleanupDelayDays(days);
  store.setCleanupDelayDays(days);
  res.status(200).json({ cleanupDelayDays: days });
});

boardRouter.get("/config/archive-retention", (_req, res) => {
  res.status(200).json({
    archiveRetentionDays: store.getArchiveRetentionDays(),
  });
});

boardRouter.put("/config/archive-retention", (req, res) => {
  const { archiveRetentionDays: days } = parseOrThrow(
    archiveRetentionBodySchema,
    req.body,
  );
  updateArchiveRetentionDays(days);
  store.setArchiveRetentionDays(days);
  res.status(200).json({ archiveRetentionDays: days });
});

boardRouter.get("/config/terminal", (_req, res) => {
  res
    .status(200)
    .json(getOrchestrationConfig()?.terminal ?? DEFAULT_TERMINAL_APPEARANCE);
});

boardRouter.put("/config/terminal", (req, res) => {
  const appearance = parseOrThrow(terminalBodySchema, req.body);
  updateTerminalAppearance(appearance);
  res.status(200).json(appearance);
});

boardRouter.get("/config/claude-args", (_req, res) => {
  res.status(200).json({
    claudeArgs: getOrchestrationConfig()?.claudeArgs ?? DEFAULT_CLAUDE_ARGS,
  });
});

boardRouter.put("/config/claude-args", (req, res) => {
  const { claudeArgs: args } = parseOrThrow(claudeArgsBodySchema, req.body);
  updateClaudeArgs(args);
  res.status(200).json({ claudeArgs: args });
});

boardRouter.use(httpErrorHandler);
