import { Router } from "express";
import { WEB_DIST_DIR } from "../services/infra/paths.js";

/**
 * Always-mounted express page router serving the built markdown viewer (`viewer.html` and its
 * hashed `./assets/` bundle) from the web dist directory, distinct from Phase 111's `viewer.route.ts`
 * which serves the raw `.md` file API under `/api`. This file serves the PAGE only.
 *
 * @remarks The named wildcard (`*rest`) is required, a bare `*` throws at boot under
 * `express@5.2.1`/path-to-regexp v8 (terminal-proxy.route.ts precedent), and it MUST sit inside an
 * optional group (`{/*rest}`) so the empty-rest case (`/viewer/`, the built page's own trailing-
 * slash request) matches rather than falling through. Mounted before the prod-only static block so
 * the page resolves identically in dev and prod. Auth is inherited purely from mount position
 * (after the global `remoteAuthRouter`); this router adds no auth code of its own.
 */
export const viewerPageRouter = Router();

viewerPageRouter.get("{/*rest}", (req, res) => {
  const rest = req.params.rest as string | string[] | undefined;
  const relPath = Array.isArray(rest) ? rest.join("/") : (rest ?? "");

  if (relPath === "" && !req.originalUrl.startsWith("/viewer/")) {
    const suffix = req.originalUrl.slice("/viewer".length);
    res.redirect(302, `/viewer/${suffix}`);
    return;
  }

  res.set("Cache-Control", "no-cache");
  res.sendFile(
    relPath === "" ? "viewer.html" : relPath,
    { root: WEB_DIST_DIR },
    (err) => {
      if (err && !res.headersSent) {
        res.status(404).type("text/plain").send("Not found");
      }
    },
  );
});
