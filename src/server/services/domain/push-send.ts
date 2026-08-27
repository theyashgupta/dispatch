import {
  createCipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";
import type { Card } from "../../../shared/types.js";
import { loadOrCreateVapidKeys } from "../infra/push-keys.js";
import { store } from "../../store/board.store.js";
import type { PushSubscriptionRow } from "../../store/board-db.js";

/**
 * Signs RFC 8292 VAPID JWTs and encrypts RFC 8291 aes128gcm payloads to fan a needs-input
 * notification out to every stored push subscription.
 * @remarks Two invariants govern this module: (1) the VAPID private key and every piece of
 * per-message ephemeral key material (the ECDH shared secret, the derived PRK/CEK/nonce, the
 * auth secret, the p256dh value) are never logged, only a fixed prefix, an HTTP status and the
 * first 40 characters of an endpoint are; (2) one endpoint's failure is isolated inside its own
 * try/catch so it never aborts the rest of the fan-out.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
const PADDING_DELIMITER = Buffer.from([0x02]);
const RECORD_SIZE = 4096;
const VAPID_JWT_TTL_SECONDS = 12 * 3600;
const PUSH_TTL_SECONDS = 86400;
const SEND_TIMEOUT_MS = 10_000;
const NOTIFICATION_FALLBACK_BODY = "Waiting on your input";
const MAX_BODY_CHARS = 500;
const ENDPOINT_LOG_PREFIX_LEN = 40;
const VAPID_SUBJECT = "https://github.com/theyashgupta/dispatch";

/** 0x04 followed by a JWK's base64url `x`/`y`, the 65-byte uncompressed EC point form. */
function rawPoint(jwk: JsonWebKey): Buffer {
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x as string, "base64url"),
    Buffer.from(jwk.y as string, "base64url"),
  ]);
}

/** Split a 65-byte base64url-encoded raw EC point back into JWK `x`/`y` fields. */
function jwkFromRawPoint(p256dhBase64Url: string): { x: string; y: string } {
  const buf = Buffer.from(p256dhBase64Url, "base64url");
  return {
    x: buf.subarray(1, 33).toString("base64url"),
    y: buf.subarray(33, 65).toString("base64url"),
  };
}

/**
 * Sign a fresh ES256 VAPID JWT for one push endpoint.
 * @remarks `aud` is derived per endpoint with `new URL(endpoint).origin`; never cache or reuse a
 * token across endpoints, since different push services reject each other's audience.
 */
