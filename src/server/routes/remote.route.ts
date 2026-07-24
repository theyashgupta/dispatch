import { Router } from "express";
import { getHooksRuntime } from "../services/infra/config-holder.js";
import {
  disableTunnel,
  enableTunnel,
  getTunnelState,
} from "../services/orchestration/tunnel.js";

/**
 * The Settings "Remote" tab's enable/disable/status surface, mounted under `apiRouter` — already
 * covered by the hoisted `remoteAuthRouter` gate, so no route-level auth code is needed here.
 * Neither mutating route takes request-controlled input: `enable` resolves the local port from
 * the boot-pushed {@link getHooksRuntime} (never hardcoded), mirroring `update.route.ts`'s
 * server-resolved-args shape.
 */
export const remoteRouter = Router();

remoteRouter.post("/remote/enable", (_req, res) => {
  const port = getHooksRuntime()?.port;
  if (port == null) {
    res.status(503).json({ error: "server not ready" });
    return;
  }
  void enableTunnel(port);
  res.status(202).json(getTunnelState());
});

remoteRouter.post("/remote/disable", (_req, res) => {
  disableTunnel();
  res.status(200).json(getTunnelState());
});

remoteRouter.get("/remote", (_req, res) => {
  res.status(200).json(getTunnelState());
});
