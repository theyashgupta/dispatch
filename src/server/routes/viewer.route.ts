import { Router } from "express";
import fsp from "node:fs/promises";
import path from "node:path";
import { getOrchestrationConfig } from "../services/infra/config-holder.js";
import { store } from "../store/board.store.js";

const MD_EXT = /\.(md|markdown)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Realpath-containment-gated `.md` file reader behind the shared `/api` guard.
 *
 * @remarks The allowed roots (`workspaceRoot` plus every live session's workspace path) are
 * derived fresh per request, never cached, and both the requested path and each root are
 * realpath'd before comparison so a symlink or `../` segment cannot escape the boundary, this
 * route is the trust boundary Phase 112's client-side link handler will rely on. Every
 * filesystem-derived rejection returns a uniform 404, so a response status can never be used as
 * an existence oracle for paths outside the boundary. The live session objects read here for the
 * extra roots must never be mutated.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export const viewerRouter = Router();

viewerRouter.get("/viewer/file", async (req, res) => {
  const p = req.query.path;
  if (typeof p !== "string" || !MD_EXT.test(p)) {
    res.status(400).json({ error: "invalid-path" });
    return;
  }

  let resolved: string;
  try {
    resolved = await fsp.realpath(p);
  } catch {
    res.status(404).json({ error: "not-found" });
    return;
  }

  const roots = new Set<string>();
  const ws = getOrchestrationConfig()?.workspaceRoot;
  if (ws) roots.add(ws);
  for (const { session } of store.sessionsWithTmux()) {
    if (session.workspacePath) roots.add(session.workspacePath);
  }

  let contained = false;
  for (const root of roots) {
    let rootReal: string;
    try {
      rootReal = await fsp.realpath(root);
    } catch {
      continue;
    }
    if (resolved === rootReal || resolved.startsWith(rootReal + path.sep)) {
      contained = true;
      break;
    }
  }
  if (!contained) {
    res.status(404).json({ error: "not-found" });
    return;
  }

  if (!MD_EXT.test(resolved)) {
    res.status(404).json({ error: "not-found" });
    return;
  }

  const st = await fsp.stat(resolved);
  if (!st.isFile()) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (st.size > MAX_BYTES) {
    res.status(413).json({ error: "too-large" });
    return;
  }

  const body = await fsp.readFile(resolved, "utf8");
  res
    .status(200)
    .set("Cache-Control", "no-store")
    .type("text/markdown; charset=utf-8")
    .send(body);
});
