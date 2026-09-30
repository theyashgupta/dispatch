import { Router, type Request } from "express";
import { httpErrorHandler } from "./error-handler.js";
import { isLocalRequest } from "./loopback.js";
import { parseOrThrow } from "./parse-input.js";
import { subscribeSchema, unsubscribeSchema } from "./push-schemas.js";
import { getKnownPublicHost } from "../services/orchestration/tunnel.js";
import { loadOrCreateVapidKeys } from "../services/infra/push-keys.js";
import { store } from "../store/board.store.js";
import { InternalError, ValidationError } from "../services/domain/errors.js";

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
  if (
    host == null ||
    !/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i.test(host)
  ) {
    return null;
  }
  return host;
}

pushRouter.get("/push/public-key", (_req, res) => {
  try {
    res
      .status(200)
      .json({ publicKey: loadOrCreateVapidKeys().publicKeyBase64Url });
  } catch (err) {
    console.error("[push] public-key read failed:", (err as Error).message);
    throw new InternalError("push-key-read-failed");
  }
});

pushRouter.post("/push/subscribe", (req, res) => {
  const {
    endpoint,
    keys: { p256dh, auth },
  } = parseOrThrow(subscribeSchema, req.body);

  const origin = deriveOrigin(req);
  if (!origin) throw new ValidationError("unknown-origin");

  let stored: boolean;
  try {
    stored = store.addPushSubscription({
      endpoint,
      p256dh,
      auth,
      origin,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[push] subscribe failed:", (err as Error).message);
    throw new InternalError("push-subscribe-failed");
  }
  if (!stored) throw new ValidationError("too-many-subscriptions");
  res.status(200).json({ ok: true });
});

pushRouter.post("/push/unsubscribe", (req, res) => {
  const { endpoint } = parseOrThrow(unsubscribeSchema, req.body);
  try {
    const removed = store.removePushSubscription(endpoint);
    res.status(200).json({ ok: true, removed });
  } catch (err) {
    console.error("[push] unsubscribe failed:", (err as Error).message);
    throw new InternalError("push-unsubscribe-failed");
  }
});

pushRouter.use(httpErrorHandler);
