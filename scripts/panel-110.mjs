/**
 * Phase 110 instrument script scaffold (PUSH-02, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92 through
 * panel-109. `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply here,
 * but prettier still formats this file.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-109.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on the user's live service at :4700, before this script boots any server or
 * spawns any real process, and there is no override flag. It runs FIRST in `main()`, before any
 * sandbox directory is created.
 *
 * SCOPE, Plan 01 claims this phase's instrument script, its port triple, and its registry shape
 * with one break-proven check (`needs-input-trigger-fires`) that drives a REAL tmux pane marker
 * through the REAL watcher into a REAL sandbox `board.db`. This is the phase's one new capability
 * no prior panel script needed: every send check later plans register still needs a cheap,
 * provable way to make `applyMarker` fire `status_needs_input` for real, so that driver is proven
 * FIRST, before any send code exists to blur what is being measured. Later plans add the send
 * pipeline (VAPID crypto, subscriptions, actual push delivery) and headless-Chrome-driven checks
 * for the client side of that pipeline (service worker push handler, deep-link focus/open,
 * re-fire coalescing).
 *
 * Ports, unique against every existing `panel-*.mjs` and other `scripts/*.mjs` harness (verified
 * against every prior `panel-9x.mjs`, `panel-100.mjs`, `panel-104.mjs`, `panel-108.mjs`,
 * `panel-109.mjs`'s own claimed port pair, and every non-panel `scripts/*.mjs` harness):
 * sandbox server 47883, CDP 9381, stub push service 47884 (declared now, first used by a later
 * plan's fan-out/pruning checks). Port 4700 is the user's live service and is forbidden as a
 * sandbox port.
 *
 * Usage:
 *   node scripts/panel-110.mjs                every registered check, exits non-zero on any
 *                                                violation. Refuses to exit 0 if CHECKS is empty,
 *                                                so an accidentally emptied map can never read as
 *                                                a vacuous pass.
 *   node scripts/panel-110.mjs --check <name>  one named check only. Unknown name exits non-zero
 *                                                and lists every registered name.
 *   node scripts/panel-110.mjs --break <name>  that check's OWN break: mutates the real artifact
 *                                                the check reads, confirms the SAME check function
 *                                                the real run uses reports the violation by name
 *                                                (TRIP leg), restores the captured original
 *                                                unconditionally in a `finally`, and re-confirms a
 *                                                clean pass (RESTORE leg). Never edits a source
 *                                                file without capturing and restoring its bytes.
 *   node scripts/panel-110.mjs --probe <name>  a non-assertion measurement run. Never registered
 *                                                in CHECKS and never run by a bare invocation: a
 *                                                measurement that can report a legitimate
 *                                                non-pass verdict would make the suite's exit
 *                                                code meaningless. Unknown name exits non-zero and
 *                                                lists every registered probe name.
 *
 * Exit-code contract: 0 when every requested check reports zero violations, or when a break's
 * trip leg correctly fired and its restore leg re-passed. 1 on any violation, any safety trip
 * (`assertNoLiveService`), or a break whose trip/restore leg did not behave as expected.
 *
 * DEVIATION from `panel-109.mjs`'s `bootServerAt`: this file's `bootServerAt` pipes the child's
 * stdout and stderr instead of ignoring them, accumulating both into one bounded string (oldest
 * text dropped past roughly 1MB) exposed via a `log()` accessor alongside the child process.
 * Later checks in this phase read the sandbox server's own one-line push status logs from it,
 * and ignoring the streams (as every prior panel script does) would make that evidence
 * unreachable. Every call site in this file uses the returned `{ child, log }` shape; `stopServer`
 * still takes the raw `child`.
 *
 * BREAK EVIDENCE, appended to by every plan in this phase that registers a check. The quoted
 * lines below are the VERBATIM TRIP-leg output captured from a real `--break` run:
 *   - `needs-input-trigger-fires` proven able to fail (Plan 01): replacing the `NEEDS_INPUT`
 *     alternative inside `src/server/adapters/markers/parse.ts`'s `MARKER_RE` with a token that
 *     can never appear on a real pane, rebuilding, and re-running the same check against a real
 *     booted sandbox server and a real detached tmux pane produced, verbatim:
 *     `needs-input-trigger-fires: card did not reach column "needs_input" with statusReason
 *     "panel-110-reason-48474-1787776628585" within 15000ms, observed column "in_progress"`
 *     `needs-input-trigger-fires: no events row with type "status_needs_input" and card_id
 *     "panel-110-needs-input-trigger-fires" observed within 15000ms`
 *     The RESTORE leg re-ran clean (`--break needs-input-trigger-fires RESTORE leg: PASS`) after
 *     the captured bytes were restored, and `git diff --quiet` on `parse.ts` confirmed a
 *     byte-identical restore.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  createDecipheriv as gcmDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants, sandbox/boot helper set. Ported from panel-109.mjs, renamed for
// this phase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

const SANDBOX_PORT = 47883;
const CDP_PORT = 9381;
/** Declared now, first used by a later plan's fan-out/pruning checks. */
const STUB_PUSH_PORT = 47884;
const SANDBOX_PREFIX = "dispatch-panel-110-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-110-harness-fake-key-never-real";

