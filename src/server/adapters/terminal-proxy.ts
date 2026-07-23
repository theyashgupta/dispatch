import http from "node:http";
import net from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Request, Response } from "express";
import { store } from "../store/board.store.js";
import { getLiveTtydPort } from "./ttyd.js";

/**
 * Resolve a card.id to its currently-live loopback ttyd port, or `null` when the card is
 * unknown, has no session, or its ttyd is not currently tracked as alive. Both `httpForward`
 * and `terminalProxyUpgrade` call this fresh on every request/upgrade (PROXY-03) — never cached
 * here — so a mid-session ttyd respawn or boot re-adoption keeps reconnecting. `id` is used ONLY
 * as an exact-match equality key against the store's known card ids, never interpolated into a
 * shell command, file path, or regex (T-72-01).
 */
function resolveLiveTtydPort(id: string): number | null {
  const card = store.snapshot().cards.find((c) => c.id === id);
  if (!card?.tmuxSession) return null;
  return getLiveTtydPort(card.tmuxSession);
}

/**
 * Forward one HTTP request to the session's live loopback ttyd port, verbatim — no path rewrite,
 * since ttyd was spawned with `-b` matching this exact prefix (PROXY-01). Builtin `node:http`
 * only, matching this repo's zero-dep-for-plumbing convention (raw SSE, hand-written GraphQL,
 * `image-proxy.ts`'s own fetch+pipeline forward) rather than a proxy library.
 */
export function httpForward(req: Request, res: Response, port: number): void {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: req.originalUrl,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });
  req.pipe(upstream);
}

/**
 * Hand-rolled WS-upgrade forward — the zero-dependency way to proxy a WebSocket (no external
 * proxy dependency is in scope this phase). Writes `req.rawHeaders` verbatim (never the
 * lowercased/deduped `req.headers`) and the already-buffered `head` bytes before piping, in that
 * order: dropping either produces a handshake that reports success (101) while truncating the
 * first frame or mangling a header ttyd's libwebsockets is strict about (T-72-03).
 */
export function upgradeForward(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  port: number,
): void {
  const upstream = net.connect(port, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
}

/**
 * The single named upgrade call site `bootstrap/index.ts`'s `server.on("upgrade", ...)` delegates
 * to for every `/sessions/*` upgrade — kept as one wrappable chokepoint so Phase 73's auth gate
 * has exactly one place to wrap (T-72-05). Resolves `:id` from the URL itself (no Express router
 * for raw upgrades) and destroys the socket instead of forwarding when the id or its live port
 * can't be resolved, rather than falling back to any default target.
 */
export function terminalProxyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const match = req.url?.match(/^\/sessions\/([^/]+)\/terminal\//);
  const id = match?.[1];
  const port = id != null ? resolveLiveTtydPort(id) : null;
  if (port == null) {
    socket.destroy();
    return;
  }
  upgradeForward(req, socket, head, port);
}

export { resolveLiveTtydPort };
