import http from "node:http";
import net from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Request, Response } from "express";
import { store } from "../store/board.store.js";
import { getLiveTtydPort } from "./ttyd.js";

/**
 * Bound for a live-but-wedged upstream (TCP accepted, ttyd never actually responds): matches the
 * repo's other hand-rolled forward/fetch adapter (`image-proxy.ts`'s `TIMEOUT_MS`). For the WS leg
 * this only guards the handshake wait — it is cleared the instant the first upstream byte arrives
 * so a genuinely live, merely-idle interactive terminal is never killed for silence.
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Write a minimal status line before closing a rejected upgrade socket, so a failed handshake
 * surfaces a diagnosable `HTTP/1.1 <status>` on the wire instead of a bare connection reset.
 * Skips already-destroyed sockets since writing to one throws.
 */
function rejectUpgrade(socket: Duplex, status: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status}\r\n\r\n`);
}

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
 *
 * @remarks A bounded socket timeout guards a live-but-wedged ttyd (connects but never responds),
 * and the client-disconnect abort that keeps a navigated-away request from running until ttyd
 * itself closes it (WR-02) is wired to `res`'s `close`, never `req`'s: a server-side
 * `IncomingMessage` emits `close` the moment its stream is fully read, which for a bodyless GET is
 * immediately — so the `req`-keyed guard fired mid-forward and destroyed the upstream before it had
 * flushed a single byte, surfacing as a 100%-reproducible `ECONNRESET`/502 on every GET.
 * `writableFinished` distinguishes a genuine premature disconnect from normal completion.
 *
 * @remarks Only a request that actually carries a body is piped. Per RFC 9112 a request has a body
 * exactly when it frames one (`content-length` or `transfer-encoding`); reading `req` when there is
 * no body buys nothing and is what dragged the abort guard above into the hot path, so bodyless
 * methods end the upstream request outright instead.
 */
export function httpForward(req: Request, res: Response, port: number): void {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: req.originalUrl,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
      timeout: UPSTREAM_TIMEOUT_MS,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", () => {
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });
  res.on("close", () => {
    if (!res.writableFinished) upstream.destroy();
  });
  const framesBody =
    req.headers["content-length"] !== undefined ||
    req.headers["transfer-encoding"] !== undefined;
  if (framesBody) req.pipe(upstream);
  else upstream.end();
}

/**
 * Hand-rolled WS-upgrade forward — the zero-dependency way to proxy a WebSocket (no external
 * proxy dependency is in scope this phase). Writes `req.rawHeaders` verbatim (never the
 * lowercased/deduped `req.headers`) and the already-buffered `head` bytes before piping, in that
 * order: dropping either produces a handshake that reports success (101) while truncating the
 * first frame or mangling a header ttyd's libwebsockets is strict about (T-72-03).
 *
 * @remarks `UPSTREAM_TIMEOUT_MS` bounds only the wait for the FIRST byte back from ttyd (a
 * live-but-wedged process that accepts the TCP connection but never answers the handshake); it is
 * cleared on the first `data` event so an established, merely-idle interactive session is never
 * killed for silence. Client disconnect (`close`) is wired to abort the upstream leg immediately
 * rather than leaving it running until ttyd notices (WR-02).
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
  upstream.setTimeout(UPSTREAM_TIMEOUT_MS);
  upstream.once("timeout", () =>
    upstream.destroy(new Error("upstream handshake timeout")),
  );
  upstream.once("data", () => upstream.setTimeout(0));
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
  clientSocket.on("close", () => upstream.destroy());
}

/**
 * The single named upgrade call site `bootstrap/index.ts`'s `server.on("upgrade", ...)` delegates
 * to for every `/sessions/*` upgrade — kept as one wrappable chokepoint so Phase 73's auth gate
 * has exactly one place to wrap (T-72-05). Resolves `:id` from the URL itself (no Express router
 * for raw upgrades), decoding it the same way Express decodes `req.params.id` on the HTTP route
 * (IN-01) so the same card.id maps to the same target on both entry points, and rejects with a
 * minimal status line (IN-02) instead of a bare destroy when the id or its live port can't be
 * resolved, rather than falling back to any default target. The trailing separator is optional so
 * the set of URL shapes that yield an `:id` here stays identical to the set the HTTP route's
 * `/:id/terminal{/*rest}` matches — the two entry points must never disagree about which requests
 * carry a resolvable card id.
 */
export function terminalProxyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const match = req.url?.match(/^\/sessions\/([^/]+)\/terminal(?:\/|$)/);
  const id = decodeSegment(match?.[1]);
  const port = id != null ? resolveLiveTtydPort(id) : null;
  if (port == null) {
    rejectUpgrade(socket, "404 Not Found");
    return;
  }
  upgradeForward(req, socket, head, port);
}

/**
 * `decodeURIComponent` throws on a malformed percent-encoding; treat that the same as "no id"
 * (resolves to a 404) rather than crashing the raw-upgrade handler on untrusted input.
 */
function decodeSegment(raw: string | undefined): string | null {
  if (raw == null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export { resolveLiveTtydPort, rejectUpgrade };