/** Bound on `bootServerAt`'s accumulated log string, oldest text dropped first. */
const MAX_LOG_BYTES = 1024 * 1024;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-110-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-110-LIVE"))
      throw err;
  }
}

function assertSandboxSafe(home) {
  if (SANDBOX_PORT === 4700) {
    throw new Error(
      "SANDBOX_PORT must never equal 4700, that is the user's live dispatch instance.",
    );
  }
  if (home === homedir()) {
    throw new Error(
      "sandbox home must never equal the real $HOME, refusing to proceed.",
    );
  }
  if (!home.startsWith(tmpdir())) {
    throw new Error(
      `sandbox home ${home} must live under ${tmpdir()}, refusing to proceed.`,
    );
  }
  if (!basename(home).startsWith(SANDBOX_PREFIX)) {
    throw new Error(
      `sandbox home ${home} must have a basename starting with "${SANDBOX_PREFIX}", refusing to proceed.`,
    );
  }
}

function makeSandboxHome(label) {
  const home = join(tmpdir(), `${SANDBOX_PREFIX}${label}-${process.pid}`);
  assertSandboxSafe(home);
  const dispatchDir = join(home, ".dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port: SANDBOX_PORT,
        workspaceRoot: join(home, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
        sources: { linear: { apiKey: FAKE_LINEAR_API_KEY } },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return home;
}

async function waitForReady(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/board`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // server not listening yet, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `server on :${port} did not answer 200 on /api/board within ${READY_TIMEOUT_MS}ms`,
  );
}

/** Teardown helper: SIGTERM, escalate to SIGKILL after a timeout. Always awaited in a `finally`.
 * Takes a raw `ChildProcess` (callers holding a `bootServerAt` result pass its `.child`). */
function stopServer(child) {
  if (child == null) return Promise.resolve();
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const escalate = setTimeout(() => child.kill("SIGKILL"), KILL_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(escalate);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

/** Best-effort sandbox home cleanup, called from a `finally` so a failing check never leaks a
 * temp directory. */
function cleanupSandboxHome(home) {
  if (home == null) return;
  rmSync(home, { recursive: true, force: true });
}

let headBuild = null;

/** Unconditional full `build` (web + server). Never mtime-gated. */
function assertBuilt() {
  if (headBuild !== null) return headBuild;
  const startedAt = Date.now();
  try {
    execFileSync("npm", ["run", BUILD_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `refusing to run, \`npm run ${BUILD_SCRIPT}\` failed, so dist/ does not reflect src/:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `Missing ${DIST_ENTRY} after a successful \`npm run ${BUILD_SCRIPT}\`.`,
    );
  }
  headBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: built src/ -> dist/ via \`npm run ${BUILD_SCRIPT}\` in ${headBuild.durationMs}ms`,
  );
  return headBuild;
}

/**
 * Resets `assertBuilt`'s memo so the next call forces a genuine rebuild.
 *
 * @remarks
 * This plan's break mutates a TypeScript source file and rebuilds; without this, `assertBuilt`'s
 * memo would skip that rebuild and the break would mutate dist without the source change ever
 * reaching it.
 */
function resetBuildCache() {
  headBuild = null;
}

/**
 * Break runs mutate real tracked files for minutes before their `finally` restore runs, and
 * Node's default SIGINT/SIGTERM handling terminates the process without unwinding those in-flight
 * async frames, silently leaving the sabotage bytes on disk. Every break runner registers its
 * captured original here BEFORE mutating and unregisters AFTER its `finally` restore, so a Ctrl-C
 * mid-break still restores the bytes.
 */
const pendingRestores = new Map();

function restoreOnSignal() {
  for (const [path, bytes] of pendingRestores) {
    try {
      writeFileSync(path, bytes);
    } catch {
      // best effort: an unwritable path here has no further recovery
    }
  }
  process.exit(1);
}

function registerRestore(path, bytes) {
  if (pendingRestores.size === 0) {
    process.on("SIGINT", restoreOnSignal);
    process.on("SIGTERM", restoreOnSignal);
  }
  pendingRestores.set(path, bytes);
}

function unregisterRestore(path) {
  pendingRestores.delete(path);
  if (pendingRestores.size === 0) {
    process.off("SIGINT", restoreOnSignal);
    process.off("SIGTERM", restoreOnSignal);
  }
}

