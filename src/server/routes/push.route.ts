import { Router, type Request } from "express";
import { isLocalRequest } from "./loopback.js";
import { getKnownPublicHost } from "../services/orchestration/tunnel.js";
import { loadOrCreateVapidKeys } from "../services/infra/push-keys.js";
import { store } from "../store/board.store.js";

const MAX_ENDPOINT_LEN = 2048;
const MAX_KEY_LEN = 512;

/**
 * Push subscription routes, mounted behind the single app-level gate hoisted in
 * `bootstrap/index.ts` (never a standalone router). Exposes the VAPID public key and lets a
 * client subscribe/unsubscribe an endpoint-keyed row in the existing `board.db` store. No route
 * here ever reads the client-suppliable Origin request header for the stored `origin` column:
 * `cloudflared`'s `--http-host-header` sentinel rewrites `Host` for tunnel traffic, so
 * {@link deriveOrigin} is the only trustworthy source, mirroring `remote-auth-gate.ts`'s
 * `originMatchesHost` branch structure. Every handler answers a fixed generic error code on an
 * unexpected throw, no stack, path or filesystem-error text on the wire; the error message is
 * logged to stderr only.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export const pushRouter = Router();

/**
 * Derive the trustworthy server-side origin for a request: the loopback `Host` header when local,
 * or the tunnel manager's known public host otherwise. Never reads the client-suppliable Origin
 * request header.
 * @remarks Fails closed on any value that is not a bare host[:port]: the stored origin later
 * becomes a `clients.openWindow` deep-link target, so a poisoned `Host` header must never
 * round-trip into a URL.
 */
function deriveOrigin(req: Request): string | null {
  const host = isLocalRequest(req)
    ? (req.headers.host ?? null)
    : getKnownPublicHost();
  if (host == null || !/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i.test(host)) {
    return null;
  }
  return host;
}

/** Validate a push endpoint: an `https://` URL string, 1 to 2048 characters. */
function validateEndpoint(
  raw: unknown,
): { ok: true; endpoint: string } | { ok: false; error: "invalid-endpoint" } {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_ENDPOINT_LEN ||
    !raw.startsWith("https://")
  ) {
    return { ok: false, error: "invalid-endpoint" };
  }
  try {
    new URL(raw);
  } catch {
    return { ok: false, error: "invalid-endpoint" };
  }
  return { ok: true, endpoint: raw };
}

/** Validate a subscription's keys: non-empty `p256dh` and `auth` strings, each at most 512 chars. */
function validateKeys(
  raw: unknown,
):
  | { ok: true; p256dh: string; auth: string }
  | { ok: false; error: "invalid-keys" } {
  const keys = raw as { p256dh?: unknown; auth?: unknown } | undefined;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (
    typeof p256dh !== "string" ||
    p256dh.length === 0 ||
    p256dh.length > MAX_KEY_LEN ||
    typeof auth !== "string" ||
    auth.length === 0 ||
    auth.length > MAX_KEY_LEN
  ) {
    return { ok: false, error: "invalid-keys" };
  }
  return { ok: true, p256dh, auth };
}

pushRouter.get("/push/public-key", (_req, res) => {
  try {
    res
      .status(200)
      .json({ publicKey: loadOrCreateVapidKeys().publicKeyBase64Url });
  } catch (err) {
    console.error("[push] public-key read failed:", (err as Error).message);
    res.status(500).json({ error: "push-key-read-failed" });
  }
});

pushRouter.post("/push/subscribe", (req, res) => {
  const body = req.body as { endpoint?: unknown; keys?: unknown } | undefined;

  const endpointResult = validateEndpoint(body?.endpoint);
  if (!endpointResult.ok) {
    res.status(400).json({ error: endpointResult.error });
    return;
  }
  const { endpoint } = endpointResult;

  const keysResult = validateKeys(body?.keys);
  if (!keysResult.ok) {
    res.status(400).json({ error: keysResult.error });
    return;
  }
  const { p256dh, auth } = keysResult;

  const origin = deriveOrigin(req);
  if (!origin) {
    res.status(400).json({ error: "unknown-origin" });
    return;
  }

  try {
    const stored = store.addPushSubscription({
      endpoint,
      p256dh,
      auth,
      origin,
      createdAt: new Date().toISOString(),
    });
    if (!stored) {
      res.status(400).json({ error: "too-many-subscriptions" });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[push] subscribe failed:", (err as Error).message);
    res.status(500).json({ error: "push-subscribe-failed" });
  }
});

pushRouter.post("/push/unsubscribe", (req, res) => {
  const body = req.body as { endpoint?: unknown } | undefined;
  const endpointResult = validateEndpoint(body?.endpoint);
  if (!endpointResult.ok) {
    res.status(400).json({ error: endpointResult.error });
    return;
  }

  try {
    const removed = store.removePushSubscription(endpointResult.endpoint);
    res.status(200).json({ ok: true, removed });
  } catch (err) {
    console.error("[push] unsubscribe failed:", (err as Error).message);
    res.status(500).json({ error: "push-unsubscribe-failed" });
  }
});
