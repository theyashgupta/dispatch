import type { IncomingMessage } from "node:http";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import express from "express";
import { isLocalRequest } from "./loopback.js";
import {
  COOKIE_NAME,
  checkRateLimit,
  getCurrentToken,
  hasValidSession,
  recordFailure,
  recordSuccess,
  signSessionValue,
  verifyCode,
} from "../services/infra/remote-auth.js";

const VERIFY_PATH = "/__remote/verify";

const GENERIC_ERROR = "That code didn't match — try again.";
const RATE_LIMITED_ERROR = "Too many attempts — wait a moment and try again.";

/**
 * Whether a request may proceed without a code prompt: local by the existing loopback predicate,
 * or carrying a valid session cookie. Typed at `IncomingMessage` (not Express's `Request`) so the
 * SAME function is reused, byte-for-byte, inside the raw `http.Server` upgrade handler that never
 * runs through Express middleware.
 */
export function isRequestAllowed(req: IncomingMessage): boolean {
  return isLocalRequest(req) || hasValidSession(req);
}

/**
 * A same-request-Host cross-check, not a stored allowlist: a legitimate top-level POST from the
 * code-entry page carries an Origin/Referer matching that same request's own Host (whatever it
 * is — loopback in dev, the eventual tunnel host in Phase 74); a cross-site forged POST carries
 * the attacker's own origin, which never matches the victim's Host. A request with neither header
 * (e.g. a bare `curl`) is allowed through — there is nothing to cross-check.
 */
function originMatchesHost(req: Request): boolean {
  const host = req.headers.host;
  if (!host) return true;
  const candidate = req.headers.origin ?? req.headers.referer;
  if (typeof candidate !== "string") return true;
  try {
    return new URL(candidate).host === host;
  } catch {
    return false;
  }
}

type CodeAttemptResult =
  { ok: true } | { ok: false; reason: "csrf" | "rate-limited" | "invalid" };

/**
 * Shared submission path for both the verify POST and the `?code=` GET consume: CSRF-checked,
 * then constant-time-verified, and only THEN — on a wrong code — consulted against the backoff.
 * SECURITY: the credential compare runs BEFORE the rate-limit check so a byte-correct code always
 * authenticates and resets the bucket, even while the global backoff is active; otherwise a
 * zero-knowledge attacker trickling wrong guesses could keep the bucket blocked and lock the real
 * user out of their own session (self-DoS). The compare runs identically regardless of block state,
 * so the reorder adds no timing oracle distinguishing "locked" from "wrong"; only a FAILED attempt
 * ever consults or advances the backoff, and a request with no matching Origin/Host never reaches
 * the compare at all.
 */
function attemptCode(req: Request, code: string): CodeAttemptResult {
  if (!originMatchesHost(req)) return { ok: false, reason: "csrf" };
  if (verifyCode(code)) {
    recordSuccess();
    return { ok: true };
  }
  const { allowed } = checkRateLimit();
  if (!allowed) return { ok: false, reason: "rate-limited" };
  recordFailure();
  return { ok: false, reason: "invalid" };
}

/**
 * Set the signed session cookie against the currently-live token. SECURITY: `secure: true` is a
 * hardcoded literal, never derived from `req.secure`/`trust proxy` — a spoofed
 * `X-Forwarded-Proto` on a direct loopback request must never flip this.
 */