/** `entry` is REALPATH'd before being handed to `node`, the macOS /var -> /private/var trap.
 * DEVIATION from panel-109.mjs (see file header): pipes stdout/stderr into one bounded
 * accumulated string instead of ignoring them, so later checks can read the sandbox server's own
 * logs. Returns `{ child, log }`; `log()` returns the accumulated text observed so far. */
function bootServerAt(home) {
  assertBuilt();
  const env = { ...process.env, HOME: home, NODE_ENV: "production" };
  const child = spawn("node", [realpathSync(DIST_ENTRY)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let acc = "";
  const append = (chunk) => {
    acc += chunk.toString("utf8");
    if (acc.length > MAX_LOG_BYTES) {
      acc = acc.slice(acc.length - MAX_LOG_BYTES);
    }
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, log: () => acc };
}

function readFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93..109.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
 * every fixture row directly via `node:sqlite` in the same pass. Ported from panel-99.mjs's
 * `seedFixtureCards`, adjusted for this file's `SANDBOX_PORT` and `bootServerAt`'s `{ child, log
 * }` return shape.
 */
async function seedFixtureCards(home, cards) {
  const dbPath = join(home, ".dispatch", "board.db");
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const warmup = bootServerAt(home);
    try {
      await waitForReady(SANDBOX_PORT);
    } finally {
      await stopServer(warmup.child);
    }
    const deadline = Date.now() + 5_000;
    while ((await isPortListening(SANDBOX_PORT)) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
    }
    const db = new DatabaseSync(dbPath);
    try {
      const hasCardsTable =
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
          )
          .get() != null;
      if (!hasCardsTable) {
        console.log(
          `seedFixtureCards: schema not yet created after warmup attempt ${attempt}/${ATTEMPTS}, retrying`,
        );
        continue;
      }
      const insert = db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      );
      for (const card of cards) insert.run(card.id, JSON.stringify(card));
      return;
    } finally {
      db.close();
    }
  }
  throw new Error(
    `seedFixtureCards: sqlite schema never appeared after ${ATTEMPTS} warmup-boot attempts`,
  );
}

// ---------------------------------------------------------------------------
// CDP harness, ported verbatim in substance from panel-109.mjs (itself from
// panel-100.mjs). Not yet driven by this plan's own check, but every later
// plan in this phase drives headless Chrome through these same helpers, so
// they are kept parameterised rather than probe specific.
// ---------------------------------------------------------------------------

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome binary found at any known path: ${CHROME_CANDIDATES.join(", ")}`,
    );
  }
  return found;
}

/** Minimal raw-CDP-over-WebSocket client (Node global WebSocket/fetch, zero new npm dependency). */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  /**
   * `timeoutMs` is a defensive bound, not a normal-path concern: every CDP round trip this file
   * issues completes in well under a second. Its purpose is to turn a genuinely lost response into
   * a diagnosable rejection instead of hanging the whole process forever, since `this.pending`'s
   * resolve/reject pair otherwise has no other way to ever settle.
   */
  send(method, params = {}, sessionId, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(
            new Error(
              `CDP.send: no response to ${method} (id ${id}) within ${timeoutMs}ms, the renderer likely stalled`,
            ),
          );
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws.close();
  }
}

async function connectCDP() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const info = await res.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new CDP(ws);
}

async function waitForCdpUp() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // Chrome debugging port not up yet, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Chrome debugging port :${CDP_PORT} did not come up`);
}

async function evalValue(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: false },
    sessionId,
  );
  if (exceptionDetails) {
    const thrown =
      exceptionDetails.exception?.description ??
      exceptionDetails.exception?.value ??
      exceptionDetails.text;
    throw new Error(
      `Runtime.evaluate failed: ${thrown}\n--- expression ---\n${expression}`,
    );
  }
  return result.value;
}

/** Identical to {@link evalValue} but for an expression that itself evaluates to a Promise. */
async function evalAsyncValue(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
    35_000,
  );
  if (exceptionDetails) {
    const thrown =
      exceptionDetails.exception?.description ??
      exceptionDetails.exception?.value ??
      exceptionDetails.text;
    throw new Error(
      `Runtime.evaluate (async) failed: ${thrown}\n--- expression ---\n${expression}`,
    );
  }
  return result.value;
}

/** Same path `launchChrome` passes to `--user-data-dir` and the same path its caller must
 * `rmSync` in teardown, kept as one function so the two can never drift apart. */
function chromeUserDataDir() {
  return join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`);
}

/** Always a dedicated `--user-data-dir` under `tmpdir()`, never the developer's default Chrome
 * profile: granting a CDP permission into a real profile would be a durable side effect on their
 * machine. */
function launchChrome() {
  return spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeUserDataDir()}`,
      "--no-first-run",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
}

async function openPage(cdp, { url }) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  return { targetId, sessionId };
}

