/**
 * Phase 112 instrument script scaffold (MDV-01/03/04/05/06, dev/ops tooling, NOT test code): no
 * test framework, no assertion library, lives outside src/, the same category as panel-92 through
 * panel-111. `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply here,
 * but prettier still formats this file.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-111.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on the user's live service at :4700, before this script boots any server or
 * spawns any real process, and there is no override flag. It runs FIRST in `main()`, before any
 * sandbox directory is created.
 *
 * SCOPE, Plan 02 claims this phase's instrument script, its port claims, and the stable fixture
 * set every later plan in this phase reuses, with two break-proven checks: `viewer-page-served`
 * (pure HTTP, no Chrome, proves the built page and its hashed assets resolve behind the gate) and
 * `error-states` (real headless Chrome via CDP, proves the UI-SPEC error copy renders exactly).
 * Plans 03-04 add the rendering, navigation, and scroll checks on top of this same scaffold; no
 * tmux/ttyd helpers exist yet (a later plan adds them).
 *
 * Ports, unique against every existing `panel-*.mjs` and other `scripts/*.mjs` harness (verified
 * by grepping every `SANDBOX_PORT =` and `CDP_PORT =` assignment in `scripts/*.mjs`: the highest
 * claimed `SANDBOX_PORT` is 47885 (panel-111.mjs), the highest claimed `CDP_PORT` is 9381
 * (panel-110.mjs)): sandbox server 47886, Chrome remote-debugging 9382. Never 4700.
 *
 * Usage:
 *   node scripts/panel-112.mjs                every registered check, exits non-zero on any
 *                                                violation. Refuses to exit 0 if CHECKS is empty,
 *                                                so an accidentally emptied map can never read as
 *                                                a vacuous pass.
 *   node scripts/panel-112.mjs --check <name>  one named check only. Unknown name exits non-zero
 *                                                and lists every registered name.
 *   node scripts/panel-112.mjs --break <name>  that check's OWN break: mutates the real artifact
 *                                                the check reads, confirms the SAME check function
 *                                                the real run uses reports the violation by name
 *                                                (TRIP leg), restores the captured original
 *                                                unconditionally in a `finally`, and re-confirms a
 *                                                clean pass (RESTORE leg). Never edits a source
 *                                                file without capturing and restoring its bytes.
 *
 * Exit-code contract: 0 when every requested check reports zero violations, or when a break's
 * trip leg correctly fired and its restore leg re-passed. 1 on any violation, any safety trip
 * (`assertNoLiveService`), or a break whose trip/restore leg did not behave as expected.
 *
 * BREAK EVIDENCE, appended to by every plan in this phase that registers a check. The quoted
 * lines below are the VERBATIM TRIP-leg output captured from a real `--break` run:
 *   - `viewer-page-served` proven able to fail (Plan 02): replacing the sole `"viewer.html"`
 *     literal in `src/server/routes/viewer-page.route.ts` with `"viewer-missing.html"`,
 *     rebuilding, and re-running the same check against a real booted sandbox server produced,
 *     verbatim:
 *     `viewer-page-served: expected 200 for GET /viewer/, observed 404`
 *     `viewer-page-served: could not find a ./assets/ script src in the served viewer.html body`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and
 *     `git diff --quiet src/` confirmed a byte-identical restore.
 *   - `error-states` proven able to fail (Plan 02): replacing the sole `res.status === 413`
 *     comparison in `src/web/viewer-main.tsx` with the unreachable `res.status === 999413`,
 *     rebuilding, and re-running the same check against a real oversized fixture and a real
 *     headless Chrome produced, verbatim:
 *     `error-states: the >2MB fixture never rendered the exact "File too large to preview" copy within 15000ms`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and
 *     `git diff --quiet src/` confirmed a byte-identical restore.
 *   - `no-raw-html-injection` proven able to fail (Plan 03): replacing the img override's anchor
 *     rendering in `src/web/viewer/ViewerDoc.tsx` with a native `<img>` element passing `src`
 *     through unchanged, rebuilding, and re-running the same check against the raw-HTML fixture
 *     and a real headless Chrome produced, verbatim:
 *     `no-raw-html-injection: expected 0 img elements inside the content root, observed 1`
 *     `no-raw-html-injection: expected the markdown image's anchor rel to include "noopener", observed null`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and a byte-diff against
 *     the pre-break snapshot confirmed an identical restore.
 *   - `syntax-highlighting` proven able to fail (Plan 03): removing `rehypeHighlight` from the
 *     `rehypePlugins` array in `src/web/viewer/ViewerDoc.tsx` (import left in place), rebuilding,
 *     and re-running the same check against the code-fences fixture and a real headless Chrome
 *     produced, verbatim:
 *     `syntax-highlighting: expected at least one "pre code [class*='hljs-']" element (the ts fence highlighted), found none`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and a byte-diff against
 *     the pre-break snapshot confirmed an identical restore.
 *   - `toc-threshold` proven able to fail (Plan 03): replacing the sole `headings.length >= 3`
 *     comparison in `src/web/viewer/ViewerDoc.tsx` with the unreachable `headings.length >= 999`,
 *     rebuilding, and re-running the same check against the 5+ heading fixture and a real headless
 *     Chrome produced, verbatim:
 *     `toc-threshold: expected the TOC sidebar to render for the 5+ heading fixture, but ".viewer-toc" was absent within 15000ms`
 *     The 2-heading fixture leg stayed quiet (no TOC either side of the threshold change). The
 *     RESTORE leg re-ran clean after the captured bytes were restored, and a byte-diff against the
 *     pre-break snapshot confirmed an identical restore.
 *   - `relative-link-navigation` proven able to fail (Plan 04): replacing the sole dirname-slice
 *     expression in `src/web/viewer/ViewerDoc.tsx`'s `resolveRelativeMd` with an empty string,
 *     rebuilding, and re-running the same check against a real headless Chrome produced, verbatim:
 *     `relative-link-navigation: expected the content root to contain b.md's sentinel text after the click, it did not`
 *     `relative-link-navigation: expected document.title "b.md" after the click, observed "a.md"`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and
 *     `git diff --quiet src/` confirmed a byte-identical restore.
 *   - `anchor-jump` proven able to fail (Plan 04): prefixing the fragment-jump effect's sole
 *     `document.getElementById(fragment)` lookup in `src/web/viewer-main.tsx` with an impossible
 *     sentinel, rebuilding, and re-running the same check against a real headless Chrome produced,
 *     verbatim:
 *     `anchor-jump: the #later-heading-in-a deep link never scrolled the heading into the viewport's upper band within 15000ms (window.scrollY=0)`
 *     `anchor-jump: clicking the "#conclusion" TOC entry never updated location.hash and scrolled it into the viewport's upper band within 15000ms (location.hash="#conclusion")`
 *     Both legs tripped: a same-document `#fragment` anchor click fires `popstate` per spec, so
 *     the TOC-click leg is driven by this SAME effect, not an independent native scroll (verified
 *     live during this plan's execution). The RESTORE leg re-ran clean after the captured bytes
 *     were restored, and `git diff --quiet src/` confirmed a byte-identical restore.
 *   - `md-link-opens-viewer` proven able to fail (Plan 04): replacing the `.md` alternative in the
 *     `.md|markdown` extension regex in `src/web/terminal-main.ts`'s `markdownFilePath` with an
 *     unmatchable token, rebuilding, and re-running the same check against a real tmux/ttyd/Chrome
 *     rig replaying the captured OSC-8 byte shape produced, verbatim (after CR-01's scheme
 *     allowlist, the unrecognized `.md` link is a blocked `file://` scheme, so it never navigates):
 *     `md-link-opens-viewer: meta-clicking the markdown link never recorded a window.open call within 15000ms`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and
 *     `git diff --quiet src/` confirmed a byte-identical restore. No tmux server, ttyd, Chrome, or
 *     listener on 47886/9382 remained after the run.
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
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants, sandbox/boot helper set. Ported from panel-111.mjs, renamed for
// this phase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

const SANDBOX_PORT = 47886;
const CDP_PORT = 9382;
const SANDBOX_PREFIX = "dispatch-panel-112-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const ERROR_POLL_TIMEOUT_MS = 15_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-112-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. The
 * verdict is raised OUTSIDE the try so only connection failure (nothing listening, the safe
 * case) can be swallowed; any other error after a successful fetch still trips the guard. */
