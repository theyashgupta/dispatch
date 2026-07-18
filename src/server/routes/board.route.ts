import { Router } from "express";
import { DEFAULT_FILTERS, type SourceFilters } from "../../shared/types.js";
import { store } from "../store/board.store.js";
import {
  getOrchestrationConfig,
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

boardRouter.get("/board", (_req, res) => {
  res.status(200).json(store.snapshot());
});

boardRouter.get("/workspace-folders", (_req, res) => {
  const snap = store.snapshot();
  res.status(200).json({
    folders: snap.workspaceFolders ?? [],
    lastUsed: snap.lastUsed ?? null,
  });
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
