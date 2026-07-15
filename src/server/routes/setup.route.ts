import { Router } from "express";
import {
  getOrchestrationConfig,
  updateLinearApiKey,
} from "../services/config-holder.js";
import {
  installArgv,
  probePreflight,
  runInstall,
} from "../services/preflight.js";
import {
  rebuildSources,
  testLinearConnection,
} from "../adapters/source-gateway.js";
import { startLinearPoller } from "../adapters/poller.js";

/**
 * First-run onboarding surface behind the shared `/api` loopback guard.
 *
 * @remarks GET `/setup` never returns the key itself — `needsKey` is derived from its presence — so a
 * first-run browser can read the status and live prerequisite checklist plus the informative
 * `node`/`storage` lines from the one shared preflight model (the same source `dispatch doctor`
 * renders) without leaking the secret. POST `/setup` is test-before-persist: a live `viewer { id }`
 * check runs BEFORE the key touches disk, so a rejected (400) or unreachable (502) key is never
 * written and can never land the user on a broken empty board. Persist + source rebuild + poller
 * start happen only on a verified key; a 409 short-circuits when a key already exists so a live key is
 * never overwritten and the poller is never double-started. The key is never logged or echoed back.
 * POST `/setup/install` drives the SAME shared `runInstall` non-interactively (request/response, never
 * streamed, never privilege-escalating): `target` is whitelist-validated against `installArgv` (tmux/ttyd/git only)
 * and mapped to a server-side constant argv — request input never reaches a shell — with a 400 for a
 * non-installable target and a generic 500 (no stack) on an unexpected throw; the 200 body carries the
 * freshly re-probed status so the setup screen can flip the row.
 */
export const setupRouter = Router();

setupRouter.get("/setup", async (_req, res) => {
  const needsKey = !getOrchestrationConfig()?.linearApiKey;
  const report = await probePreflight();
  res.status(200).json({
    needsKey,
    prerequisites: report.binaries,
    node: report.node,
    storage: report.storage,
  });
});

setupRouter.post("/setup/install", async (req, res) => {
  const target = (req.body as { target?: unknown } | undefined)?.target;
  if (typeof target !== "string" || installArgv(target) == null) {
    res.status(400).json({ error: "not-installable" });
    return;
  }
  try {
    const { ok, command, status } = await runInstall(target, {
      interactive: false,
    });
    res.status(200).json({ ok, command, status });
  } catch {
    res.status(500).json({ error: "install-failed" });
  }
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
