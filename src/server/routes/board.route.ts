import { Router, type Request, type Response } from "express";
import {
  DEFAULT_CLAUDE_ARGS,
  DEFAULT_CLEANUP_DELAY_DAYS,
  DEFAULT_FILTERS,
  type SourceFilters,
} from "../../shared/types.js";
import { DONE_PAGE_SIZE, parseDoneLimit } from "../../shared/done-limit.js";
import {
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  SEARCH_RESULT_LIMIT,
} from "../../shared/search.js";
import { store } from "../store/board.store.js";
import {
  getOrchestrationConfig,
  updateClaudeArgs,
  updateCleanupDelayDays,
  updateSourceFilters,
} from "../services/infra/config-holder.js";
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
  browseDirectory,
} from "../services/domain/workspaces.js";

export const boardRouter = Router();

/**
 * `GET /api/board` carries the windowed Done page (`BOARD-08`): an absent `doneLimit` defaults to
 * {@link DONE_PAGE_SIZE}, an invalid one 400s rather than clamping silently (`T-82-01`) — unlike
 * `GET /api/stream`, a REST request has no persistent connection to keep alive, so refusing it
 * outright is safe here in a way it is not for SSE.
 */
function getBoard(req: Request, res: Response): void {
  const raw = req.query.doneLimit;
  const doneLimit = raw === undefined ? DONE_PAGE_SIZE : parseDoneLimit(raw);
  if (doneLimit == null) {
    res.status(400).json({
      error: "doneLimit must be a whole number between 1 and 5000",
    });
    return;
  }
  res.status(200).json(store.snapshot({ doneLimit }));
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
  const raw = req.query.q;
  if (typeof raw !== "string") {
    res.status(400).json({ error: "q is required" });
    return;
  }
  const q = raw.trim();
  if (q.length < SEARCH_QUERY_MIN || q.length > SEARCH_QUERY_MAX) {
    res.status(400).json({
      error: `q must be between ${SEARCH_QUERY_MIN} and ${SEARCH_QUERY_MAX} characters`,
    });
    return;
  }
  res.status(200).json(store.searchCards(q, SEARCH_RESULT_LIMIT));
}

boardRouter.get("/search", getSearch);

boardRouter.get("/workspace-folders", (_req, res) => {
  const { folders, lastUsed } = store.getWorkspaceFolders();
  res.status(200).json({ folders, lastUsed });
});

boardRouter.post("/workspace-folders", async (req, res) => {
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

boardRouter.get("/workspace-folders/discover", async (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    res.status(400).json({ error: "path is required" });
    return;
  }

  const repos = await discoverRepos(expandPath(rawPath));
  res.status(200).json({ repos });
});

boardRouter.get("/fs/dirs", async (req, res) => {
  const rawPath = req.query.path;
  if (rawPath !== undefined && typeof rawPath !== "string") {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const result = await browseDirectory(rawPath);
  if (!result.ok) {
    res.status(400).json({ error: "Outside allowed directory" });
    return;
  }
  res.status(200).json(result.listing);
});

boardRouter.delete("/workspace-folders", async (req, res) => {
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
 * an upstream query. It rejects any non-array/non-boolean shape AND any key beyond the declared
 * `SourceFilters` fields, so an unknown dimension can never be persisted or forwarded to Linear
 * (tampering guard).
 */
function isValidFilters(x: unknown): x is SourceFilters {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const allowed = new Set([
    "assignees",
    "projects",
    "teams",
    "currentCycle",
    "includeActive",
  ]);
  if (Object.keys(o).some((k) => !allowed.has(k))) return false;
  const isStrArray = (v: unknown): boolean =>
    Array.isArray(v) && v.every((s) => typeof s === "string");
  return (
    isStrArray(o.assignees) &&
    isStrArray(o.projects) &&
    isStrArray(o.teams) &&
    typeof o.currentCycle === "boolean" &&
    typeof o.includeActive === "boolean"
  );
}

boardRouter.get("/sources/:source/filters", (req, res) => {
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

boardRouter.get("/sources/:source/options", async (req, res) => {
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

boardRouter.post("/sources/:source/preview", async (req, res) => {
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

boardRouter.put("/sources/:source/filters", (req, res) => {
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

/**
 * Validate an untrusted cleanup-delay write (`LIFE-04`) before it can reach the config file or the
 * live store: a whole number of days in `[0, 90]`. Deliberately a SIBLING of `isValidFilters`, not
 * an extension of it — that guard is scoped to the `SourceFilters` shape alone.
 */
function isValidCleanupDelayDays(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 90;
}

boardRouter.get("/config/cleanup-delay", (_req, res) => {
  res.status(200).json({
    cleanupDelayDays:
      getOrchestrationConfig()?.cleanupDelayDays ?? DEFAULT_CLEANUP_DELAY_DAYS,
  });
});

boardRouter.put("/config/cleanup-delay", (req, res) => {
  const days = (req.body as { cleanupDelayDays?: unknown } | undefined)
    ?.cleanupDelayDays;
  if (!isValidCleanupDelayDays(days)) {
    res.status(400).json({
      error: "cleanup delay must be a whole number of days between 0 and 90",
    });
    return;
  }
  updateCleanupDelayDays(days);
  store.setCleanupDelayDays(days);
  res.status(200).json({ cleanupDelayDays: days });
});

/** Same body-shape guard as {@link isValidCleanupDelayDays}, but for the free-text argv string (Settings ▸ Models). Bounded length only — any string tokenizes into a valid argv (`parseClaudeArgs`), including empty. */
const CLAUDE_ARGS_MAX = 4000;
function isValidClaudeArgs(x: unknown): x is string {
  return typeof x === "string" && x.length <= CLAUDE_ARGS_MAX;
}

boardRouter.get("/config/claude-args", (_req, res) => {
  res.status(200).json({
    claudeArgs: getOrchestrationConfig()?.claudeArgs ?? DEFAULT_CLAUDE_ARGS,
  });
});

boardRouter.put("/config/claude-args", (req, res) => {
  const args = (req.body as { claudeArgs?: unknown } | undefined)?.claudeArgs;
  if (!isValidClaudeArgs(args)) {
    res.status(400).json({
      error: `claude arguments must be a string of ${CLAUDE_ARGS_MAX} characters or fewer`,
    });
    return;
  }
  updateClaudeArgs(args);
  res.status(200).json({ claudeArgs: args });
});