/** Stands in for the prompt UI headless Chrome never renders: a dispatched click can never answer
 * a prompt that is not drawn. Tries the current `Browser.setPermission` method first and falls
 * back to the deprecated but functional `Browser.grantPermissions` when the target Chrome build
 * lacks it, logging which path fired. */
async function grantNotifications(cdp, origin) {
  try {
    await cdp.send("Browser.setPermission", {
      origin,
      permission: { name: "notifications" },
      setting: "granted",
    });
    console.log(`grantNotifications: used Browser.setPermission for ${origin}`);
  } catch (err) {
    console.log(
      `grantNotifications: Browser.setPermission failed (${err.message}), falling back to Browser.grantPermissions`,
    );
    await cdp.send("Browser.grantPermissions", {
      origin,
      permissions: ["notifications"],
    });
    console.log(
      `grantNotifications: used Browser.grantPermissions for ${origin}`,
    );
  }
}

/** Polls `expression` via {@link evalValue} until it is truthy, swallowing evaluate errors so a
 * transient stale execution context (e.g. immediately after `Page.navigate`) reads as "not ready
 * yet" instead of aborting the poll. Returns `null` on timeout rather than throwing, so callers
 * can attach their own diagnostic message. */
async function pollUntilTruthy(cdp, sessionId, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evalValue(cdp, sessionId, expression);
      if (value) return value;
    } catch {
      // transient (e.g. navigation in flight), keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Push subscription table readers, ported verbatim in substance from
// panel-109.mjs. Not yet driven by this plan's own check (no push tables are
// read here), but a later plan's send/fan-out checks need one shared reader
// vocabulary for the `push_subscriptions` table.
// ---------------------------------------------------------------------------

/** Independent read of the sandbox `board.db`'s `push_subscriptions` table, never trusting a
 * caller's own claim that a subscribe or unsubscribe succeeded. */
function readPushDbRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM push_subscriptions").all();
  } finally {
    db.close();
  }
}

/** Polls the independent database read until `predicate` holds or `timeoutMs` elapses, returning
 * whichever rows were last observed either way. */
async function pollPushDbRows(dbPath, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = readPushDbRows(dbPath);
  while (Date.now() < deadline) {
    last = readPushDbRows(dbPath);
    if (predicate(last)) return last;
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Stub push service, subscriber keys, and the RFC 8291/8292 receive side
// (Plan 04's own new capability): the harness impersonates a push service on
// loopback and independently decrypts what the real send pipeline sent it,
// so a later check can assert on real payload contents.
// ---------------------------------------------------------------------------

/** A `node:http` server bound to 127.0.0.1 on `STUB_PUSH_PORT`, recording every request as `{
 * method, path, headers, body }` (body collected as a Buffer) and answering with a status derived
 * from the path prefix, so one stub can play several push-service roles: `/ok/` -> 201, `/gone/`
 * -> 410, `/missing/` -> 404, `/busy/` -> 429, anything else -> 400. Callers must `close()` it in a
 * `finally`. */
function startStubPushService() {
  let recorded = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "/";
      recorded.push({
        method: req.method ?? "",
        path,
        headers: { ...req.headers },
        body: Buffer.concat(chunks),
      });
      const status = path.startsWith("/ok/")
        ? 201
        : path.startsWith("/gone/")
          ? 410
          : path.startsWith("/missing/")
            ? 404
            : path.startsWith("/busy/")
              ? 429
              : 400;
      res.writeHead(status);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(STUB_PUSH_PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        requests: () => [...recorded],
        reset: () => {
          recorded = [];
        },
        close: () => new Promise((r) => server.close(() => r())),
        waitForRequests: async (n, timeoutMs) => {
          const deadline = Date.now() + timeoutMs;
          while (recorded.length < n && Date.now() < deadline) {
            await sleep(POLL_INTERVAL_MS);
          }
          return [...recorded];
        },
      });
    });
  });
}

/** Generates a P-256 keypair and a 16-byte auth secret, standing in for a browser's
 * `pushManager.subscribe()` output. `p256dh` is the base64url-encoded 65-byte uncompressed EC
 * point, `auth` is base64url, `privateKey` is the raw `KeyObject` kept for {@link
 * decryptPushBody}'s ECDH step. */
function makeSubscriberKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return {
    p256dh: point.toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    privateKey,
  };
}

/** INSERTs one row directly into the sandbox `push_subscriptions` table via `node:sqlite`
 * `DatabaseSync`, mirroring the schema `board-db.ts` creates. Callable several times against the
 * same sandbox home before a single server boot; the schema must already exist (a prior
 * `seedNeedsInputCard`/`seedFixtureCards` warmup boot guarantees that). */
