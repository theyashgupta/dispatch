import { Router } from "express";
import {
  httpForward,
  resolveLiveTtydPort,
} from "../adapters/terminal-proxy.js";

/**
 * Card.id-keyed terminal reverse-proxy, mounted as a sibling top-level path (never nested under
 * `/api` — a byte-stream forward has no business behind the JSON-oriented `apiRouter` gate). No
 * auth gating this phase (nothing beyond loopback can reach it yet); this router is the single
 * named, wrappable route mount Phase 73's gate wraps (T-72-05). The named wildcard (`*rest`) is
 * required — a bare `*` throws at boot under `express@5.2.1`/path-to-regexp v8 (live-verified,
 * 72-RESEARCH.md) — and it MUST sit inside an optional group (`{/*rest}`): under path-to-regexp v8
 * a bare `/*rest` must consume at least one character, so the iframe's actual first request
 * (`/sessions/<id>/terminal/`, empty rest) and the no-trailing-slash form both miss the route and
 * fall through to the production SPA fallback, silently serving Dispatch's own index.html with a
 * 200 instead of ttyd's page. The no-trailing-slash form is forwarded verbatim rather than
 * redirected here, because ttyd under `-b` already answers it with its own 302 to the
 * trailing-slash index (live-verified against ttyd 1.7.7).
 */
export const terminalProxyRouter = Router();

terminalProxyRouter.all("/:id/terminal{/*rest}", (req, res) => {
  const port = resolveLiveTtydPort(req.params.id);
  if (port == null) {
    res.status(404).end();
    return;
  }
  httpForward(req, res, port);
});
