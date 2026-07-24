import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WORDS } from "./remote-wordlist.js";

/** Number of EFF-wordlist words joined into one passphrase (~51.7 bits at 7776 words/word). */
const WORD_COUNT = 4;

/** Fixed message signed under the live token — the cookie carries no per-session data of its own. */
const SESSION_LABEL = "dispatch-remote-session-v1";

/** Name of the signed session cookie the gate reads/writes. */
export const COOKIE_NAME = "dispatch_remote_session";

/** Upper bound on an accepted submitted-code string, ahead of any comparison — cheap DoS/parse hardening (V5). */
const MAX_CODE_LENGTH = 64;

const BURST_ALLOWANCE = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60_000;
const DECAY_WINDOW_MS = 15 * 60_000;

/**
 * The single live remote-access credential. SECURITY: null until {@link mintToken} is called —
 * every session check below collapses "feature never minted" and "feature disabled" into the
 * exact same fail-closed path as "wrong cookie/code," with no separate enabled/disabled branch
 * anywhere in this module.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
let currentToken: string | null = null;

let failureCount = 0;
let lastFailureAt = 0;
let blockedUntil = 0;

/**
 * Pick {@link WORD_COUNT} words from the bundled EFF large wordlist via `crypto.randomInt`, which
 * performs rejection sampling internally — the unbiased-selection primitive; never hand-roll a
 * rejection loop over `randomBytes` for this.
 */
export function mintPassphrase(): string {
  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    words.push(WORDS[randomInt(WORDS.length)]);
  }
  return words.join("-");
}

/**
 * Mint a fresh passphrase and make it the live credential, invalidating every cookie signed under
 * the previous token (the HMAC recomputed below no longer matches once `currentToken` changes).
 */
export function mintToken(): string {
  currentToken = mintPassphrase();
  return currentToken;
}

/** The live credential, or null if none has been minted yet. */
export function getCurrentToken(): string | null {
  return currentToken;
}

/**
 * Invalidate the live credential — every cookie/code check collapses back to the same
 * `currentToken == null` fail-closed path {@link mintToken} exists to leave, with no separate
 * disabled branch anywhere in this module.
 */
export function clearToken(): void {
  currentToken = null;
}

/**
 * Deterministic HMAC-SHA256 of a fixed label keyed by the live token — the cookie's entire value.
 * SECURITY: the passphrase itself is the HMAC key, so there is no separate signing secret to
 * generate, store, or rotate; recomputing this under a rotated or absent token no longer matches
 * an outstanding cookie, which is what makes rotation/disable self-invalidating with no session
 * store or TTL sweep.
 */
export function signSessionValue(token: string): string {
  return createHmac("sha256", token).update(SESSION_LABEL).digest("base64url");
}

/**
 * Hand-rolled `Cookie:` header parse — both an Express `Request` and a raw upgrade
 * `IncomingMessage` expose the same plain string, so one parser serves both call sites and no
 * `cookie-parser` dependency is needed. Never throws on malformed input; a decode failure is
 * treated as absent.
 */
export function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Whether the request carries a session cookie that verifies against the currently-live token.
 * SECURITY: returns false immediately when `currentToken == null` — fail-closed by construction,
 * not by an `if (enabled)` conditional a future refactor could invert. Buffer lengths are checked
 * before `crypto.timingSafeEqual`, which throws (rather than degrading) on a length mismatch.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function hasValidSession(req: IncomingMessage): boolean {
  if (currentToken == null) return false;
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return false;
  const presented = parseCookie(cookieHeader, COOKIE_NAME);
  if (!presented) return false;
  const expected = Buffer.from(signSessionValue(currentToken));
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Constant-time credential check for a submitted code (GATE-04). SECURITY: a cheap shape guard
 * (bounded lowercase `[a-z-]` string) runs first purely for DoS/parse hardening, never as a
 * security boundary itself; the actual comparison is `crypto.timingSafeEqual` on length-checked,
 * equal-size buffers — never `===`/`includes`/`Buffer.compare` near a credential.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function verifyCode(submitted: string): boolean {
  if (currentToken == null) return false;
  if (submitted.length === 0 || submitted.length > MAX_CODE_LENGTH)
    return false;
  if (!/^[a-z-]+$/.test(submitted)) return false;
  const expected = Buffer.from(currentToken);
  const actual = Buffer.from(submitted);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Whether a credential submission is currently allowed under the single global progressive
 * backoff bucket. A shared bucket (not per-IP) is deliberate: the immediate TCP peer of every
 * request this phase can see is always `127.0.0.1` (a local forwarder or curl), so a per-source
 * map would only ever populate one key.
 */
export function checkRateLimit(): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  if (now - lastFailureAt > DECAY_WINDOW_MS) failureCount = 0;
  if (now < blockedUntil)
    return { allowed: false, retryAfterMs: blockedUntil - now };
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Record a failed submission, extending the backoff window past {@link BURST_ALLOWANCE} attempts.
 * Delay grows exponentially and is capped at {@link MAX_DELAY_MS} — a ceiling, never a permanent
 * lock, sized to the ~51-bit passphrase this guards.
 */
export function recordFailure(): void {
  const now = Date.now();
  failureCount += 1;
  lastFailureAt = now;
  if (failureCount > BURST_ALLOWANCE) {
    const delay = Math.min(
      BASE_DELAY_MS * 2 ** (failureCount - BURST_ALLOWANCE),
      MAX_DELAY_MS,
    );
    blockedUntil = now + delay;
  }
}

/** Reset the backoff bucket on a successful submission. */
export function recordSuccess(): void {
  failureCount = 0;
  blockedUntil = 0;
}
