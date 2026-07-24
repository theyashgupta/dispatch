import type { IncomingMessage } from "node:http";

/** A hostname is local iff it is loopback (defends against DNS-rebinding to an external name). */
function hostnameIsLocal(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * A request is accepted only when both the Origin (if the browser sent one) and the
 * Host header resolve to loopback. curl / same-origin tools that omit Origin are allowed;
 * a cross-origin browser request (foreign Origin) or a rebinding Host is rejected.
 *
 * @remarks Typed at `IncomingMessage` (not Express's `Request`) so the same function composes,
 * byte-for-byte, into both the Express app pipeline and the raw `http.Server` upgrade handler —
 * Express's `Request` is structurally assignable to `IncomingMessage`, so no call site changes.
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!hostnameIsLocal(new URL(origin).hostname)) return false;
    } catch {
      return false;
    }
  }
  const host = req.headers.host;
  if (host) {
    const hostname = host.replace(/:\d+$/, "");
    if (!hostnameIsLocal(hostname)) return false;
  }
  return true;
}