function seedSubscriptionRow(home, { endpoint, keys, origin }) {
  const dbPath = join(home, ".dispatch", "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, origin, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
         origin = excluded.origin, created_at = excluded.created_at`,
    ).run(endpoint, keys.p256dh, keys.auth, origin, new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Parses the `aes128gcm` header (RFC 8188: salt(16), record size(4 BE), key id length(1), key
 * id), rebuilds the server's ephemeral public key from the 65-byte point, runs the RFC 8291
 * receive-side derivation (ECDH via {@link diffieHellman}, then three `hkdfSync` stages each
 * wrapped in `Buffer.from`), decrypts with `aes-128-gcm` using the trailing 16 bytes as the auth
 * tag, strips the trailing `0x02` delimiter and any zero padding, and returns the parsed JSON.
 * Throws a descriptive error naming which stage failed (header length, point length, tag
 * verification, delimiter), so a check violation says what broke. */
function decryptPushBody(body, subscriberKeys) {
  if (!Buffer.isBuffer(body) || body.length < 21) {
    throw new Error(
      `decryptPushBody: body (${body?.length ?? 0} bytes) too short to contain an aes128gcm ` +
        `header (stage: header length)`,
    );
  }
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const headerLen = 21 + idlen;
  if (body.length < headerLen + 16) {
    throw new Error(
      `decryptPushBody: body (${body.length} bytes) too short for a ${idlen}-byte keyid plus a ` +
        `16-byte auth tag (stage: header length)`,
    );
  }
  const keyid = body.subarray(21, headerLen);
  if (keyid.length !== 65) {
    throw new Error(
      `decryptPushBody: server ephemeral public key point is ${keyid.length} bytes, expected 65 ` +
        `(stage: point length)`,
    );
  }
  const ciphertextAndTag = body.subarray(headerLen);
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);

  const serverEphemeralPublicKey = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: keyid.subarray(1, 33).toString("base64url"),
      y: keyid.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  const sharedSecret = diffieHellman({
    privateKey: subscriberKeys.privateKey,
    publicKey: serverEphemeralPublicKey,
  });

  const subscriberPoint = Buffer.from(subscriberKeys.p256dh, "base64url");
  const authSecret = Buffer.from(subscriberKeys.auth, "base64url");
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    subscriberPoint,
    keyid,
  ]);
  const prk = Buffer.from(
    hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32),
  );
  const cek = Buffer.from(
    hkdfSync(
      "sha256",
      prk,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0"),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", prk, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );

  let decrypted;
  try {
    const decipher = gcmDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(tag);
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new Error(
      `decryptPushBody: AES-128-GCM tag verification failed (stage: tag verification): ${err.message}`,
    );
  }

  let end = decrypted.length;
  while (end > 0 && decrypted[end - 1] === 0x00) end--;
  if (end === 0 || decrypted[end - 1] !== 0x02) {
    throw new Error(
      "decryptPushBody: padding delimiter 0x02 not found after decryption (stage: delimiter)",
    );
  }
  return JSON.parse(decrypted.subarray(0, end - 1).toString("utf8"));
}

/** Parses a `vapid t=<jwt>, k=<pubkey>` Authorization header value, checks the decoded JWT header
 * names ES256, the claims' `aud` equals `endpointOrigin` and `exp` is in the future and no more
 * than 24 hours out, the decoded signature is exactly 64 bytes, and verifies it against a public
 * key rebuilt from `k` with `dsaEncoding: "ieee-p1363"`. Returns a list of problem strings (empty
 * when valid) rather than throwing, so a check can attribute each failure by name. */
function verifyVapidAuthorization(headerValue, endpointOrigin) {
  const problems = [];
  const match = /^vapid\s+t=([^,]+),\s*k=(.+)$/i.exec(
    (headerValue ?? "").trim(),
  );
  if (!match) {
    problems.push(
      `verifyVapidAuthorization: header value does not match "vapid t=..., k=..." shape: ${JSON.stringify(headerValue)}`,
    );
    return problems;
  }
  const [, jwt, k] = match;
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    problems.push(
      `verifyVapidAuthorization: JWT has ${parts.length} dot-separated parts, expected 3`,
    );
    return problems;
  }
  const [headerB64, claimsB64, sigB64] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch (err) {
    problems.push(
      `verifyVapidAuthorization: JWT header is not valid JSON: ${err.message}`,
    );
    return problems;
  }
  if (header.alg !== "ES256") {
    problems.push(
      `verifyVapidAuthorization: JWT header alg is ${JSON.stringify(header.alg)}, expected "ES256"`,
    );
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(claimsB64, "base64url").toString("utf8"));
  } catch (err) {
    problems.push(
      `verifyVapidAuthorization: JWT claims are not valid JSON: ${err.message}`,
    );
    return problems;
  }
  if (claims.aud !== endpointOrigin) {
    problems.push(
      `verifyVapidAuthorization: claims.aud is ${JSON.stringify(claims.aud)}, expected ${JSON.stringify(endpointOrigin)}`,
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) {
    problems.push(
      `verifyVapidAuthorization: claims.exp (${claims.exp}) is not in the future (now ${nowSec})`,
    );
  } else if (claims.exp - nowSec > 24 * 3600) {
    problems.push(
      `verifyVapidAuthorization: claims.exp is more than 24 hours out (${claims.exp - nowSec}s)`,
    );
  }

  const signature = Buffer.from(sigB64, "base64url");
  if (signature.length !== 64) {
    problems.push(
      `verifyVapidAuthorization: signature is ${signature.length} bytes, expected 64`,
    );
    return problems;
  }

  let publicKey;
  try {
    const point = Buffer.from(k, "base64url");
    if (point.length !== 65) {
      problems.push(
        `verifyVapidAuthorization: k= public key point is ${point.length} bytes, expected 65`,
      );
      return problems;
    }
    publicKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
  } catch (err) {
    problems.push(
      `verifyVapidAuthorization: could not rebuild public key from k=: ${err.message}`,
    );
    return problems;
  }

  let valid = false;
  try {
    valid = verifySignature(
      "sha256",
      Buffer.from(`${headerB64}.${claimsB64}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch (err) {
    problems.push(
      `verifyVapidAuthorization: signature verification threw: ${err.message}`,
    );
    return problems;
  }
  if (!valid) {
    problems.push(
      "verifyVapidAuthorization: ES256 signature did not verify against k=",
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Real-tmux marker driver (Plan 01's own new capability): a detached tmux
// pane, a literal DISPATCH_STATUS line typed into it, and an independent
// board.db read that never trusts the watcher's own claim of what happened.
// ---------------------------------------------------------------------------

/** `tmux new-session -d -s <name> -x 200 -y 50 bash`, argv form (never a shell string). The `-x
 * 200 -y 50` geometry matches `src/server/adapters/tmux.ts#newSession`'s own load-bearing
 * geometry for sane capture-pane output. */
async function startTmuxPane(name) {
  await execFileP("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-x",
    "200",
    "-y",
    "50",
    "bash",
  ]);
}

/** `tmux kill-session -t <name>`, best effort, always called from a `finally`. */
async function killTmuxPane(name) {
  try {
    await execFileP("tmux", ["kill-session", "-t", name]);
  } catch {
    // best effort: an already-dead session has nothing left to kill
  }
}

/** One fixture card shaped for `scanSession`'s preconditions (`src/server/adapters/markers/
 * watcher.ts`): `column: "in_progress"` (not `todo`, so the scan does not bail early), no
 * `source` set (matches panel-99.mjs's own fixture cards, defaulting to `"linear"` on read, a
 * non-`"group"` value since `"group"` is excluded from active-session mirroring elsewhere in the
 * store), `activeSessionId` and a matching `sessions` entry naming `tmuxSession`, plus the flat
 * `tmuxSession` mirror the pre-Phase-91 fallback paths still read. `statusChannel: "auto"` and no
 * `hookRoutedAt` stamp (both true by construction here, since this card is inserted directly, not
 * routed through a real hook POST) keep the pane-scan channel live. */
async function seedNeedsInputCard(
  home,
  { cardId, identifier, sessionId, tmuxSession },
) {
  const now = new Date().toISOString();
  const card = {
    id: cardId,
    issueId: `${cardId}-issue`,
    identifier,
    title: `panel-110 ${identifier} fixture card`,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: now,
    activeSessionId: sessionId,
    tmuxSession,
    sessions: [
      {
        id: sessionId,
        createdAt: now,
        updatedAt: now,
        tmuxSession,
      },
    ],
  };
  await seedFixtureCards(home, [card]);
}

/** Sends one literal marker line into the pane via `tmux send-keys`, argv form (never a shell
 * string built through node's own shell): the bullet glyph, a space, `DISPATCH_STATUS: `, `kind`,
 * a space, a plain ASCII hyphen, a space, and `reason`, followed by a real Enter keypress. The
 * pane's own `bash` interprets the typed `printf` command and its OUTPUT is what lands on the
 * capturable screen as the marker line; the typed command line itself never starts with the
 * bullet glyph, so it cannot itself match `MARKER_RE`.
 * @remarks `parse.ts#parseLastMarker` greedily joins every non-blank physical line after a marker
 * line into its reason until a boundary (blank line, a fresh bullet block, or the footer/input-box
 * border), a boundary a real claude TUI always supplies quickly, but a bare `bash` pane's next
 * shell prompt does not. The single `printf` call therefore also emits a border-chrome line
 * (`CHROME_BORDER_RE`) immediately after the marker, so the reason capture stops at exactly this
 * marker's own text instead of swallowing the next shell prompt as a false continuation. */
async function driveMarker(tmuxName, kind, reason) {
  const line = `⏺ DISPATCH_STATUS: ${kind} - ${reason}`;
  const border = "─".repeat(10);
  const escapeSingleQuoted = (s) => s.replace(/'/g, `'\\''`);
  const printfCmd = `printf '%s\\n%s\\n' '${escapeSingleQuoted(line)}' '${border}'`;
  await execFileP("tmux", ["send-keys", "-t", tmuxName, printfCmd, "Enter"]);
}

/** Opens the sandbox `board.db` with `node:sqlite` `DatabaseSync` on each poll (WAL mode, so a
 * read-only open never blocks on the server's own write connection), hands `predicate` the
 * parsed `cards` rows (JSON-parsed `data`) and the raw `events` rows, and returns the first
 * truthy predicate result. Throws on timeout with whatever rows were last observed, so a failing
 * caller has real evidence rather than a bare timeout message. */
async function pollBoardDb(home, predicate, timeoutMs) {
  const dbPath = join(home, ".dispatch", "board.db");
  const deadline = Date.now() + timeoutMs;
  let lastCards = [];
  let lastEvents = [];
  while (Date.now() < deadline) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      lastCards = db
        .prepare("SELECT * FROM cards")
        .all()
        .map((row) => JSON.parse(row.data));
      lastEvents = db.prepare("SELECT * FROM events").all();
    } finally {
      db.close();
    }
    const result = predicate(lastCards, lastEvents);
    if (result) return result;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `pollBoardDb: predicate never became truthy within ${timeoutMs}ms. Last observed cards: ` +
      `${JSON.stringify(lastCards)}\nLast observed events: ${JSON.stringify(lastEvents)}`,
  );
}

const NEEDS_INPUT_TRIGGER_TICK_SLACK_MS = 15_000;

/** Boots a fresh sandbox home, starts a real detached tmux pane, seeds one fixture card shaped
 * for the watcher's preconditions, boots the real server, drives a real `NEEDS_INPUT` marker line
 * into the pane, then polls the sandbox `board.db` (never the app's own SSE/API claim) for BOTH
 * the card's persisted column and reason AND the corresponding `events` row. Pushes one named
 * violation per missed assertion; never a bare throw. Tears down the tmux pane, the server and
 * the sandbox home in a `finally`. */
async function checkNeedsInputTriggerFires(violations) {
  assertBuilt();
  const home = makeSandboxHome("needs-input-trigger-fires");
  const cardId = "panel-110-needs-input-trigger-fires";
  const identifier = "PANEL-110-01";
  const sessionId = randomUUID();
  const tmuxName = `${SANDBOX_PREFIX}pane-${process.pid}`;
  const reason = `panel-110-reason-${process.pid}-${Date.now()}`;
  let boot;
  try {
    await startTmuxPane(tmuxName);
    await seedNeedsInputCard(home, {
      cardId,
      identifier,
      sessionId,
      tmuxSession: tmuxName,
    });
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    await driveMarker(tmuxName, "NEEDS_INPUT", reason);

    let observed;
    try {
      observed = await pollBoardDb(
        home,
        (cards, events) => {
          const card = cards.find((c) => c.id === cardId);
          const cardOk =
            card != null &&
            card.column === "needs_input" &&
            card.statusReason === reason;
          const event = events.find(
            (e) => e.type === "status_needs_input" && e.card_id === cardId,
          );
          if (cardOk && event) return { card, event };
          return null;
        },
        NEEDS_INPUT_TRIGGER_TICK_SLACK_MS,
      );
    } catch {
      observed = null;
    }

    if (observed == null) {
      const db = new DatabaseSync(join(home, ".dispatch", "board.db"), {
        readOnly: true,
      });
      let lastCard;
      let hadEvent;
      try {
        const row = db
          .prepare("SELECT data FROM cards WHERE id = ?")
          .get(cardId);
        lastCard = row ? JSON.parse(row.data) : null;
        hadEvent =
          db
            .prepare(
              "SELECT 1 FROM events WHERE type = 'status_needs_input' AND card_id = ?",
            )
            .get(cardId) != null;
      } finally {
        db.close();
      }
      if (
        lastCard == null ||
        lastCard.column !== "needs_input" ||
        lastCard.statusReason !== reason
      ) {
        violations.push(
          `needs-input-trigger-fires: card did not reach column "needs_input" with statusReason ` +
            `${JSON.stringify(reason)} within ${NEEDS_INPUT_TRIGGER_TICK_SLACK_MS}ms, observed ` +
            `column ${JSON.stringify(lastCard?.column ?? null)}`,
        );
      }
      if (!hadEvent) {
        violations.push(
          `needs-input-trigger-fires: no events row with type "status_needs_input" and card_id ` +
            `${JSON.stringify(cardId)} observed within ${NEEDS_INPUT_TRIGGER_TICK_SLACK_MS}ms`,
        );
      }
    }
  } finally {
    await killTmuxPane(tmuxName);
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const PARSE_TS_PATH = join(REPO_ROOT, "src/server/adapters/markers/parse.ts");
const MARKER_RE_TARGET = "NEEDS_INPUT|DONE";
const MARKER_RE_REPLACEMENT = "NEEDS_INPUT_PANEL110_BREAK_NEVER_ON_PANE|DONE";

/** `--break needs-input-trigger-fires`: mutates `parse.ts`'s `MARKER_RE` so the `NEEDS_INPUT`
 * alternative can never match a real pane line (`driveMarker` always sends the literal text
 * `NEEDS_INPUT`), rebuilds via `resetBuildCache()`, and requires the SAME check function to
 * report both violations (trip leg). Restores the captured bytes unconditionally in a `finally`,
 * rebuilds, and requires a clean pass (restore leg). */
async function runBreakNeedsInputTriggerFires() {
  assertBuilt();
  const original = readFileSync(PARSE_TS_PATH, "utf8");
  const occurrences = original.split(MARKER_RE_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel110: refusing to run --break needs-input-trigger-fires, expected ` +
        `${JSON.stringify(MARKER_RE_TARGET)} to occur exactly once in ${PARSE_TS_PATH}, measured ` +
        `${occurrences}. A miscounted anchor would mutate the wrong spot and report a false ` +
        `"the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(PARSE_TS_PATH, original);
  try {
    writeFileSync(
      PARSE_TS_PATH,
      original.replace(MARKER_RE_TARGET, MARKER_RE_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkNeedsInputTriggerFires(tripViolations);
    console.log(
      `\n--break needs-input-trigger-fires TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired =
      tripViolations.some((v) => v.includes('column "needs_input"')) &&
      tripViolations.some((v) => v.includes("status_needs_input"));
  } finally {
    writeFileSync(PARSE_TS_PATH, original);
    resetBuildCache();
    unregisterRestore(PARSE_TS_PATH);
  }

  const restoreViolations = [];
  await checkNeedsInputTriggerFires(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break needs-input-trigger-fires RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// CHECKS / BREAKS / PROBES registries. Every later plan in this phase
// appends here.
// ---------------------------------------------------------------------------

const CHECKS = {
  "needs-input-trigger-fires": (violations) =>
    checkNeedsInputTriggerFires(violations),
};

const BREAKS = {
  "needs-input-trigger-fires": runBreakNeedsInputTriggerFires,
};

const PROBES = {};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  await assertNoLiveService();

  const argv = process.argv.slice(2);
  const checkName = readFlag(argv, "--check");
  if (checkName != null && !CHECKS[checkName]) {
    console.error(
      `unknown check "${checkName}", valid: ${Object.keys(CHECKS).join(", ")}`,
    );
    process.exit(1);
  }
  const breakName = readFlag(argv, "--break");
  if (breakName != null && !BREAKS[breakName]) {
    console.error(
      `unknown break "${breakName}", valid: ${Object.keys(BREAKS).join(", ")}`,
    );
    process.exit(1);
  }
  const probeName = readFlag(argv, "--probe");
  if (probeName != null && !PROBES[probeName]) {
    console.error(
      `unknown probe "${probeName}", valid: ${Object.keys(PROBES).join(", ")}`,
    );
    process.exit(1);
  }
  if (Object.keys(CHECKS).length === 0) {
    console.error(
      "panel-110: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
    );
    process.exit(1);
  }

  if (probeName != null) {
    await PROBES[probeName]();
    process.exit(0);
  }

  if (breakName != null) {
    const result = await BREAKS[breakName]();
    console.log(
      `\n--break ${breakName} summary: tripFired=${result.tripFired} restoreClean=${result.restoreClean}`,
    );
    if (!result.tripFired) {
      console.log(
        `FAIL (self-check): the trip leg did NOT report the expected violation for "${breakName}", the check is a dead instrument.`,
      );
      process.exit(1);
    }
    if (!result.restoreClean) {
      console.log(
        `FAIL (self-check): the restore leg for "${breakName}" still reports a violation after restoring the captured original value.`,
      );
      process.exit(1);
    }
    console.log(
      `PASS (--break ${breakName} self-check): trip leg correctly reported the violation, restore leg re-passed clean.`,
    );
    process.exit(0);
  }

  const violations = [];
  const names = checkName != null ? [checkName] : Object.keys(CHECKS);
  for (const n of names) {
    console.log(`\n=== running check: ${n} ===`);
    const before = violations.length;
    try {
      await CHECKS[n](violations);
    } catch (err) {
      violations.push(
        `${n}: run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
    const added = violations.length - before;
    console.log(
      added === 0 ? `PASS (${n})` : `FAIL (${n}): ${added} violation(s)`,
    );
  }

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`  ${v}`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`panel-110 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
