import { Router } from "express";
import {
  getOrchestrationConfig,
  updateLinearApiKey,
} from "../services/config-holder.js";
import { probePrerequisites } from "../services/prerequisites.js";
import {
  rebuildSources,
  testLinearConnection,
} from "../adapters/source-gateway.js";
import { startLinearPoller } from "../adapters/poller.js";

/**
 * First-run onboarding surface behind the shared `/api` loopback guard.
 *
 * @remarks GET `/setup` never returns the key itself — `needsKey` is derived from its presence — so a
 * first-run browser can read the status and live prerequisite checklist without leaking the secret.
 * POST `/setup` is test-before-persist: a live `viewer { id }` check runs BEFORE the key touches
 * disk, so a rejected (400) or unreachable (502) key is never written and can never land the user on
 * a broken empty board. Persist + source rebuild + poller start happen only on a verified key; a 409
 * short-circuits when a key already exists so a live key is never overwritten and the poller is never
 * double-started. The key is never logged or echoed back.
 */
export const setupRouter = Router();

setupRouter.get("/setup", async (_req, res) => {
  const needsKey = !getOrchestrationConfig()?.linearApiKey;
  res.status(200).json({ needsKey, prerequisites: await probePrerequisites() });
});

setupRouter.post("/setup", async (req, res) => {
  if (getOrchestrationConfig()?.linearApiKey) {
    res.status(409).json({ error: "already-configured" });
    return;
  }
  const apiKey = (req.body as { apiKey?: unknown } | undefined)?.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }
  let ok: boolean;
  try {
    ok = await testLinearConnection(apiKey.trim());
  } catch {
    res.status(502).json({ error: "unreachable" });
    return;
  }
  if (!ok) {
    res.status(400).json({ error: "rejected" });
    return;
  }
  updateLinearApiKey(apiKey.trim());
  rebuildSources(getOrchestrationConfig()!);
  startLinearPoller(getOrchestrationConfig()!);
  res.status(200).json({ ok: true });
});