async function assertNoLiveService() {
  let live = false;
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    live = true;
  } catch {
    // connection refused / reset / DNS: nothing is listening on 4700
  }
  if (live) {
    throw new Error(
      "PANEL-112-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
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
 * The break mutates a TypeScript source file and rebuilds; without this, `assertBuilt`'s memo
 * would skip that rebuild and the break would mutate dist without the source change ever
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
  // The sources are restored but dist/ was built from the sabotaged bytes; the user's launchd
  // service runs dist/ and `git diff` reports clean, so remove it rather than leave it live.
  try {
    rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
    console.error(
      "panel-112: removed dist/ (it may hold break-mutated output); run `npm run build`",
    );
  } catch {
    // best effort: a survivor dist/ still gets rebuilt by the next assertBuilt()
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
 * Returns `{ child, log }`; `log()` returns the accumulated stdout+stderr text observed so far. */
function bootServerAt(home, extraEnv = {}) {
  assertBuilt();
  const env = {
    ...process.env,
    ...extraEnv,
    HOME: home,
    NODE_ENV: "production",
  };
  const child = spawn("node", [realpathSync(DIST_ENTRY)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let acc = "";
  const append = (chunk) => {
    acc += chunk.toString("utf8");
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, log: () => acc };
}

/**
 * Boot the sandbox server and prove the child THIS run spawned is the process answering on
 * `SANDBOX_PORT`: `listenWithFallback` silently falls back to an OS-assigned port on EADDRINUSE,
 * so a stale server from an earlier run could otherwise satisfy `waitForReady` and every
 * assertion would target a server with the wrong HOME. Stops the child before rethrowing so a
 * failed boot never leaks a listener. `extraEnv` (task 3's `TMUX_TMPDIR`) is layered under
 * `HOME`/`NODE_ENV`, which always win, so a tmux-aware boot can never accidentally point at the
 * wrong sandbox home.
 */
async function bootAndWait(home, extraEnv = {}) {
  const boot = bootServerAt(home, extraEnv);
  try {
    await waitForReady(SANDBOX_PORT);
    const marker = `listening on http://127.0.0.1:${SANDBOX_PORT}`;
    const logDeadline = Date.now() + 2_000;
    while (!boot.log().includes(marker) && Date.now() < logDeadline) {
      await sleep(POLL_INTERVAL_MS);
    }
    if (!boot.log().includes(marker)) {
      throw new Error(
        `panel-112: the booted child did not bind ${SANDBOX_PORT} (EADDRINUSE fallback or ` +
          `crash); refusing to assert against a server this run did not start.\n${boot.log()}`,
      );
    }
  } catch (err) {
    await stopServer(boot.child);
    throw err;
  }
  return boot;
}

function readFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  const value = argv[idx + 1];
  if (value == null || value.startsWith("-")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CDP: minimal raw-CDP-over-WebSocket client, ported verbatim from
// panel-110.mjs (lines 545-716: findChrome, the CDP class, connectCDP,
// waitForCdpUp, evalValue, evalAsyncValue, chromeUserDataDir, launchChrome).
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
    this.eventListeners = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const listeners = this.eventListeners.get(msg.method);
        if (listeners) {
          for (const fn of [...listeners]) fn(msg.params, msg.sessionId);
        }
      }
    });
  }

  /** Registers a listener for a CDP event, never for a command response (those resolve `send()`'s
   * own promise). Returns an unsubscribe function. */
  on(method, fn) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, new Set());
    }
    this.eventListeners.get(method).add(fn);
    return () => this.eventListeners.get(method)?.delete(fn);
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

/** Bounded poll of a synchronous expression against a live page session, ported from
 * panel-110.mjs. Returns the first truthy value observed, or `null` on timeout. */
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

/**
 * Real `Input.dispatchMouseEvent` press then release at `point`, panel-109.mjs's own
 * press/release recipe. `modifiers` follows the CDP bitmask (`4` is Meta/Cmd); the plan's clicks
 * (relative-link navigation, TOC anchors, terminal OSC-8 links) all need a GENUINE trusted click
 * so the override handlers under test run exactly as a real user's click would drive them, never
 * `element.click()`'s synthetic untrusted event.
 */
async function dispatchRealClick(cdp, sessionId, point, modifiers = 0) {
  // A leading mouseMoved matters for xterm's OSC-8 link provider, which computes a row's
  // hoverable link ranges lazily on hover; a press/release with no prior move can land on a link
  // whose range was never computed for this row.
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: point.x, y: point.y, modifiers },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers,
    },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers,
    },
    sessionId,
  );
}

// ---------------------------------------------------------------------------
// tmux/ttyd: minimal isolated rig for task 3's terminal-side check, ported
// from mobile-term-101.mjs's spawnTtyd (~line 835) and standup sequence
// (~lines 924-1039), trimmed to the plain-shell shape this check needs (no
// fixture claude binary, no pty-shim, no mouse-report modes).
// ---------------------------------------------------------------------------

/**
 * The tmux socket directory every tmux invocation in this section runs against, isolating this
 * harness's tmux server from the developer's real one exactly like mobile-term-101.mjs's
 * `SANDBOX_TMUX_TMPDIR`. Short and NOT `SANDBOX_PREFIX`-prefixed: the resulting socket path
 * (`<dir>/tmux-<uid>/default`) is bounded by a 104-byte `sun_path`.
 */
const TMUX_TMPDIR_112 = join(tmpdir(), `p112tmux-${process.pid}`);

/** Retained fingerprint key `adoptAndSweep` (adapters/ttyd.ts) looks for; must match
 * `TTYD_RUNTIME_REVISION_RETAINED_KEY`'s exact value verbatim. */
const TTYD_REVISION_RETAINED_KEY = "DISPATCH_TTYD_REVISION_7";

const PORT_PARSE_TIMEOUT_MS = 10_000;
const LISTEN_POLL_TIMEOUT_MS = 10_000;

/** The isolated tmux env, creating the socket directory on first use. */
function tmuxEnv112(extra = {}) {
  mkdirSync(TMUX_TMPDIR_112, { recursive: true, mode: 0o700 });
  return { ...process.env, TMUX_TMPDIR: TMUX_TMPDIR_112, ...extra };
}

function tmuxP112(args) {
  return execFileP("tmux", args, { env: tmuxEnv112() });
}

/** Plain shell pane, no fixture binary: this check `send-keys`'s a real `printf` command to emit
 * the captured OSC-8 byte shape, so the pane never needs to run anything but a default shell. */
async function tmuxNewSession112(name, cwd) {
  await tmuxP112([
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    cwd,
    "-x",
    "200",
    "-y",
    "50",
  ]);
}

async function tmuxListSessionNames112() {
  try {
    const { stdout } = await tmuxP112([
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Plain-text screen contents (no escape sequences), one entry per visible row, tolerant of a
 * dead/absent tmux server (empty array). */
async function tmuxCapturePane112(name) {
  try {
    const { stdout } = await tmuxP112([
      "capture-pane",
      "-p",
      "-t",
      `=${name}:`,
    ]);
    return stdout.split("\n");
  } catch {
    return [];
  }
}

/** `#{pane_width} #{pane_height}`, the pty's CURRENT geometry (post-resize, once ttyd's WS
 * handshake has synced it to the browser's own negotiated cols/rows via `term.onResize`). */
async function tmuxPaneSize112(name) {
  const { stdout } = await tmuxP112([
    "display-message",
    "-p",
    "-t",
    `=${name}:`,
    "#{pane_width} #{pane_height}",
  ]);
  const [cols, rows] = stdout.trim().split(" ").map(Number);
  return { cols, rows };
}

/** Real ttyd against `session`, keyed by `sessionId`, production's exact argv shape
 * (adapters/ttyd.ts's own `spawnTtyd`) so `adoptAndSweep`'s fingerprint match succeeds. Reused
 * verbatim in shape from mobile-term-101.mjs. */
function spawnTtyd112(session, sessionId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ttyd",
      [
        "-W",
        "-i",
        "127.0.0.1",
        "-p",
        "0",
        "-b",
        `/sessions/${sessionId}/terminal`,
        "-T",
        "tmux-256color",
        "-t",
        "disableLeaveAlert=true",
        "-t",
        `${TTYD_REVISION_RETAINED_KEY}=1`,
        "tmux",
        "-u",
        "attach",
        "-t",
        `=${session}`,
      ],
      {
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: tmuxEnv112(),
      },
    );
    let buf = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `ttyd port not reported within ${PORT_PARSE_TIMEOUT_MS}ms for ${session}`,
        ),
      );
    }, PORT_PARSE_TIMEOUT_MS);
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/Listening on port:\s*(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stderr?.off("data", onData);
        child.unref();
        resolve({ child, port: Number(m[1]) });
      }
    };
    child.stderr?.on("data", onData);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`ttyd exited early (code ${code}) for ${session}: ${buf}`),
      );
    });
  });
}

async function waitForPortListening112(
  port,
  timeoutMs = LISTEN_POLL_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `port ${port} never reported LISTENING via lsof within ${timeoutMs}ms`,
  );
}

/** Insert one card + session row directly via node:sqlite (migration-diff-v3.mjs /
 * mobile-term-101.mjs idiom): `board.db`'s schema only exists after a real boot has run its
 * migrations once, which the check's warmup-boot-then-kill step provides. */
