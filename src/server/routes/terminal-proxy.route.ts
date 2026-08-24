import { Router } from "express";
import type { Request, Response } from "express";
import {
  httpForward,
  resolveLiveTtydPort,
} from "../adapters/terminal-proxy.js";
import { sessionScrollback } from "../services/orchestration/terminal.js";
import { WEB_DIST_DIR } from "../services/infra/paths.js";

/**
 * Lines of tmux history one scrollback seed may carry, matching the web client's xterm
 * `scrollback` option: seeding more than the client buffer holds would only evict the seed's own
 * head.
 */
const SCROLLBACK_SEED_LINES = 10000;

/**
 * Serve the pane's tmux HISTORY (everything above the visible screen) as raw ANSI text.
 *
 * @remarks TERM-05: a freshly attaching web client receives only tmux's redraw of the visible
 * screen, so its local scrollback starts at the attach point. The terminal page fetches this
 * BEFORE opening its WebSocket and writes it into xterm, so touch scrolling reaches content from
 * before the attach. Registered ahead of the wildcard forward below, which would otherwise
 * swallow the path as a static-file lookup. 404 mirrors the proxy's unknown-card behavior; a
 * capture failure is 502 like any other upstream fault.
 */
function scrollbackHandler(req: Request<{ id: string }>, res: Response): void {
  sessionScrollback(req.params.id, SCROLLBACK_SEED_LINES).then(
    (history) => {
      if (history == null) {
        res.status(404).end();
        return;
      }
      res.set("Cache-Control", "no-cache");
      res.type("text/plain").send(history);
    },
    () => res.status(502).end(),
  );
}

/**
 * Card.id-keyed terminal reverse-proxy, mounted as a sibling top-level path (never nested under
 * `/api` — a byte-stream forward has no business behind the JSON-oriented `apiRouter` gate). No
 * auth gating of its own (nothing beyond loopback can reach it yet); this router is the single
 * named, wrappable route mount Phase 73's gate wraps (T-72-05). The named wildcard (`*rest`) is
 * required — a bare `*` throws at boot under `express@5.2.1`/path-to-regexp v8 (live-verified,
 * 72-RESEARCH.md) — and it MUST sit inside an optional group (`{/*rest}`): under path-to-regexp v8
 * a bare `/*rest` must consume at least one character, so the iframe's actual first request
 * (`/sessions/<id>/terminal/`, empty rest) and the no-trailing-slash form both miss the route and
 * fall through to the production SPA fallback, silently serving Dispatch's own index.html with a
 * 200 instead of ttyd's page. The no-trailing-slash form is forwarded verbatim rather than
 * redirected here, because ttyd under `-b` already answers it with its own 302 to the
 * trailing-slash index (live-verified against ttyd 1.7.7).
 * @remarks Every GET on this path serves dispatch's OWN built terminal bundle instead of proxying
 * to ttyd — the live-port resolution and 404-on-unknown-card behavior run FIRST and unchanged, so
 * the bundle is never served for a card with no live session (T-S1-02). `res.sendFile(relPath, {
 * root: WEB_DIST_DIR })` uses the `{ root }` form rather than a pre-joined absolute path so send's
 * dotfile/`..` traversal policy is confined to the relative segment (T-S1-01, the established
 * `spaFallback` pattern). Non-GET requests (the WS upgrade never reaches this router — it is a
 * Node-level `server.on("upgrade")` handler) continue to forward to ttyd via `httpForward`: this
 * keeps the route's non-GET behavior exactly what it is today, with no method-narrowing risk taken
 * as part of removing the flag, and it preserves the `.all` router's named-wildcard / optional
 * group (`{/*rest}` with an empty `rest`) guarantee this route's own JSDoc documents above.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export const terminalProxyRouter = Router();

terminalProxyRouter.get("/:id/terminal/scrollback", scrollbackHandler);

terminalProxyRouter.all("/:id/terminal{/*rest}", (req, res) => {
  const port = resolveLiveTtydPort(req.params.id);
  if (port == null) {
    res.status(404).end();
    return;
  }
  if (req.method === "GET") {
    const rest = req.params.rest as string | string[] | undefined;
    const relPath = Array.isArray(rest) ? rest.join("/") : (rest ?? "");
    res.set("Cache-Control", "no-cache");
    res.sendFile(relPath === "" ? "terminal.html" : relPath, {
      root: WEB_DIST_DIR,
    });
    return;
  }
  httpForward(req, res, port);
});