function setSessionCookie(res: Response): void {
  const token = getCurrentToken();
  if (token == null) return;
  res.cookie(COOKIE_NAME, signSessionValue(token), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Self-contained, server-rendered code-entry page: inline `<style>` and an inlined logo only, so
 * it renders with zero external requests — it may be the only page a blocked remote client ever
 * sees. Feature-off and wrong-code render the identical page (optionally with the same generic
 * error text); nothing here discloses whether remote access is enabled.
 */
function codeEntryPageHtml(errorMessage?: string): string {
  const errorBlock = errorMessage
    ? `<p class="error" role="alert">${errorMessage}</p>`
    : `<p class="error" hidden></p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>Dispatch — Enter access code</title>
<style>
  :root {
    --bg: #0b0c0e;
    --text: #e8e9ea;
    --text-muted: #8a8f98;
    --accent: #5e6ad2;
    --border: #26272b;
    --font-ui: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  html, body {
    height: 100%;
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  main {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .logo {
    width: 48px;
    height: 34px;
    color: var(--accent);
  }
  h1 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
    text-align: center;
  }
  .helper {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
    text-align: center;
  }
  form {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  input[type="text"] {
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    background: #131417;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 15px;
  }
  input[type="text"]:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  button {
    width: 100%;
    min-height: 44px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  .error {
    margin: 0;
    min-height: 16px;
    color: #e5484d;
    font-size: 13px;
    text-align: center;
  }
  .error[hidden] {
    visibility: hidden;
  }
</style>
</head>
<body>
<main>
  <svg class="logo" viewBox="0 0 120 86" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" role="presentation" aria-hidden="true">
    <path d="M12 18 H40 C52 18 44 43 56 43" />
    <path d="M12 68 H40 C52 68 44 43 56 43" />
    <path d="M12 43 H96" />
    <path d="M82 30 L104 43 L82 56" />
  </svg>
  <h1>Enter access code</h1>
  <p class="helper">Ask the host for the code, or scan the QR.</p>
  <form method="POST" action="${VERIFY_PATH}">
    <input
      type="text"
      name="code"
      placeholder="word-word-word-word"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      inputmode="text"
      autofocus
    />
    <button type="submit">Continue</button>
    <div aria-live="polite">${errorBlock}</div>
  </form>
</main>
</body>
</html>
`;
}

/**
 * POST /__remote/verify: the one deliberately-unauthenticated write this gate exposes (a code
 * submission is how a session becomes valid in the first place). Its own `express.urlencoded`
 * parser is mounted below since `express.json()` is scoped only under `/api`.
 */
function verifyHandler(req: Request, res: Response): void {
  const code = (req.body as { code?: unknown } | undefined)?.code;
  if (typeof code !== "string" || code.length === 0) {
    res
      .status(200)
      .type("html")
      .set("Referrer-Policy", "no-referrer")
      .send(codeEntryPageHtml(GENERIC_ERROR));
    return;
  }

  const result = attemptCode(req, code);
  if (!result.ok) {
    if (result.reason === "csrf") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const message =
      result.reason === "rate-limited" ? RATE_LIMITED_ERROR : GENERIC_ERROR;
    res
      .status(200)
      .type("html")
      .set("Referrer-Policy", "no-referrer")
      .send(codeEntryPageHtml(message));
    return;
  }

  setSessionCookie(res);
  res.set("Referrer-Policy", "no-referrer").redirect(302, "/");
}

/**
 * The catch-all gate: local and already-authenticated requests pass through untouched; a `?code=`
 * GET (the QR/own-phone path) consumes and strips the code in one redirect; every other
 * non-loopback, unauthenticated request — `/api/board`, `/assets/x`, `/`, anything — renders the
 * SAME code-entry page. That uniformity is what makes "feature off" and "wrong code"
 * indistinguishable from the outside (fail-closed disclosure).
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
function remoteAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isLocalRequest(req)) {
    next();
    return;
  }
  if (hasValidSession(req)) {
    next();
    return;
  }

  const submitted = typeof req.query.code === "string" ? req.query.code : null;
  if (req.method === "GET" && submitted) {
    const result = attemptCode(req, submitted);
    if (result.ok) {
      setSessionCookie(res);
      const clean = new URL(req.originalUrl, `http://${req.headers.host}`);
      clean.searchParams.delete("code");
      res
        .set("Referrer-Policy", "no-referrer")
        .redirect(302, clean.pathname + clean.search);
      return;
    }
  }

  res
    .status(200)
    .type("html")
    .set("Referrer-Policy", "no-referrer")
    .send(codeEntryPageHtml());
}

/**
 * The remote-auth gate router: NOT yet mounted anywhere (a later phase hoists it as the first
 * `app.use()` in `bootstrap/index.ts`, per RESEARCH). Registers the verify POST first so it is
 * exempted from `remoteAuthMiddleware`'s catch-all before that catch-all is reached.
 */
export const remoteAuthRouter = Router();

remoteAuthRouter.post(
  VERIFY_PATH,
  express.urlencoded({ extended: false, limit: "1kb" }),
  verifyHandler,
);
remoteAuthRouter.use(remoteAuthMiddleware);