function seedFixtureSession112(home, card) {
  const dbPath = join(home, ".dispatch", "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    ).run(card.id, JSON.stringify(card));
    const metaRow = db.prepare("SELECT data FROM meta WHERE id = 0").get();
    const meta = metaRow ? JSON.parse(metaRow.data) : {};
    meta.schemaVersion = 1;
    db.prepare(
      `INSERT INTO meta (id, data) VALUES (0, @data)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    ).run({ data: JSON.stringify(meta) });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

/** Kill the ttyd child, the isolated tmux session + server, and remove the tmux socket
 * directory. Best-effort: a check's own `finally` calls this alongside the existing
 * `stopServer`/`cleanupSandboxHome` teardown, never in place of it. */
async function tearDownTmux112(tmuxName, ttydChild) {
  if (ttydChild) {
    try {
      process.kill(ttydChild.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  await tmuxP112(["kill-session", "-t", `=${tmuxName}:`]).catch(() => {});
  await tmuxP112(["kill-server"]).catch(() => {});
  rmSync(TMUX_TMPDIR_112, { recursive: true, force: true });
}

/**
 * Installed via `Page.addScriptToEvaluateOnNewDocument` (109-04 precedent): stubs `window.open`
 * to return a fake window whose `location.href` setter records every assignment into a
 * page-global array, and whose `opener` property is a plain, null-able field, so the terminal's
 * opener-nulling reroute is observable without a real second browser target
 * (`Target.setDiscoverTargets` remains the alternative per 112-RESEARCH.md assumption A4, if this
 * stub ever proves insufficient).
 */
const WINDOW_OPEN_STUB_INIT_SCRIPT = `
(() => {
  window.__panel112Opens = [];
  window.open = function () {
    var location = {};
    Object.defineProperty(location, "href", {
      set: function (v) { window.__panel112Opens.push(String(v)); },
      get: function () { return ""; },
    });
    return { opener: {}, location: location };
  };
})();
`;

/** Same shape as `openPage`, but navigates from `about:blank` so `initScript` installs BEFORE
 * the real navigation (panel-109.mjs's `seedPage` precedent). */
async function openTerminalPage(cdp, { url, initScript }) {
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
  });
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
  if (initScript) {
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: initScript },
      sessionId,
    );
  }
  await cdp.send("Page.navigate", { url }, sessionId);
  return { targetId, sessionId };
}

/**
 * Builds the shell command TEXT that, when typed and executed in a pane, prints the exact
 * captured OSC-8 byte shape (112-RESEARCH.md Code Examples' `osc8Link` helper) for `absPath`,
 * with the visible link text (its basename) alone on its own output line so the harness can find
 * it in `tmux capture-pane -p` without any escape-sequence parsing.
 *
 * @remarks `uriOverride` swaps the emitted OSC-8 target while keeping the basename label, so the
 * control leg can plant a `javascript:`-scheme link (the CR-01 XSS vector) without a matching file.
 */
function buildOsc8Command(absPath, uriOverride = null) {
  const esc = "\\033";
  const st = esc + "\\\\";
  const uri = uriOverride ?? `file://${encodeURI(absPath)}`;
  const label = absPath.split("/").pop();
  const fmt = `${esc}]8;id=t112;%s${st}%s${esc}]8;;${st}\\n`;
  const shQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `printf ${shQuote(fmt)} ${shQuote(uri)} ${shQuote(label)}`;
}

// ---------------------------------------------------------------------------
// Fixture set. Stable across this phase: plans 03-04 reuse every file written
// here. Scroll-height and sentinel constraints exist for plan 04's scroll and
// navigation legs and must not be trimmed.
// ---------------------------------------------------------------------------

const OVERSIZED_BYTES = 2 * 1024 * 1024 + 64;
const B_SENTINEL = "PANEL-112-B-SENTINEL";

const FILLER_SENTENCE =
  "Filler content for panel-112 scroll-height fixtures: this paragraph exists purely to add " +
  "vertical height so viewport-relative scroll assertions in later plans have real distance to " +
  "measure, not to be read for meaning.";

/** `count` short paragraphs, each long enough to wrap across several lines at the viewer's body
 * width, so `count` paragraphs reliably clear one 1000px viewport (empirically ~15 paragraphs). */
function fillerParagraphs(count) {
  return Array.from(
    { length: count },
    (_, i) => `${FILLER_SENTENCE} (paragraph ${i + 1})`,
  ).join("\n\n");
}

/**
 * Writes the phase's stable fixture set under `home/workspaces` (the sandbox's sole configured
 * root, the same directory the allowed-roots derivation in `viewer.route.ts` serves).
 *
 * @remarks Three fixtures carry constraints plan 04's scroll and navigation legs depend on:
 * `a.md` places its second heading below at least one viewport of filler text (the deep-link
 * leg's `window.scrollY > 0` assertion), `b.md` carries the `PANEL-112-B-SENTINEL` line the
 * navigation leg greps for, and `headings.md` carries enough body per section that the page
 * scrolls (the TOC-click leg's upper-band scroll assertion). Do not trim any of these.
 */
function writeFixtures(home) {
  const workspaces = join(home, "workspaces");
  mkdirSync(workspaces, { recursive: true });

  writeFileSync(
    join(workspaces, "draft notes (v2).md"),
    "# Draft Notes (v2)\n\nA space in the filename, the captured real-world shape.\n",
    "utf8",
  );

  // 5+ headings, one duplicated ("Introduction" twice, GitHub-style id suffixing), one with
  // inline bold markup ("**Bold** Heading"), generous filler per section so the page scrolls.
  const headingSections = [
    "Introduction",
    "Getting Started",
    "Introduction",
    "**Bold** Heading",
    "Advanced Topics",
    "Conclusion",
  ];
  writeFileSync(
    join(workspaces, "headings.md"),
    headingSections
      .map((h) => `## ${h}\n\n${fillerParagraphs(10)}`)
      .join("\n\n") + "\n",
    "utf8",
  );

  writeFileSync(
    join(workspaces, "two-headings.md"),
    "## First\n\nFirst section body.\n\n## Second\n\nSecond section body.\n",
    "utf8",
  );

  writeFileSync(
    join(workspaces, "raw-html.md"),
    [
      "# Raw HTML Fixture",
      "",
      "<script>window.__panel112XssFired = true;</script>",
      "",
      '<img src="x" onerror="window.__panel112ImgOnerrorFired = true">',
      "",
      '<div class="raw-html-block">Inline HTML block</div>',
      "",
      "![Markdown image](https://example.com/panel-112-fixture.png)",
      "",
      "[js scheme link](javascript:window.__panel112XssFired = true)",
      "",
      "![js scheme image](javascript:window.__panel112XssFired = true)",
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(workspaces, "code-fences.md"),
    [
      "# Code Fences",
      "",
      "```panel112-unknown-lang",
      'puts "unknown fence language, no highlight.js grammar registered"',
      "```",
      "",
      "```ts",
      "const x: number = 1;",
      "```",
      "",
      "Inline code example: `const inline = true;`",
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(workspaces, "oversized.md"),
    Buffer.alloc(OVERSIZED_BYTES, "a"),
  );

  writeFileSync(
    join(workspaces, "a.md"),
    [
      "# A",
      "",
      "[Link to B](./b.md)",
      "",
      "[Link to B heading](./b.md#some-heading)",
      "",
      fillerParagraphs(20),
      "",
      "## Later Heading In A",
      "",
      // Enough trailing filler that scrollIntoView({block:"start"}) has room to align the
      // heading near the viewport's top rather than clamping at the document's natural bottom.
      fillerParagraphs(20),
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(workspaces, "b.md"),
    [
      "# B",
      "",
      B_SENTINEL,
      "",
      fillerParagraphs(3),
      "",
      "## Some Heading",
      "",
      "Content under Some Heading.",
      "",
    ].join("\n"),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// viewer-page-served: fetch-level (no Chrome). GET /viewer/ serves the built
// page with the right headers, its hashed asset resolves, and the bare
// /viewer?path= form 302-redirects to the trailing-slash form.
// ---------------------------------------------------------------------------

/**
 * Fetch-only check, no Chrome: a booted sandbox server must serve `/viewer/` with the built
 * `viewer.html`, its hashed `./assets/` script must resolve under `/viewer/assets/...`, and the
 * bare `/viewer?path=` form must 302 to the trailing-slash form with the query preserved.
 */
async function checkViewerPageServed(violations) {
  assertBuilt();
  const home = makeSandboxHome("viewer-page-served");
  let boot;
  try {
    writeFixtures(home);
    boot = await bootAndWait(home);

    const base = `http://127.0.0.1:${SANDBOX_PORT}`;

    const pageRes = await fetch(`${base}/viewer/`);
    const pageBody = await pageRes.text();
    if (pageRes.status !== 200) {
      violations.push(
        `viewer-page-served: expected 200 for GET /viewer/, observed ${pageRes.status}`,
      );
    }
    const contentType = pageRes.headers.get("content-type");
    if (typeof contentType !== "string" || !contentType.includes("text/html")) {
      violations.push(
        `viewer-page-served: expected content-type to include "text/html" for GET /viewer/, ` +
          `observed ${JSON.stringify(contentType)}`,
      );
    }
    const cacheControl = pageRes.headers.get("cache-control");
    if (cacheControl !== "no-cache") {
      violations.push(
        `viewer-page-served: expected cache-control "no-cache" for GET /viewer/, observed ` +
          `${JSON.stringify(cacheControl)}`,
      );
    }

    const scriptMatch = pageBody.match(
      /<script[^>]+src="\.?\/?assets\/([^"]+)"/,
    );
    if (!scriptMatch) {
      violations.push(
        `viewer-page-served: could not find a ./assets/ script src in the served viewer.html body`,
      );
    } else {
      const assetRes = await fetch(`${base}/viewer/assets/${scriptMatch[1]}`);
      await assetRes.body?.cancel().catch(() => {});
      if (assetRes.status !== 200) {
        violations.push(
          `viewer-page-served: expected 200 for the hashed asset /viewer/assets/${scriptMatch[1]}, ` +
            `observed ${assetRes.status}`,
        );
      }
    }

    const redirectRes = await fetch(`${base}/viewer?path=x`, {
      redirect: "manual",
    });
    await redirectRes.body?.cancel().catch(() => {});
    if (redirectRes.status !== 302) {
      violations.push(
        `viewer-page-served: expected 302 for GET /viewer?path=x, observed ${redirectRes.status}`,
      );
    }
    const location = redirectRes.headers.get("location");
    if (location !== "/viewer/?path=x") {
      violations.push(
        `viewer-page-served: expected Location "/viewer/?path=x", observed ${JSON.stringify(location)}`,
      );
    }
  } finally {
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const VIEWER_PAGE_ROUTE_PATH = join(
  REPO_ROOT,
  "src/server/routes/viewer-page.route.ts",
);
const VIEWER_HTML_BREAK_TARGET = '"viewer.html"';
const VIEWER_HTML_BREAK_REPLACEMENT = '"viewer-missing.html"';

/** Shared break-`finally` restore for `viewer-page.route.ts`: source bytes back, build memo
 * reset, dist/ removed so a throw in the trip leg never leaves a dist/ compiled from the sabotage
 * bytes behind a clean `git diff`. */
function restoreViewerPageRouteSource(original) {
  writeFileSync(VIEWER_PAGE_ROUTE_PATH, original);
  resetBuildCache();
  rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
  unregisterRestore(VIEWER_PAGE_ROUTE_PATH);
}

/** `--break viewer-page-served`: replaces the sole `"viewer.html"` literal with
 * `"viewer-missing.html"`, rebuilds, and requires the SAME check to report the GET /viewer/
 * not-200 violation (sendFile falls through express's default error handler for the missing
 * file). Restores the captured bytes unconditionally in a `finally`, rebuilds, and requires a
 * clean pass. */
async function runBreakViewerPageServed() {
  assertBuilt();
  const original = readFileSync(VIEWER_PAGE_ROUTE_PATH, "utf8");
  const occurrences = original.split(VIEWER_HTML_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel112: refusing to run --break viewer-page-served, expected ` +
        `${JSON.stringify(VIEWER_HTML_BREAK_TARGET)} to occur exactly once in ` +
        `${VIEWER_PAGE_ROUTE_PATH}, measured ${occurrences}. A miscounted anchor would mutate the ` +
        `wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_PAGE_ROUTE_PATH, original);
  try {
    writeFileSync(
      VIEWER_PAGE_ROUTE_PATH,
      original.replace(VIEWER_HTML_BREAK_TARGET, VIEWER_HTML_BREAK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkViewerPageServed(tripViolations);
    console.log(
      `\n--break viewer-page-served TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("expected 200 for GET /viewer/"),
    );
  } finally {
    restoreViewerPageRouteSource(original);
  }

  const restoreViolations = [];
  await checkViewerPageServed(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break viewer-page-served RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// error-states: real headless Chrome, the UI-SPEC error copy renders exactly
// for a nonexistent .md and for the >2MB fixture.
// ---------------------------------------------------------------------------

/**
 * Real headless Chrome via CDP: a nonexistent `.md` under the workspace root must render the
 * exact "File not found" copy, and the `>2MB` fixture must render the exact "File too large to
 * preview" copy. Each leg polls with a bounded timeout for the lazy render.
 */
async function checkErrorStates(violations) {
  assertBuilt();
  const home = makeSandboxHome("error-states");
  let boot;
  let chrome;
  let cdp;
  try {
    writeFixtures(home);
    boot = await bootAndWait(home);

    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const workspaces = join(home, "workspaces");
    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;

    const bodyTextExpr = (needles) =>
      `(function(){var t=document.body.textContent||""; return (${needles
        .map((n) => `t.includes(${JSON.stringify(n)})`)
        .join(" && ")}) ? t : null;})()`;

    // Leg 1: a nonexistent .md under the workspace root renders the exact "File not found" copy.
    const missingPath = join(workspaces, "does-not-exist.md");
    const missingPage = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(missingPath)}`,
    });
    const notFoundBody = await pollUntilTruthy(
      cdp,
      missingPage.sessionId,
      bodyTextExpr([
        "File not found",
        "This file doesn't exist or is outside your registered workspaces.",
      ]),
      ERROR_POLL_TIMEOUT_MS,
    );
    if (notFoundBody == null) {
      violations.push(
        `error-states: a nonexistent .md never rendered the exact "File not found" copy within ` +
          `${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    }
    await cdp.send("Target.closeTarget", { targetId: missingPage.targetId });

    // Leg 2: the >2MB fixture renders the exact "File too large to preview" copy.
    const oversizedPath = join(workspaces, "oversized.md");
    const oversizedPage = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(oversizedPath)}`,
    });
    const tooLargeBody = await pollUntilTruthy(
      cdp,
      oversizedPage.sessionId,
      bodyTextExpr([
        "File too large to preview",
        "This file is over the 2 MB viewer limit. Open it in your editor instead.",
      ]),
      ERROR_POLL_TIMEOUT_MS,
    );
    if (tooLargeBody == null) {
      violations.push(
        `error-states: the >2MB fixture never rendered the exact "File too large to preview" ` +
          `copy within ${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    }
    await cdp.send("Target.closeTarget", { targetId: oversizedPage.targetId });
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const VIEWER_MAIN_PATH = join(REPO_ROOT, "src/web/viewer-main.tsx");
const STATUS_413_TARGET = "res.status === 413";
const STATUS_413_REPLACEMENT = "res.status === 999413";

/** Shared break-`finally` restore for `viewer-main.tsx`: source bytes back, build memo reset,
 * dist/ removed. */
function restoreViewerMainSource(original) {
  writeFileSync(VIEWER_MAIN_PATH, original);
  resetBuildCache();
  rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
  unregisterRestore(VIEWER_MAIN_PATH);
}

/** `--break error-states`: replaces the sole `res.status === 413` comparison with the unreachable
 * `res.status === 999413` (panel-110-05's minimal mutation precedent), rebuilds, and requires the
 * SAME check to report the too-large-copy-never-rendered violation (the real 413 response now
 * falls through to the fetch-failure state instead of the too-large state). Restores the captured
 * bytes unconditionally in a `finally`, rebuilds, and requires a clean pass. */
async function runBreakErrorStates() {
  assertBuilt();
  const original = readFileSync(VIEWER_MAIN_PATH, "utf8");
  const occurrences = original.split(STATUS_413_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel112: refusing to run --break error-states, expected ` +
        `${JSON.stringify(STATUS_413_TARGET)} to occur exactly once in ${VIEWER_MAIN_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_MAIN_PATH, original);
  try {
    writeFileSync(
      VIEWER_MAIN_PATH,
      original.replace(STATUS_413_TARGET, STATUS_413_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkErrorStates(tripViolations);
    console.log(
      `\n--break error-states TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("File too large to preview"),
    );
  } finally {
    restoreViewerMainSource(original);
  }

  const restoreViolations = [];
  await checkErrorStates(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break error-states RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

const VIEWER_DOC_PATH = join(REPO_ROOT, "src/web/viewer/ViewerDoc.tsx");

/** Shared break-`finally` restore for `ViewerDoc.tsx`: source bytes back, build memo reset,
 * dist/ removed. Every break in this file that mutates `ViewerDoc.tsx` shares this restore so the
 * three anchors (img override, rehypeHighlight entry, TOC threshold) can never drift into
 * three slightly different restore paths. */
function restoreViewerDocSource(original) {
  writeFileSync(VIEWER_DOC_PATH, original);
  resetBuildCache();
  rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
  unregisterRestore(VIEWER_DOC_PATH);
}

/** Registers a listener for `console.error` calls and uncaught exceptions on a CDP connection.
 * Must be called BEFORE `openPage` navigates, since `Target.createTarget` navigates as part of
 * target creation. Returns an unsubscribe function. */
function watchConsoleErrors(cdp, errors) {
  const offConsole = cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") {
      errors.push(
        (params.args ?? [])
          .map((a) => a.value ?? a.description ?? "")
          .join(" "),
      );
    }
  });
  const offException = cdp.on("Runtime.exceptionThrown", (params) => {
    errors.push(
      params.exceptionDetails?.exception?.description ??
        params.exceptionDetails?.text ??
        "uncaught exception",
    );
  });
  return () => {
    offConsole();
    offException();
  };
}

// ---------------------------------------------------------------------------
// no-raw-html-injection: real headless Chrome, the raw-HTML fixture (a script
// tag, an onerror-bearing img tag, an HTML block, and a markdown-syntax
// image) never executes or renders as raw DOM inside the content root.
// ---------------------------------------------------------------------------

/**
 * Real headless Chrome via CDP: the raw-HTML fixture is the attack payload. Zero script elements
 * and zero img elements render inside the content root, its markdown-syntax image renders as an
 * anchor with a `noopener` rel, no element document-wide carries an `onerror` attribute (the
 * payload never became a live DOM attribute), and no console errors fire.
 */
async function checkNoRawHtmlInjection(violations) {
  assertBuilt();
  const home = makeSandboxHome("no-raw-html-injection");
  let boot;
  let chrome;
  let cdp;
  try {
    writeFixtures(home);
    boot = await bootAndWait(home);
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const consoleErrors = [];
    const unwatch = watchConsoleErrors(cdp, consoleErrors);

    const workspaces = join(home, "workspaces");
    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;
    const rawHtmlPath = join(workspaces, "raw-html.md");
    const page = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(rawHtmlPath)}`,
    });

    const contentReady = await pollUntilTruthy(
      cdp,
      page.sessionId,
      `(function(){var el=document.querySelector(".viewer-content"); return el && el.textContent.includes("Raw HTML Fixture") ? true : null;})()`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (contentReady == null) {
      violations.push(
        `no-raw-html-injection: the raw-HTML fixture's content root never rendered within ${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    }

    const scriptCount = await evalValue(
      cdp,
      page.sessionId,
      `document.querySelectorAll(".viewer-content script").length`,
    );
    if (scriptCount !== 0) {
      violations.push(
        `no-raw-html-injection: expected 0 script elements inside the content root, observed ${scriptCount}`,
      );
    }

    const imgCount = await evalValue(
      cdp,
      page.sessionId,
      `document.querySelectorAll(".viewer-content img").length`,
    );
    if (imgCount !== 0) {
      violations.push(
        `no-raw-html-injection: expected 0 img elements inside the content root, observed ${imgCount}`,
      );
    }

    const imageAnchorRel = await evalValue(
      cdp,
      page.sessionId,
      `(function(){
        var anchors = Array.from(document.querySelectorAll(".viewer-content a"));
        var found = anchors.find(function(a){
          return a.getAttribute("href") === "https://example.com/panel-112-fixture.png";
        });
        return found ? found.getAttribute("rel") : null;
      })()`,
    );
    if (
      typeof imageAnchorRel !== "string" ||
      !imageAnchorRel.includes("noopener")
    ) {
      violations.push(
        `no-raw-html-injection: expected the markdown image's anchor rel to include "noopener", ` +
          `observed ${JSON.stringify(imageAnchorRel)}`,
      );
    }

    const onerrorCount = await evalValue(
      cdp,
      page.sessionId,
      `document.querySelectorAll("[onerror]").length`,
    );
    if (onerrorCount !== 0) {
      violations.push(
        `no-raw-html-injection: expected 0 elements with an [onerror] attribute document-wide, ` +
          `observed ${onerrorCount}`,
      );
    }

    const jsSchemeSurvived = await evalValue(
      cdp,
      page.sessionId,
      `(function(){
        var nodes = Array.from(document.querySelectorAll(".viewer-content a, .viewer-content img"));
        return nodes.some(function(n){
          var v = ((n.getAttribute("href") || n.getAttribute("src") || "")).trim().toLowerCase();
          return v.indexOf("javascript:") === 0;
        });
      })()`,
    );
    if (jsSchemeSurvived === true) {
      violations.push(
        `no-raw-html-injection: a javascript:-scheme URL survived into a rendered href/src ` +
          `(defaultUrlTransform regression)`,
      );
    }

    const xssFired = await evalValue(
      cdp,
      page.sessionId,
      `window.__panel112XssFired === true`,
    );
    if (xssFired === true) {
      violations.push(
        `no-raw-html-injection: the raw-HTML <script> executed (window.__panel112XssFired === true)`,
      );
    }

    const imgOnerrorFired = await evalValue(
      cdp,
      page.sessionId,
      `window.__panel112ImgOnerrorFired === true`,
    );
    if (imgOnerrorFired === true) {
      violations.push(
        `no-raw-html-injection: the raw-HTML <img onerror> fired (window.__panel112ImgOnerrorFired === true)`,
      );
    }

    // Give any deferred console activity from the initial render a moment to land.
    await sleep(200);
    if (consoleErrors.length > 0) {
      violations.push(
        `no-raw-html-injection: expected no console errors, observed: ${consoleErrors.join(" | ")}`,
      );
    }

    await cdp.send("Target.closeTarget", { targetId: page.targetId });
    unwatch();
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const IMG_OVERRIDE_TARGET = [
  "  img: ({ src, alt }) =>",
  '    typeof src === "string" && src !== "" ? (',
  "      <a",
  "        href={src}",
  '        target="_blank"',
  '        rel="noopener noreferrer"',
  "        style={anchorStyle}",
  "      >",
  '        {alt != null && alt !== "" ? alt : src}',
  "      </a>",
  "    ) : (",
  "      <>{alt}</>",
  "    ),",
].join("\n");
const IMG_OVERRIDE_REPLACEMENT =
  "  img: ({ src, alt }) => <img src={src} alt={alt} />,";

/** `--break no-raw-html-injection`: replaces the img override's anchor rendering with a native
 * `<img>` element passing `src` through unchanged, the exact regression MDV-03 forbids. Rebuilds,
 * and requires the SAME check to report the img-count violation. Restores the captured bytes
 * unconditionally in a `finally`, rebuilds, and requires a clean pass. */
async function runBreakNoRawHtmlInjection() {
  assertBuilt();
  const original = readFileSync(VIEWER_DOC_PATH, "utf8");
  const occurrences = original.split(IMG_OVERRIDE_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel112: refusing to run --break no-raw-html-injection, expected the img override block ` +
        `to occur exactly once in ${VIEWER_DOC_PATH}, measured ${occurrences}. A miscounted anchor ` +
        `would mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_DOC_PATH, original);
  try {
    writeFileSync(
      VIEWER_DOC_PATH,
      original.replace(IMG_OVERRIDE_TARGET, IMG_OVERRIDE_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkNoRawHtmlInjection(tripViolations);
    console.log(
      `\n--break no-raw-html-injection TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("expected 0 img elements inside the content root"),
    );
  } finally {
    restoreViewerDocSource(original);
  }

  const restoreViolations = [];
  await checkNoRawHtmlInjection(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break no-raw-html-injection RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// syntax-highlighting: real headless Chrome, a fenced ts block renders
// hljs-classed spans, an unknown-language fence renders plain with no page
// error, and the className-based inline/block code split (Pitfall 1) holds.
// ---------------------------------------------------------------------------

/**
 * Real headless Chrome via CDP: the ts fence highlights via hljs-classed spans, the
 * `panel112-unknown-lang` fence (no registered grammar) renders its text intact with zero hljs-
 * descendants and no console error (rehype-highlight v7's non-throwing skip), and at least one
 * inline code element (no pre ancestor) carries no hljs class.
 */
async function checkSyntaxHighlighting(violations) {
  assertBuilt();
  const home = makeSandboxHome("syntax-highlighting");
  let boot;
  let chrome;
  let cdp;
  try {
    writeFixtures(home);
    boot = await bootAndWait(home);
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const consoleErrors = [];
    const unwatch = watchConsoleErrors(cdp, consoleErrors);

    const workspaces = join(home, "workspaces");
    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;
    const codeFencesPath = join(workspaces, "code-fences.md");
    const page = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(codeFencesPath)}`,
    });

    const contentReady = await pollUntilTruthy(
      cdp,
      page.sessionId,
      `(function(){var el=document.querySelector(".viewer-content"); return el && el.textContent.includes("Code Fences") ? true : null;})()`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (contentReady == null) {
      violations.push(
        `syntax-highlighting: the code-fences fixture's content root never rendered within ${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    }

    const hljsHighlighted = await pollUntilTruthy(
      cdp,
      page.sessionId,
      `document.querySelectorAll("pre code [class*='hljs-']").length > 0 ? "yes" : null`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (hljsHighlighted == null) {
      violations.push(
        `syntax-highlighting: expected at least one "pre code [class*='hljs-']" element (the ts ` +
          `fence highlighted), found none`,
      );
    }

    const unknownFenceState = await evalValue(
      cdp,
      page.sessionId,
      `(function(){
        var blocks = Array.from(document.querySelectorAll(".viewer-content pre code"));
        var unknown = blocks.find(function(c){
          return (c.className || "").includes("panel112-unknown-lang");
        });
        if (!unknown) return { found: false, hljsCount: -1, text: "" };
        return {
          found: true,
          hljsCount: unknown.querySelectorAll("[class*='hljs-']").length,
          text: unknown.textContent,
        };
      })()`,
    );
    if (!unknownFenceState.found) {
      violations.push(
        `syntax-highlighting: could not find the "panel112-unknown-lang" fence's "pre code" element`,
      );
    } else {
      if (unknownFenceState.hljsCount !== 0) {
        violations.push(
          `syntax-highlighting: expected 0 hljs- descendants in the unknown-language fence, ` +
            `observed ${unknownFenceState.hljsCount}`,
        );
      }
      if (
        !unknownFenceState.text.includes(
          "unknown fence language, no highlight.js grammar registered",
        )
      ) {
        violations.push(
          `syntax-highlighting: expected the unknown-language fence's text content intact, ` +
            `observed ${JSON.stringify(unknownFenceState.text)}`,
        );
      }
    }

    const inlineCodeOk = await evalValue(
      cdp,
      page.sessionId,
      `(function(){
        var codes = Array.from(document.querySelectorAll(".viewer-content code"));
        return codes.some(function(c){
          return c.closest("pre") == null && !(c.className || "").includes("hljs");
        });
      })()`,
    );
    if (inlineCodeOk !== true) {
      violations.push(
        `syntax-highlighting: expected at least one inline code element with no hljs class and no ` +
          `pre ancestor`,
      );
    }

    await sleep(200);
    if (consoleErrors.length > 0) {
      violations.push(
        `syntax-highlighting: expected no console errors, observed: ${consoleErrors.join(" | ")}`,
      );
    }

    await cdp.send("Target.closeTarget", { targetId: page.targetId });
    unwatch();
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const REHYPE_HIGHLIGHT_ENTRY_TARGET = "[headingIdsPlugin, rehypeHighlight]";
const REHYPE_HIGHLIGHT_ENTRY_REPLACEMENT = "[headingIdsPlugin]";

/** `--break syntax-highlighting`: removes `rehypeHighlight` from the `rehypePlugins` array (the
 * import stays, this is a use-site removal, not an import removal; `vite build` does not lint).
 * Rebuilds, and requires the SAME check to report the missing-hljs violation. Restores the
 * captured bytes unconditionally in a `finally`, rebuilds, and requires a clean pass. */
async function runBreakSyntaxHighlighting() {
  assertBuilt();
  const original = readFileSync(VIEWER_DOC_PATH, "utf8");
  const occurrences = original.split(REHYPE_HIGHLIGHT_ENTRY_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel112: refusing to run --break syntax-highlighting, expected ` +
        `${JSON.stringify(REHYPE_HIGHLIGHT_ENTRY_TARGET)} to occur exactly once in ` +
        `${VIEWER_DOC_PATH}, measured ${occurrences}. A miscounted anchor would mutate the wrong ` +
        `spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_DOC_PATH, original);
  try {
    writeFileSync(
      VIEWER_DOC_PATH,
      original.replace(
        REHYPE_HIGHLIGHT_ENTRY_TARGET,
        REHYPE_HIGHLIGHT_ENTRY_REPLACEMENT,
      ),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkSyntaxHighlighting(tripViolations);
    console.log(
      `\n--break syntax-highlighting TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes(`expected at least one "pre code [class*='hljs-']" element`),
    );
  } finally {
    restoreViewerDocSource(original);
  }

  const restoreViolations = [];
  await checkSyntaxHighlighting(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break syntax-highlighting RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// toc-threshold: real headless Chrome, the 5+ heading fixture shows a TOC
// whose every entry id resolves to a real heading (including the
// duplicate-suffixed and inline-markup headings), and the 2-heading fixture
// shows no TOC (locked 3+ threshold).
// ---------------------------------------------------------------------------

/**
 * Real headless Chrome via CDP, two legs on one booted rig. Leg A (`headings.md`, 6 sections
 * including the duplicated "Introduction" and the inline-bold "**Bold** Heading"): the TOC
 * sidebar renders, its entry count equals the document's heading count, every entry's href
 * resolves to a real element id via `getElementById` (the drift-proof property, including the
 * duplicate's suffixed id). Leg B (`two-headings.md`, 2 headings): no TOC sidebar renders.
 */
async function checkTocThreshold(violations) {
  assertBuilt();
  const home = makeSandboxHome("toc-threshold");
  let boot;
  let chrome;
  let cdp;
  try {
    writeFixtures(home);
    boot = await bootAndWait(home);
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const workspaces = join(home, "workspaces");
    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;

    // Leg A: the 5+ heading fixture shows a TOC whose every entry id resolves to a real
    // heading, including the duplicate's suffixed id and the inline-markup heading's slug.
    const headingsPath = join(workspaces, "headings.md");
    const headingsPage = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(headingsPath)}`,
    });
    const headingsToc = await pollUntilTruthy(
      cdp,
      headingsPage.sessionId,
      `document.querySelector(".viewer-toc") != null ? "yes" : null`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (headingsToc == null) {
      violations.push(
        `toc-threshold: expected the TOC sidebar to render for the 5+ heading fixture, but ` +
          `".viewer-toc" was absent within ${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    } else {
      const legAState = await evalValue(
        cdp,
        headingsPage.sessionId,
        `(function(){
          var headingSelector = ".viewer-content h1, .viewer-content h2, .viewer-content h3, " +
            ".viewer-content h4, .viewer-content h5, .viewer-content h6";
          var headingCount = document.querySelectorAll(headingSelector).length;
          var entries = Array.from(document.querySelectorAll(".viewer-toc-entry"));
          var entryHrefs = entries.map(function(a){ return a.getAttribute("href"); });
          var unresolved = entryHrefs.filter(function(href){
            var id = (href || "").replace(/^#/, "");
            return id === "" || document.getElementById(id) == null;
          });
          return {
            headingCount: headingCount,
            entryCount: entries.length,
            entryHrefs: entryHrefs,
            unresolved: unresolved,
            hasDuplicateSuffix: entryHrefs.includes("#introduction-1"),
          };
        })()`,
      );
      if (legAState.entryCount !== legAState.headingCount) {
        violations.push(
          `toc-threshold: expected the TOC entry count (${legAState.entryCount}) to equal the ` +
            `document's heading count (${legAState.headingCount})`,
        );
      }
      if (legAState.unresolved.length > 0) {
        violations.push(
          `toc-threshold: TOC entries with hrefs that do not resolve via getElementById: ` +
            `${legAState.unresolved.join(", ")}`,
        );
      }
      if (!legAState.hasDuplicateSuffix) {
        violations.push(
          `toc-threshold: expected a TOC entry for the duplicate heading's suffixed id ` +
            `"#introduction-1", observed entries: ${legAState.entryHrefs.join(", ")}`,
        );
      }
    }
    await cdp.send("Target.closeTarget", { targetId: headingsPage.targetId });

    // Leg B: below the 3+ threshold, the 2-heading fixture shows no TOC sidebar.
    const twoHeadingsPath = join(workspaces, "two-headings.md");
    const twoHeadingsPage = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(twoHeadingsPath)}`,
    });
    const twoHeadingsReady = await pollUntilTruthy(
      cdp,
      twoHeadingsPage.sessionId,
      `(function(){var el=document.querySelector(".viewer-content"); return el && el.textContent.includes("First section body.") ? true : null;})()`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (twoHeadingsReady == null) {
      violations.push(
        `toc-threshold: the 2-heading fixture's content root never rendered within ${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    }
    const tocPresent = await evalValue(
      cdp,
      twoHeadingsPage.sessionId,
      `document.querySelector(".viewer-toc") != null`,
    );
    if (tocPresent) {
      violations.push(
        `toc-threshold: expected no TOC sidebar for the 2-heading fixture, but ".viewer-toc" was present`,
      );
    }
    await cdp.send("Target.closeTarget", {
      targetId: twoHeadingsPage.targetId,
    });
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const TOC_THRESHOLD_TARGET = "headings.length >= 3";
const TOC_THRESHOLD_REPLACEMENT = "headings.length >= 999";

/** `--break toc-threshold`: replaces the sole `>= 3` TOC threshold comparison with an
 * unreachable `>= 999`, rebuilds, and requires the SAME check to report leg A's TOC-absent
 * violation while leg B (already expecting no TOC) stays quiet. Restores the captured bytes
 * unconditionally in a `finally`, rebuilds, and requires a clean pass. */
async function runBreakTocThreshold() {
  assertBuilt();
  const original = readFileSync(VIEWER_DOC_PATH, "utf8");
  const occurrences = original.split(TOC_THRESHOLD_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel112: refusing to run --break toc-threshold, expected ` +
        `${JSON.stringify(TOC_THRESHOLD_TARGET)} to occur exactly once in ${VIEWER_DOC_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_DOC_PATH, original);
  try {
    writeFileSync(
      VIEWER_DOC_PATH,
      original.replace(TOC_THRESHOLD_TARGET, TOC_THRESHOLD_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkTocThreshold(tripViolations);
    console.log(
      `\n--break toc-threshold TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes(
        "expected the TOC sidebar to render for the 5+ heading fixture",
      ),
    );
  } finally {
    restoreViewerDocSource(original);
  }

  const restoreViolations = [];
  await checkTocThreshold(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break toc-threshold RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// relative-link-navigation: real headless Chrome, clicking a.md's ./b.md link
// resolves in-viewer (query + content + title), and the back button restores
// a.md via the popstate refetch leg.
// ---------------------------------------------------------------------------

/**
 * Real headless Chrome via CDP: a genuine `Input.dispatchMouseEvent` click on a.md's `./b.md`
 * anchor must update `location.search` to b.md's path, render b.md's sentinel text, and set
 * `document.title` to `b.md`, all without a full page load (`ViewerApp`'s `onNavigate`
 * `history.pushState` leg). `history.back()` must then revert all three via the `popstate`
 * refetch leg.
 */
async function checkRelativeLinkNavigation(violations) {
  assertBuilt();
  const home = makeSandboxHome("relative-link-navigation");
  let boot;
  let chrome;
  let cdp;
  try {
    writeFixtures(home);
    boot = await bootAndWait(home);
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const workspaces = join(home, "workspaces");
    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;
    const aPath = join(workspaces, "a.md");

    const page = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(aPath)}`,
    });
    const linkRect = await pollUntilTruthy(
      cdp,
      page.sessionId,
      `(function(){
        var a = document.querySelector('.viewer-content a[href="./b.md"]');
        if (!a) return null;
        var r = a.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (linkRect == null) {
      violations.push(
        `relative-link-navigation: the "./b.md" anchor never rendered in a.md's content root ` +
          `within ${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    } else {
      // Real CDP mouse press/release, not element.click(): the override's onClick handler must
      // run under a genuine trusted event, matching what a real user's click dispatches.
      await dispatchRealClick(cdp, page.sessionId, linkRect);

      const forwardReady = await pollUntilTruthy(
        cdp,
        page.sessionId,
        `location.search.indexOf("b.md") >= 0 ? "yes" : null`,
        ERROR_POLL_TIMEOUT_MS,
      );
      if (forwardReady == null) {
        violations.push(
          `relative-link-navigation: clicking "./b.md" never updated location.search to a b.md ` +
            `path within ${ERROR_POLL_TIMEOUT_MS}ms`,
        );
      }
      const forwardState = await evalValue(
        cdp,
        page.sessionId,
        `(function(){
          return {
            search: location.search,
            hasSentinel: document.body.textContent.includes(${JSON.stringify(B_SENTINEL)}),
            title: document.title,
          };
        })()`,
      );
      if (!/[?&]path=.*b\.md$/.test(decodeURIComponent(forwardState.search))) {
        violations.push(
          `relative-link-navigation: expected location.search's decoded path to end with b.md, ` +
            `observed ${JSON.stringify(forwardState.search)}`,
        );
      }
      if (!forwardState.hasSentinel) {
        violations.push(
          `relative-link-navigation: expected the content root to contain b.md's sentinel text ` +
            `after the click, it did not`,
        );
      }
      if (forwardState.title !== "b.md") {
        violations.push(
          `relative-link-navigation: expected document.title "b.md" after the click, observed ` +
            `${JSON.stringify(forwardState.title)}`,
        );
      }

      await evalValue(cdp, page.sessionId, `history.back()`);
      const backReady = await pollUntilTruthy(
        cdp,
        page.sessionId,
        `location.search.indexOf("a.md") >= 0 ? "yes" : null`,
        ERROR_POLL_TIMEOUT_MS,
      );
      if (backReady == null) {
        violations.push(
          `relative-link-navigation: history.back() never restored a.md's path within ` +
            `${ERROR_POLL_TIMEOUT_MS}ms`,
        );
      }
      const backState = await evalValue(
        cdp,
        page.sessionId,
        `(function(){
          return {
            search: location.search,
            hasLinkText: document.body.textContent.includes("Link to B"),
            title: document.title,
          };
        })()`,
      );
      if (!/[?&]path=.*a\.md$/.test(decodeURIComponent(backState.search))) {
        violations.push(
          `relative-link-navigation: expected location.search's decoded path to end with a.md ` +
            `after history.back(), observed ${JSON.stringify(backState.search)}`,
        );
      }
      if (!backState.hasLinkText) {
        violations.push(
          `relative-link-navigation: expected a.md's own content back in the content root after ` +
            `history.back(), it was not`,
        );
      }
      if (backState.title !== "a.md") {
        violations.push(
          `relative-link-navigation: expected document.title "a.md" after history.back(), ` +
            `observed ${JSON.stringify(backState.title)}`,
        );
      }
    }
    await cdp.send("Target.closeTarget", { targetId: page.targetId });
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const RELATIVE_LINK_TARGET =
  'currentPath.slice(0, currentPath.lastIndexOf("/") + 1)';
const RELATIVE_LINK_REPLACEMENT = '""';

/** `--break relative-link-navigation`: replaces the resolver's sole dirname-slice expression with
 * an empty string, so `./b.md` resolves against the filesystem root instead of a.md's own
 * directory, rebuilds, and requires the SAME check to report the b.md-sentinel-missing violation
 * (the resolved path 404s, so the click never actually reaches b.md). Restores the captured bytes
 * unconditionally in a `finally`, rebuilds, and requires a clean pass. */
async function runBreakRelativeLinkNavigation() {
  assertBuilt();
  const original = readFileSync(VIEWER_DOC_PATH, "utf8");
  const occurrences = original.split(RELATIVE_LINK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel112: refusing to run --break relative-link-navigation, expected ` +
        `${JSON.stringify(RELATIVE_LINK_TARGET)} to occur exactly once in ${VIEWER_DOC_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_DOC_PATH, original);
  try {
    writeFileSync(
      VIEWER_DOC_PATH,
      original.replace(RELATIVE_LINK_TARGET, RELATIVE_LINK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkRelativeLinkNavigation(tripViolations);
    console.log(
      `\n--break relative-link-navigation TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) => v.includes("sentinel"));
  } finally {
    restoreViewerDocSource(original);
  }

  const restoreViolations = [];
  await checkRelativeLinkNavigation(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break relative-link-navigation RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// anchor-jump: real headless Chrome, a #fragment deep link jumps after the
// lazy chunk renders (Pitfall 7), and a TOC click jumps + updates the hash.
// ---------------------------------------------------------------------------

/**
 * Real headless Chrome via CDP: loading a.md directly at a `#fragment` for its later heading must
 * scroll past the top of the page (`window.scrollY > 0`) with the target heading's bounding rect
 * sitting in the viewport's upper band, proving the jump ran AFTER the lazy `ViewerDoc` chunk
 * rendered (Pitfall 7), not before. A TOC click on the 5+ heading fixture must update
 * `location.hash` and scroll the same way.
 */
async function checkAnchorJump(violations) {
  assertBuilt();
  const home = makeSandboxHome("anchor-jump");
  let boot;
  let chrome;
  let cdp;
  try {
    writeFixtures(home);
    boot = await bootAndWait(home);
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const workspaces = join(home, "workspaces");
    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;

    // Leg 1: a direct #fragment deep link to a.md's later heading jumps after the lazy chunk.
    const aPath = join(workspaces, "a.md");
    const deepLinkPage = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(aPath)}#later-heading-in-a`,
    });
    const headingReady = await pollUntilTruthy(
      cdp,
      deepLinkPage.sessionId,
      `document.getElementById("later-heading-in-a") != null ? "yes" : null`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (headingReady == null) {
      violations.push(
        `anchor-jump: a.md's "Later Heading In A" heading never rendered within ` +
          `${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    } else {
      const jumped = await pollUntilTruthy(
        cdp,
        deepLinkPage.sessionId,
        `(function(){
          if (window.scrollY <= 0) return null;
          var el = document.getElementById("later-heading-in-a");
          var top = el.getBoundingClientRect().top;
          return (top >= 0 && top < 300) ? "yes" : null;
        })()`,
        ERROR_POLL_TIMEOUT_MS,
      );
      if (jumped == null) {
        const scrollY = await evalValue(
          cdp,
          deepLinkPage.sessionId,
          `window.scrollY`,
        );
        violations.push(
          `anchor-jump: the #later-heading-in-a deep link never scrolled the heading into the ` +
            `viewport's upper band within ${ERROR_POLL_TIMEOUT_MS}ms (window.scrollY=${scrollY})`,
        );
      }
    }
    await cdp.send("Target.closeTarget", { targetId: deepLinkPage.targetId });

    // Leg 2: a TOC click on the 5+ heading fixture jumps and updates the hash.
    const headingsPath = join(workspaces, "headings.md");
    const tocPage = await openPage(cdp, {
      url: `${origin}/viewer/?path=${encodeURIComponent(headingsPath)}`,
    });
    const tocRect = await pollUntilTruthy(
      cdp,
      tocPage.sessionId,
      `(function(){
        var a = document.querySelector('.viewer-toc-entry[href="#conclusion"]');
        if (!a) return null;
        var r = a.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (tocRect == null) {
      violations.push(
        `anchor-jump: the "#conclusion" TOC entry never rendered for the 5+ heading fixture ` +
          `within ${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    } else {
      await dispatchRealClick(cdp, tocPage.sessionId, tocRect);
      const tocJumped = await pollUntilTruthy(
        cdp,
        tocPage.sessionId,
        `(function(){
          if (location.hash !== "#conclusion") return null;
          var el = document.getElementById("conclusion");
          if (!el) return null;
          var top = el.getBoundingClientRect().top;
          return (top >= 0 && top < 300) ? "yes" : null;
        })()`,
        ERROR_POLL_TIMEOUT_MS,
      );
      if (tocJumped == null) {
        const hash = await evalValue(cdp, tocPage.sessionId, `location.hash`);
        violations.push(
          `anchor-jump: clicking the "#conclusion" TOC entry never updated location.hash and ` +
            `scrolled it into the viewport's upper band within ${ERROR_POLL_TIMEOUT_MS}ms ` +
            `(location.hash=${JSON.stringify(hash)})`,
        );
      }
    }
    await cdp.send("Target.closeTarget", { targetId: tocPage.targetId });
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const ANCHOR_JUMP_TARGET = "document.getElementById(fragment)";
const ANCHOR_JUMP_REPLACEMENT =
  'document.getElementById("panel112-break-" + fragment)';

/** `--break anchor-jump`: prefixes the fragment-jump effect's sole `getElementById` lookup with
 * an impossible sentinel so it always misses, rebuilds, and requires the SAME check to report the
 * deep-link scroll violation. Empirically also trips the TOC-click leg: clicking a same-document
 * `#fragment` anchor fires `popstate` per spec (verified live against this exact build), which
 * `ViewerApp`'s own popstate listener answers by refetching and remounting, so the TOC-click leg's
 * scroll is driven by this SAME effect, not by an independent native browser scroll-into-view.
 * Restores the captured bytes unconditionally in a `finally`, rebuilds, and requires a clean
 * pass. */
async function runBreakAnchorJump() {
  assertBuilt();
  const original = readFileSync(VIEWER_MAIN_PATH, "utf8");
  const occurrences = original.split(ANCHOR_JUMP_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel112: refusing to run --break anchor-jump, expected ` +
        `${JSON.stringify(ANCHOR_JUMP_TARGET)} to occur exactly once in ${VIEWER_MAIN_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_MAIN_PATH, original);
  try {
    writeFileSync(
      VIEWER_MAIN_PATH,
      original.replace(ANCHOR_JUMP_TARGET, ANCHOR_JUMP_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkAnchorJump(tripViolations);
    console.log(
      `\n--break anchor-jump TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("later-heading-in-a deep link"),
    );
  } finally {
    restoreViewerMainSource(original);
  }

  const restoreViolations = [];
  await checkAnchorJump(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break anchor-jump RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// md-link-opens-viewer: real tmux + ttyd + headless Chrome, meta-clicking a
// printf-replayed captured OSC-8 markdown link opens the Dispatch viewer
// route; a javascript:-scheme control link must NOT navigate and a no-modifier
// click stays unchanged.
// ---------------------------------------------------------------------------

/**
 * Real tmux/ttyd/Chrome via CDP: meta-clicking a printf-replayed OSC-8 link carrying the exact
 * captured byte shape (112-RESEARCH.md) for the space-in-name markdown fixture must open
 * `/viewer/?path=` with the decoded, space-intact absolute path, never a raw `file://` URL. A
 * meta-click on a `javascript:`-scheme control link must record no window.open at all (CR-01's
 * scheme allowlist). A plain click without modifiers must record nothing (the modifier gate).
 */
async function checkMdLinkOpensViewer(violations) {
  assertBuilt();
  const home = makeSandboxHome("md-link-opens-viewer");
  const tmuxName = `p112term-${process.pid}`;
  let ttyd;
  let boot;
  let chrome;
  let cdp;
  try {
    writeFixtures(home);

    // Warmup boot + kill first: board.db's schema (cards, meta tables) only exists after a real
    // boot has run its migrations once, and it must exist BEFORE the tmux session is created, or
    // this warmup's own reconcileSessions() sweep would eat the not-yet-seeded ttyd.
    const warmup = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);
    await stopServer(warmup.child);

    await tmuxNewSession112(tmuxName, home);
    const live = await tmuxListSessionNames112();
    if (!live.includes(tmuxName)) {
      throw new Error(
        `md-link-opens-viewer: tmux session ${tmuxName} did not come up, live=${JSON.stringify(live)}`,
      );
    }

    const sessionId = randomUUID();
    ttyd = await spawnTtyd112(tmuxName, sessionId);
    await waitForPortListening112(ttyd.port);

    const now = new Date().toISOString();
    const cardId = randomUUID();
    seedFixtureSession112(home, {
      id: cardId,
      issueId: `${cardId}-issue`,
      identifier: "P112-1",
      title: "panel-112 md-link-opens-viewer fixture card",
      description: null,
      priority: 3,
      column: "in_progress",
      updatedAt: now,
      sessions: [
        {
          id: sessionId,
          createdAt: now,
          updatedAt: now,
          tmuxSession: tmuxName,
          ttydPort: ttyd.port,
        },
      ],
      activeSessionId: sessionId,
      tmuxSession: tmuxName,
      ttydPort: ttyd.port,
    });

    // The real boot: its reconcileSessions() adopts the already-running ttyd by matching the
    // seeded session record's port, and its ensureHyperlinksTerminalFeature() grants the
    // hyperlinks terminal-feature against the ALREADY-LIVE isolated tmux server, so ttyd's later
    // `-T tmux-256color` attach picks it up. Both require TMUX_TMPDIR to reach this tmux server.
    boot = await bootAndWait(home, { TMUX_TMPDIR: TMUX_TMPDIR_112 });
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;
    const terminalUrl = `${origin}/sessions/${sessionId}/terminal/`;
    const page = await openTerminalPage(cdp, {
      url: terminalUrl,
      initScript: WINDOW_OPEN_STUB_INIT_SCRIPT,
    });

    const screenReady = await pollUntilTruthy(
      cdp,
      page.sessionId,
      `document.querySelector(".xterm-screen") != null ? "yes" : null`,
      ERROR_POLL_TIMEOUT_MS,
    );
    if (screenReady == null) {
      violations.push(
        `md-link-opens-viewer: the terminal page's ".xterm-screen" never rendered within ` +
          `${ERROR_POLL_TIMEOUT_MS}ms`,
      );
    } else {
      // Let the WS handshake complete and the pty settle at the browser's negotiated cols/rows.
      await sleep(1500);
      await tmuxP112(["send-keys", "-t", `=${tmuxName}:`, "clear", "Enter"]);
      await sleep(300);

      const workspaces = join(home, "workspaces");
      const mdPath = join(workspaces, "draft notes (v2).md");
      const jsCtrlPath = join(workspaces, "js-scheme-control");
      const jsCtrlUri = "javascript:window.__panel112XssFired = true";
      const mdLabel = basename(mdPath);
      const jsCtrlLabel = basename(jsCtrlPath);

      await tmuxP112([
        "send-keys",
        "-t",
        `=${tmuxName}:`,
        buildOsc8Command(mdPath),
        "Enter",
      ]);
      await tmuxP112([
        "send-keys",
        "-t",
        `=${tmuxName}:`,
        buildOsc8Command(jsCtrlPath, jsCtrlUri),
        "Enter",
      ]);

      const findRow = async (label) => {
        const deadline = Date.now() + ERROR_POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const lines = await tmuxCapturePane112(tmuxName);
          const row = lines.findIndex(
            (line) => line.replace(/\s+$/, "") === label,
          );
          if (row >= 0) return row;
          await sleep(POLL_INTERVAL_MS);
        }
        return -1;
      };

      const mdRow = await findRow(mdLabel);
      const jsCtrlRow = await findRow(jsCtrlLabel);
      if (mdRow < 0 || jsCtrlRow < 0) {
        violations.push(
          `md-link-opens-viewer: expected both link labels (${JSON.stringify(mdLabel)}, ` +
            `${JSON.stringify(jsCtrlLabel)}) to appear on their own output row within ` +
            `${ERROR_POLL_TIMEOUT_MS}ms, observed mdRow=${mdRow} jsCtrlRow=${jsCtrlRow}`,
        );
      } else {
        const { cols, rows } = await tmuxPaneSize112(tmuxName);
        const rect = await evalValue(
          cdp,
          page.sessionId,
          `(function(){
            var el = document.querySelector(".xterm-screen");
            var r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
          })()`,
        );
        const cellWidth = rect.width / cols;
        const cellHeight = rect.height / rows;
        const pointFor = (row, label) => ({
          x: rect.left + (label.length / 2) * cellWidth,
          y: rect.top + (row + 0.5) * cellHeight,
        });
        const mdPoint = pointFor(mdRow, mdLabel);
        const jsCtrlPoint = pointFor(jsCtrlRow, jsCtrlLabel);

        // modifiers: 0 (no meta/ctrl) - activateLink's gate must return before window.open fires.
        await dispatchRealClick(cdp, page.sessionId, mdPoint, 0);
        await sleep(200);
        const afterPlainClick = await evalValue(
          cdp,
          page.sessionId,
          `window.__panel112Opens.length`,
        );
        if (afterPlainClick !== 0) {
          violations.push(
            `md-link-opens-viewer: expected a plain (no-modifier) click to record no window.open ` +
              `calls, observed ${afterPlainClick}`,
          );
        }

        // Meta-click (modifiers: 4) the markdown link: must reroute through /viewer/?path=.
        await dispatchRealClick(cdp, page.sessionId, mdPoint, 4);
        const mdOpenState = await pollUntilTruthy(
          cdp,
          page.sessionId,
          `window.__panel112Opens.length >= 1 ? "yes" : null`,
          ERROR_POLL_TIMEOUT_MS,
        );
        if (mdOpenState == null) {
          violations.push(
            `md-link-opens-viewer: meta-clicking the markdown link never recorded a window.open ` +
              `call within ${ERROR_POLL_TIMEOUT_MS}ms`,
          );
        } else {
          const mdOpened = await evalValue(
            cdp,
            page.sessionId,
            `window.__panel112Opens[window.__panel112Opens.length - 1]`,
          );
          const expectedPrefix = `${origin}/viewer/?path=`;
          if (!mdOpened.startsWith(expectedPrefix)) {
            violations.push(
              `md-link-opens-viewer: expected the md link's recorded URL to start with ` +
                `${JSON.stringify(expectedPrefix)}, observed ${JSON.stringify(mdOpened)}`,
            );
          }
          if (mdOpened.startsWith("file://")) {
            violations.push(
              `md-link-opens-viewer: the md link's recorded URL started with file://, the raw ` +
                `URI leaked instead of rerouting through the viewer: ${JSON.stringify(mdOpened)}`,
            );
          }
          const decodedPath = new URL(mdOpened).searchParams.get("path");
          if (decodedPath !== mdPath) {
            violations.push(
              `md-link-opens-viewer: expected the decoded ?path= to equal ` +
                `${JSON.stringify(mdPath)} (space intact), observed ${JSON.stringify(decodedPath)}`,
            );
          }
        }

        // Meta-click the javascript:-scheme control: CR-01's scheme allowlist must block it, so
        // activateLink returns before window.open and no navigation is ever recorded.
        const opensBeforeCtrl = await evalValue(
          cdp,
          page.sessionId,
          `window.__panel112Opens.length`,
        );
        await dispatchRealClick(cdp, page.sessionId, jsCtrlPoint, 4);
        await sleep(500);
        const opensAfterCtrl = await evalValue(
          cdp,
          page.sessionId,
          `window.__panel112Opens.length`,
        );
        if (opensAfterCtrl !== opensBeforeCtrl) {
          const ctrlOpened = await evalValue(
            cdp,
            page.sessionId,
            `window.__panel112Opens[window.__panel112Opens.length - 1]`,
          );
          violations.push(
            `md-link-opens-viewer: meta-clicking the javascript:-scheme control must NOT navigate, ` +
              `but window.open recorded ${JSON.stringify(ctrlOpened)}`,
          );
        }
        const ctrlXssFired = await evalValue(
          cdp,
          page.sessionId,
          `window.__panel112XssFired === true`,
        );
        if (ctrlXssFired === true) {
          violations.push(
            `md-link-opens-viewer: the javascript:-scheme OSC-8 control executed ` +
              `(window.__panel112XssFired === true)`,
          );
        }
      }
    }
    await cdp.send("Target.closeTarget", { targetId: page.targetId });
  } finally {
    if (cdp) cdp.close();
    await stopServer(chrome);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(boot?.child);
    await tearDownTmux112(tmuxName, ttyd?.child);
    cleanupSandboxHome(home);
  }
}

const TERMINAL_MAIN_PATH = join(REPO_ROOT, "src/web/terminal-main.ts");
const MD_LINK_EXTENSION_TARGET = "(md|markdown)";
const MD_LINK_EXTENSION_REPLACEMENT = "(zz|markdown)";

/** Shared break-`finally` restore for `terminal-main.ts`: source bytes back, build memo reset,
 * dist/ removed. */
function restoreTerminalMainSource(original) {
  writeFileSync(TERMINAL_MAIN_PATH, original);
  resetBuildCache();
  rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
  unregisterRestore(TERMINAL_MAIN_PATH);
}

/** `--break md-link-opens-viewer`: replaces the `.md` alternative in `markdownFilePath`'s sole
 * extension regex with an unmatchable token (panel-110-06 single-call-site precedent), rebuilds,
 * and requires the SAME check to report that meta-clicking the markdown link recorded no
 * window.open (the matcher no longer recognizes `.md`, so `activateLink` sees a `file://` scheme
 * that CR-01's allowlist blocks, and the link never reroutes through the viewer). Restores the
 * captured bytes unconditionally in a `finally`, rebuilds, and requires a clean pass. */
async function runBreakMdLinkOpensViewer() {
  assertBuilt();
  const original = readFileSync(TERMINAL_MAIN_PATH, "utf8");
  const occurrences = original.split(MD_LINK_EXTENSION_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel112: refusing to run --break md-link-opens-viewer, expected ` +
        `${JSON.stringify(MD_LINK_EXTENSION_TARGET)} to occur exactly once in ` +
        `${TERMINAL_MAIN_PATH}, measured ${occurrences}. A miscounted anchor would mutate the ` +
        `wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(TERMINAL_MAIN_PATH, original);
  try {
    writeFileSync(
      TERMINAL_MAIN_PATH,
      original.replace(MD_LINK_EXTENSION_TARGET, MD_LINK_EXTENSION_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkMdLinkOpensViewer(tripViolations);
    console.log(
      `\n--break md-link-opens-viewer TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("meta-clicking the markdown link never recorded a window.open"),
    );
  } finally {
    restoreTerminalMainSource(original);
  }

  const restoreViolations = [];
  await checkMdLinkOpensViewer(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break md-link-opens-viewer RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

const CHECKS = {
  "viewer-page-served": (violations) => checkViewerPageServed(violations),
  "error-states": (violations) => checkErrorStates(violations),
  "no-raw-html-injection": (violations) => checkNoRawHtmlInjection(violations),
  "syntax-highlighting": (violations) => checkSyntaxHighlighting(violations),
  "toc-threshold": (violations) => checkTocThreshold(violations),
  "relative-link-navigation": (violations) =>
    checkRelativeLinkNavigation(violations),
  "anchor-jump": (violations) => checkAnchorJump(violations),
  "md-link-opens-viewer": (violations) => checkMdLinkOpensViewer(violations),
};

const BREAKS = {
  "viewer-page-served": runBreakViewerPageServed,
  "error-states": runBreakErrorStates,
  "no-raw-html-injection": runBreakNoRawHtmlInjection,
  "syntax-highlighting": runBreakSyntaxHighlighting,
  "toc-threshold": runBreakTocThreshold,
  "relative-link-navigation": runBreakRelativeLinkNavigation,
  "anchor-jump": runBreakAnchorJump,
  "md-link-opens-viewer": runBreakMdLinkOpensViewer,
};

const PROBES = {};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  await assertNoLiveService();

  const argv = process.argv.slice(2);
  const checkName = readFlag(argv, "--check");
  if (checkName != null && !Object.hasOwn(CHECKS, checkName)) {
    console.error(
      `unknown check "${checkName}", valid: ${Object.keys(CHECKS).join(", ")}`,
    );
    process.exit(1);
  }
  const breakName = readFlag(argv, "--break");
  if (breakName != null && !Object.hasOwn(BREAKS, breakName)) {
    console.error(
      `unknown break "${breakName}", valid: ${Object.keys(BREAKS).join(", ")}`,
    );
    process.exit(1);
  }
  const probeName = readFlag(argv, "--probe");
  if (probeName != null && !Object.hasOwn(PROBES, probeName)) {
    console.error(
      `unknown probe "${probeName}", valid: ${Object.keys(PROBES).join(", ")}`,
    );
    process.exit(1);
  }
  if (Object.keys(CHECKS).length === 0) {
    console.error(
      "panel-112: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
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
  console.error(`panel-112 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