function signVapidJwt(endpoint: string, privateKeyJwk: JsonWebKey): string {
  const header = Buffer.from(
    JSON.stringify({ typ: "JWT", alg: "ES256" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + VAPID_JWT_TTL_SECONDS,
      sub: VAPID_SUBJECT,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${claims}`;
  const privateKey = createPrivateKey({ key: privateKeyJwk, format: "jwk" });
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  if (signature.length !== 64) {
    throw new Error("vapid signature has unexpected length");
  }
  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * Encrypt a plaintext payload per RFC 8291 for one subscriber.
 * @remarks Generates a FRESH ephemeral P-256 keypair per call, never reused or persisted, for
 * forward secrecy. Named distinctly from the VAPID keypair so the two can never be swapped: the
 * VAPID key identifies this server to the push service, the ephemeral key encrypts the payload
 * for the browser.
 */
function encryptPayload(sub: PushSubscriptionRow, plaintext: Buffer): Buffer {
  if (plaintext.length + PADDING_DELIMITER.length + 16 > RECORD_SIZE) {
    throw new Error("push payload exceeds the declared record size");
  }
  const { x, y } = jwkFromRawPoint(sub.p256dh);
  const uaPublicKey = createPublicKey({
    key: { kty: "EC", crv: "P-256", x, y },
    format: "jwk",
  });
  const auth = Buffer.from(sub.auth, "base64url");

  const ephemeralKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ephemeralJwk = ephemeralKeys.publicKey.export({ format: "jwk" });
  const ephemeralRawPoint = rawPoint(ephemeralJwk);
  const uaRawPoint = Buffer.from(sub.p256dh, "base64url");

  const ecdh = diffieHellman({
    privateKey: ephemeralKeys.privateKey,
    publicKey: uaPublicKey,
  });

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    uaRawPoint,
    ephemeralRawPoint,
  ]);
  const prk = Buffer.from(hkdfSync("sha256", ecdh, auth, keyInfo, 32));

  const recordSalt = randomBytes(16);
  const cekInfo = Buffer.from("Content-Encoding: aes128gcm\0");
  const nonceInfo = Buffer.from("Content-Encoding: nonce\0");
  const cek = Buffer.from(hkdfSync("sha256", prk, recordSalt, cekInfo, 16));
  const nonce = Buffer.from(hkdfSync("sha256", prk, recordSalt, nonceInfo, 12));

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, PADDING_DELIMITER])),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const header = Buffer.alloc(16 + 4 + 1 + 65);
  recordSalt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(65, 20);
  ephemeralRawPoint.copy(header, 21);

  return Buffer.concat([header, ciphertext, tag]);
}

/** `http` for a loopback host, `https` otherwise. */
function schemeFor(host: string): "http" | "https" {
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)
    ? "http"
    : "https";
}

/**
 * Build the deep-link URL a notification's click handler opens.
 * @remarks Uses the SUBSCRIPTION ROW's own stored origin, not the live tunnel host: a service
 * worker registration is origin-scoped, so only that origin's client can act on the URL. Accepted
 * consequence: a row created under a rotated tunnel hostname still receives its push, but its
 * deep link points at a dead host, which is the deliberate cost of pruning only on 404 and 410.
 * Returns null for a stored value that is not a bare host[:port] (for example one smuggling
 * userinfo through a poisoned Host header), so it can never become an open redirect.
 */
function deepLinkUrl(origin: string, cardId: string): string | null {
  const scheme = schemeFor(origin);
  try {
    const url = new URL(`${scheme}://${origin}/`);
    if (url.host !== origin || url.username !== "" || url.password !== "") {
      return null;
    }
    url.searchParams.set("card", cardId);
    return url.href;
  } catch {
    return null;
  }
}

/** POST once, retrying exactly once on a thrown network error (never on an HTTP status, and
 * never on a timeout or abort: a slow service may have accepted the first request, and a blind
 * re-send would notify the user twice). */
async function postOnce(
  endpoint: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<Response> {
  const attempts = 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers,
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as Error).name;
      if (name === "TimeoutError" || name === "AbortError") throw err;
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr;
}

/**
 * Sign, encrypt and send one push notification per stored subscription for a needs-input
 * transition, pruning any subscription the push service reports as gone.
 * @remarks Sends to EVERY row regardless of its stored origin, with no suppression based on
 * connected SSE clients. Every per-row send settles independently inside its own try/catch, so
 * one malformed row or dead endpoint can never abort the others.
 */
export async function sendPushForCard(
  card: Card,
  reason: string | undefined,
): Promise<void> {
  const vapid = loadOrCreateVapidKeys();
  const subs = store.listPushSubscriptions();
  const title = `${card.identifier} - Needs Input`;
  const raw = reason?.trim() || NOTIFICATION_FALLBACK_BODY;
  const body =
    raw.length > MAX_BODY_CHARS ? `${raw.slice(0, MAX_BODY_CHARS - 1)}…` : raw;

  await Promise.allSettled(
    subs.map(async (sub) => {
      const endpointPrefix = sub.endpoint.slice(0, ENDPOINT_LOG_PREFIX_LEN);
      try {
        const jwt = signVapidJwt(sub.endpoint, vapid.privateKeyJwk);
        const payload = Buffer.from(
          JSON.stringify({
            cardId: card.id,
            title,
            body,
            url: deepLinkUrl(sub.origin, card.id) ?? undefined,
          }),
        );
        const encrypted = encryptPayload(sub, payload);
        const headers = {
          TTL: String(PUSH_TTL_SECONDS),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          Urgency: "high",
          Authorization: `vapid t=${jwt}, k=${vapid.publicKeyBase64Url}`,
        };
        let res = await postOnce(sub.endpoint, headers, encrypted);
        console.log(`[push] send ${res.status} ${endpointPrefix}`);
        if (res.status === 429 || res.status === 503) {
          const retryAfter = Number(res.headers.get("retry-after") ?? 5);
          const waitSeconds = Math.min(
            Number.isFinite(retryAfter) ? retryAfter : 5,
            30,
          );
          await new Promise((r) => setTimeout(r, waitSeconds * 1000));
          res = await postOnce(sub.endpoint, headers, encrypted);
          console.log(`[push] retry ${res.status} ${endpointPrefix}`);
        }
        if (res.status === 404 || res.status === 410) {
          store.removePushSubscription(sub.endpoint);
        }
      } catch (err) {
        console.error(
          `[push] send-failed ${endpointPrefix}: ${(err as Error).message}`,
        );
      }
    }),
  );
}
