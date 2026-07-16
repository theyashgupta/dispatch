import { Router } from "express";
import {
  checkForUpdate,
  detectInstallMode,
  runUpdate,
} from "../services/update.js";

/**
 * Update-flow surface behind the shared `/api` loopback guard.
 *
 * @remarks GET `/update` reads the cache-backed `checkForUpdate({ liveCheck: false })` snapshot —
 * the web reads the 24h-cached status, not a fresh network hit per page load. POST `/update/run`
 * takes zero request-controlled arguments: install mode and the target package are 100%
 * server-resolved, mirroring `setup.route.ts`'s `installArgv` whitelist-to-constant-argv pattern.
 * It 400s unless the server-detected mode is global (defense in depth — the web button only
 * renders client-side in global mode, this route must not trust that) and 500s generically
 * (no stack) on an unexpected throw.
 */
export const updateRouter = Router();

updateRouter.get("/update", async (_req, res) => {
  const status = await checkForUpdate({ liveCheck: false });
  res.status(200).json(status);
});

updateRouter.post("/update/run", async (_req, res) => {
  if (detectInstallMode() !== "global") {
    res.status(400).json({ error: "not-global-install" });
    return;
  }
  try {
    const result = await runUpdate({ interactive: false });
    res.status(200).json(result);
  } catch {
    res.status(500).json({ error: "update-failed" });
  }
});
