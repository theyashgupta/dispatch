import { Router, type Response } from "express";
import {
  clearLinearApiKey,
  getOrchestrationConfig,
  updateLinearApiKey,
} from "../services/infra/config-holder.js";
import { checkSourceKey, rebuildSources } from "../adapters/source-gateway.js";
import { startEnabledPollers } from "../adapters/poller.js";
import type { SourceConnection } from "../../shared/types.js";

/**
 * Source connection surface: status with the account behind the stored key, replace key, disconnect.
 *
 * @remarks Replace is test-before-persist like first-run setup, so a rejected or unreachable key
 * never reaches disk, and a disconnect that lands while a replace is still checking its key wins.
 * Only Linear stores a key today, so every other source id answers 404. The key is never echoed,
 * logged or placed in an error body.
 */
export const connectionRouter = Router();

const KEY_SHAPE = /^[\x21-\x7e]+$/;

let keyGeneration = 0;

/** Answers 404 and returns true for any source other than Linear, the only one with a stored key. */
function refuseUnknown(source: string, res: Response): boolean {
  if (source === "linear") return false;
  res.status(404).json({ error: "unknown source" });
  return true;
}

function reloadSources(): void {
  const config = getOrchestrationConfig();
  if (config) rebuildSources(config);
  startEnabledPollers();
}

connectionRouter.get("/sources/:source/connection", async (req, res) => {
  const { source } = req.params;
  if (refuseUnknown(source, res)) return;
  const key = getOrchestrationConfig()?.linearApiKey ?? "";
  let body: SourceConnection = { configured: false, connected: false };
  if (key !== "") {
    try {
      const viewer = await checkSourceKey(source, key);
      body = viewer
        ? { configured: true, connected: true, ...viewer }
        : { configured: true, connected: false, error: "rejected" };
    } catch {
      body = { configured: true, connected: false, error: "unreachable" };
    }
  }
  res.status(200).json(body);
});

connectionRouter.put("/sources/:source/key", async (req, res) => {
  const { source } = req.params;
  if (refuseUnknown(source, res)) return;
  const apiKey = (req.body as { apiKey?: unknown } | undefined)?.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }
  const key = apiKey.trim();
  if (!KEY_SHAPE.test(key)) {
    res.status(400).json({ error: "rejected" });
    return;
  }
  const generation = keyGeneration;
  let viewer: { account?: string } | null;
  try {
    viewer = await checkSourceKey(source, key);
  } catch {
    res.status(502).json({ error: "unreachable" });
    return;
  }
  if (!viewer) {
    res.status(400).json({ error: "rejected" });
    return;
  }
  if (generation !== keyGeneration) {
    res.status(409).json({ error: "superseded" });
    return;
  }
  try {
    updateLinearApiKey(key);
  } catch {
    res.status(500).json({ error: "save-failed" });
    return;
  }
  reloadSources();
  res.status(200).json(viewer);
});

connectionRouter.delete("/sources/:source/key", (req, res) => {
  const { source } = req.params;
  if (refuseUnknown(source, res)) return;
  try {
    clearLinearApiKey();
  } catch {
    res.status(500).json({ error: "save-failed" });
    return;
  }
  keyGeneration += 1;
  reloadSources();
  res.status(204).end();
});
