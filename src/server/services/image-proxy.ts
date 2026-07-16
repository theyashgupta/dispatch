import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Response as ExpressResponse } from "express";
import type { ReadableStream } from "node:stream/web";
import { getOrchestrationConfig } from "./config-holder.js";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 20 * 1024 * 1024;

/** The single typed error for every reject/degrade case; the route maps every instance to 502. */
export class ImageProxyError extends Error {}

/**
 * A backstop against a misreported or absent upstream `Content-Length`: counts real streamed
 * bytes and destroys the pipeline the instant the running total exceeds `maxBytes`, regardless
 * of what any header claimed. Also re-arms an inactivity timer on every chunk so a stalled
 * upstream body (no bytes for `idleMs`) is destroyed instead of pinning the connection
 * indefinitely — the `AbortController` in `fetchLinearImage` cannot cover this window because
 * its signal is only awaited up to header arrival.
 */
function sizeCap(maxBytes: number, idleMs: number): Transform {
  let total = 0;
  let idleTimer: NodeJS.Timeout;
  const cap: Transform = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        cap.destroy(new ImageProxyError("upstream stream stalled"));
      }, idleMs);
      total += chunk.length;
      if (total > maxBytes) {
        callback(new ImageProxyError("upstream exceeds size cap"));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      clearTimeout(idleTimer);
      callback();
    },
  });
  idleTimer = setTimeout(() => {
    cap.destroy(new ImageProxyError("upstream stream stalled"));
  }, idleMs);
  cap.once("close", () => clearTimeout(idleTimer));
  return cap;
}

/**
 * Fetch a Linear-hosted upload asset with the server-held API key attached and stream it onto
 * `res` with the upstream content type and a private, 1h cache directive.
 *
 * @remarks Auth is the raw-key form used by `postGraphQL` (`Authorization: <key>`, with no scheme
 * prefix) — the key never appears in any thrown message or response byte. The `AbortController`
 * timeout is cleared as soon as the initial `fetch` resolves, so it bounds header-arrival only;
 * `sizeCap` re-arms its own `idleMs` timer on every chunk and destroys the pipeline on stall, so
 * the streaming body carries the same 10s inactivity bound even though the fetch signal can no
 * longer be awaited once `pipeline` has started.
 */
export async function fetchLinearImage(
  url: string,
  res: ExpressResponse,
): Promise<void> {
  const apiKey = getOrchestrationConfig()?.linearApiKey;
  if (!apiKey) throw new ImageProxyError("no linear api key configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const normalizedType = contentType.toLowerCase();
  if (
    !upstream.ok ||
    !normalizedType.startsWith("image/") ||
    normalizedType.startsWith("image/svg")
  ) {
    throw new ImageProxyError(
      `upstream rejected (${upstream.status}, ${contentType})`,
    );
  }

  const contentLength = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    throw new ImageProxyError("upstream content-length exceeds cap");
  }

  if (!upstream.body) throw new ImageProxyError("upstream returned no body");

  res.status(200).set({
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  });
  await pipeline(
    Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>),
    sizeCap(MAX_BYTES, TIMEOUT_MS),
    res,
  );
}
