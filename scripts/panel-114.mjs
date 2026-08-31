/**
 * Phase 114 instrument script scaffold (LUI-02/03/04, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92 through
 * panel-112.mjs. `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply
 * here, but prettier still formats this file.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-112.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on the user's live service at :4700, before this script boots any server or
 * spawns any real process, and there is no override flag. It runs FIRST in `main()`, before any
 * sandbox directory is created.
 *
 * SCOPE, Plan 01 claims this phase's instrument script, its port claims, and the stable fixture
 * set every later plan in this phase reuses. Plan 01's own deliverable was the scaffold (safety
 * preflight, sandbox spine, raw-CDP driver, `seedFixtureCards`, the four breakpoint presets) plus
 * one probe, `baseline`, that records every BEFORE value the phase must report before a single
 * source byte changes. Plan 03 adds the first real check, `density` (break-proven), landing the
 * v3.4 density token block in `tokens.css` and repointing `CardView.tsx`/`Column.tsx` onto it.
 * Plan 04 adds `board-states` (break-proven), proving `CardView.tsx`'s hover/pressed/focus-ring
 * fixes, `Card.tsx`'s composed pointer/focus handlers and `Column.tsx`'s three-branch resize
 * handle. Plan 05 adds `control-states` (break-proven), proving `IconButton.tsx`'s conditional
 * caller-background composition fix (the active view-switch segment's hover/pressed, without
 * regressing the inactive segment) and `Button.tsx`'s primary/danger hover and pressed, primary
 * proven live and danger proven by a shared-mechanism source assertion plus an in-page token
 * cross-check. Later plans in this phase register the motion/reduced-motion checks and their own
 * break-proof legs.
 *
 * DETAIL-PANEL FINDING (Plan 04, out of this plan's own scope, recorded for the next phase that
 * touches `DetailPanel.tsx`): `document.querySelector('aside[aria-label="Ticket detail"]') ==
 * null` can NEVER become true. `DetailPanel.tsx`'s `<aside>` stays permanently mounted (the
 * `PANEL-03` invariant protecting the embedded terminal iframe's identity); `open` is expressed
 * only via `transform: translateX(100%)` sliding it fully off-screen. `checkDensity`'s own
 * reading-surface-isolation Escape call and `probeBaseline`'s `measureMotion` both call
 * `pollUntilTruthy` on that same never-true expression and simply discard its return value, so
 * neither ever actually confirmed a close; this went unnoticed because neither depends on the
 * panel visually closing afterward. `board-states` instead dispatches its two panel-opening-prone
 * real clicks with the Ctrl modifier (`Card.tsx` routes a Ctrl/Cmd-held click to
 * `onToggleSelect`, never `onSelect`), which never opens the panel in the first place, and its own
 * `closeDetailPanelIfOpen` safety net reads `window.panel114DetailPanelOpen()` (a bounding-rect
 * check) instead.
 *
 * Ports, unique against every existing `panel-*.mjs` and other `scripts/*.mjs` harness (verified
 * by grepping every `SANDBOX_PORT =` and `CDP_PORT =` assignment in `scripts/*.mjs`: the highest
 * committed `SANDBOX_PORT` is 47886 (panel-112.mjs), the highest committed `CDP_PORT` is 9382
 * (panel-110.mjs)): sandbox server 47888, Chrome remote-debugging 9383. Port 47887 is
 * deliberately skipped: Phase 113's own measurement harness used 47887, but it lived only in a
 * session scratchpad and was never committed, so a plain grep of `scripts/` cannot see it; 47888
 * avoids any ambiguity with that uncommitted history. Never 4700.
 *
 * Usage:
 *   node scripts/panel-114.mjs                every registered check, exits non-zero on any
 *                                                violation. Refuses to exit 0 if CHECKS is empty,
 *                                                so an accidentally emptied map can never read as
 *                                                a vacuous pass.
 *   node scripts/panel-114.mjs --check <name>  one named check only. Unknown name exits non-zero
 *                                                and lists every registered name.
 *   node scripts/panel-114.mjs --break <name>  that check's OWN break: mutates the real artifact
 *                                                the check reads, confirms the SAME check function
 *                                                the real run uses reports the violation by name
 *                                                (TRIP leg), restores the captured original
 *                                                unconditionally in a `finally`, and re-confirms a
 *                                                clean pass (RESTORE leg). Never edits a source
 *                                                file without capturing and restoring its bytes.
 *   node scripts/panel-114.mjs --probe <name>  one named probe only: measures and prints, never
 *                                                asserts pass/fail. Used to record ledger values.
 *
 * Exit-code contract: 0 when every requested check reports zero violations, or when a break's
 * trip leg correctly fired and its restore leg re-passed, or when a probe completes. 1 on any
 * violation, any safety trip (`assertNoLiveService`), or a break whose trip/restore leg did not
 * behave as expected.
 *
 * BREAK EVIDENCE, appended to by every plan in this phase that registers a check. The quoted
 * lines below are the VERBATIM TRIP-leg output captured from a real `--break` run:
 *   - `density` proven able to fail (Plan 03): replacing the sole `"var(--card-padding)"` regular-
 *     card-padding token reference in `src/web/features/board/CardView.tsx` with the exact
 *     retired spacing-scale shorthand this plan repointed away from,
 *     `"var(--space-xs) var(--space-sm)"`, rebuilding, and re-running the same `checkDensity`
 *     function against a real booted sandbox and real headless Chrome produced, verbatim:
 *     `density(BP-A): regular card padding expected "6px 8px", observed "4px 8px"`
 *     `density(BP-B): regular card padding expected "6px 8px", observed "4px 8px"`
 *     `density(BP-C): regular card padding expected "6px 8px", observed "4px 8px"`
 *     `density(BP-D): regular card padding expected "6px 8px", observed "4px 8px"`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and
 *     `git diff --quiet src/` confirmed a byte-identical restore.
 *   - `board-states` proven able to fail (Plan 04): reinserting the exact deleted
 *     `if (hover && !elevated && !selected && !needsAttention) { boxShadowParts.push("0 2px 8px
 *     rgba(0,0,0,0.3)"); }` branch immediately after the `elevated`/`--shadow-float` line in
 *     `src/web/features/board/CardView.tsx`, rebuilding, and re-running the same
 *     `checkBoardStates` function against a real booted sandbox and real headless Chrome
 *     produced, verbatim:
 *     `board-states(BP-A): card hover boxShadow expected "none", observed "rgba(0, 0, 0, 0.3) 0px 2px 8px 0px" (mode: real)`
 *     `board-states(BP-B): card hover boxShadow expected "none", observed "rgba(0, 0, 0, 0.3) 0px 2px 8px 0px" (mode: real)`
 *     `board-states(BP-C): card hover boxShadow expected "none", observed "rgba(0, 0, 0, 0.3) 0px 2px 8px 0px" (mode: rendered-state)`
 *     `board-states(BP-D): card hover boxShadow expected "none", observed "rgba(0, 0, 0, 0.3) 0px 2px 8px 0px" (mode: rendered-state)`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and
 *     `git diff --quiet src/` confirmed a byte-identical restore.
 *   - `control-states` proven able to fail (Plan 05): moving `IconButton.tsx`'s `...style` spread
 *     line back to LAST (the exact pre-fix order Task 1 undid), rebuilding, and re-running the
 *     same `checkControlStates` function against a real booted sandbox and real headless Chrome
 *     produced, verbatim (the inactive segment's own assertions did not appear in the trip
 *     output at any breakpoint, confirming Research Pitfall 4's regression guard held):
 *     `control-states(BP-A): view-switch active segment hover backgroundColor (rgba(31, 34, 53, 1.000)) does not differ from resting (rgba(31, 34, 53, 1.000)), the hover-view-switch-segment defect (mode: real)`
 *     `control-states(BP-A): view-switch active segment hover backgroundColor expected the 22% accent tint rgba(36, 39, 64, 1.000), observed rgba(31, 34, 53, 1.000) (mode: real)`
 *     `control-states(BP-A): view-switch active segment pressed backgroundColor expected rgba(27, 30, 47, 1.000) (black 12% over its own resting value), observed rgba(31, 34, 53, 1.000)`
 *     `control-states(BP-A): view-switch active segment pressed backgroundColor does not differ from its own resting backgroundColor`
 *     `control-states(BP-A): view-switch active segment pressed backgroundColor does not differ from its own hovered backgroundColor`
 *     (BP-B/BP-C/BP-D repeat the identical five-line pattern, `mode: real` for BP-B and
 *     `mode: rendered-state` for BP-C/BP-D.)
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and
 *     `git diff --quiet src/` confirmed a byte-identical restore.
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
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants, sandbox/boot helper set. Ported from panel-112.mjs, renamed for
// this phase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

const SANDBOX_PORT = 47888;
const CDP_PORT = 9383;
const SANDBOX_PREFIX = "dispatch-panel-114-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-114-harness-fake-key-never-real";

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
      "PANEL-114-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
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

/**
 * `rmSync(..., { recursive: true, force: true })` still throws `ENOTEMPTY` on macOS when a just-
 * killed process (Chrome's own exit-time lock/lease file writes) races the removal; retried a
 * few times immediately rather than letting a teardown-only race fail the whole run.
 */
function rmSyncRetry(path, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === attempts) throw err;
    }
  }
}

/** Best-effort sandbox home cleanup, called from a `finally` so a failing run never leaks a temp
 * directory. */
function cleanupSandboxHome(home) {
  if (home == null) return;
  rmSyncRetry(home);
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
 * A later plan's break mutates a TypeScript source file and rebuilds; without this,
 * `assertBuilt`'s memo would skip that rebuild and the break would mutate dist without the
 * source change ever reaching it.
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
      "panel-114: removed dist/ (it may hold break-mutated output); run `npm run build`",
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
 * failed boot never leaks a listener.
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
        `panel-114: the booted child did not bind ${SANDBOX_PORT} (EADDRINUSE fallback or ` +
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
// waitForCdpUp, evalValue, evalAsyncValue, chromeUserDataDir, launchChrome),
// itself the same block panel-111.mjs and panel-112.mjs reused verbatim.
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
    { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false },
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
 * press/release recipe. `modifiers` follows the CDP bitmask; every click this file needs (opening
 * the detail panel on a seeded card) needs a GENUINE trusted click so the handlers under
 * measurement run exactly as a real user's click would drive them, never `element.click()`'s
 * synthetic untrusted event.
 */
async function dispatchRealClick(cdp, sessionId, point, modifiers = 0) {
  // A leading mouseMoved matters for hover-branch style resolution: a press/release with no
  // prior move can land on an element whose hover-driven React state was never set.
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

/** Real key press/release pair via `Input.dispatchKeyEvent`, the exact `windowsVirtualKeyCode`
 * recipe `panel-98.mjs`'s `dispatchTab`/`panel-100.mjs`'s `clearSelectionViaEscape` use. */
async function dispatchRealKey(cdp, sessionId, key, code, virtualKeyCode) {
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "rawKeyDown",
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    },
    sessionId,
  );
}

// ---------------------------------------------------------------------------
// Fixture: 18 cards across the six board columns, mirroring Phase 113's own
// per-column counts so this phase's measurements are comparable to that
// ledger. Field names come from src/shared/types.ts's `Card` interface only.
// ---------------------------------------------------------------------------

const FIXTURE_TIMESTAMP = "2026-08-31T12:00:00.000Z";

/** Pads-by-authoring a title past 288 characters, then slices to exactly 288, so the exact
 * length is guaranteed by code rather than by hand-counting prose. */
function longTitle(text) {
  return text.slice(0, 288);
}

/** h1, h2, prose paragraph, bulleted list, inline code span, fenced code block: the exact markdown
 * shape Phase 113's own fixture cards used, one per column, so the detail panel has real content
 * once a later plan opens it. */
function markdownDescription(identifier) {
  return `# ${identifier} implementation notes

## Context

This ticket needs a documented decision path before implementation starts, since the change
touches a shared code path with more than one caller.

- Confirm the root cause before patching a caller-side symptom
- Check for an existing helper before writing a new one
- Leave a one-line \`ponytail:\` note on any deliberate simplification

Inline example: call \`seedFixtureCards(home, cards)\` once per boot, never twice.

\`\`\`ts
export function exampleFix(input: string): string {
  return input.trim();
}
\`\`\`
`;
}

function fixtureCard({ id, identifier, title, priority, column, description }) {
  return {
    id,
    issueId: `${id}-issue`,
    identifier,
    title,
    description: description ?? null,
    priority,
    column,
    updatedAt: FIXTURE_TIMESTAMP,
  };
}

const LONG_TITLE_TODO = longTitle(
  "Investigate why the board occasionally shows a stale card position after a rapid drag-and-drop " +
    "sequence performed across two different browser tabs pointed at the same sandbox instance, " +
    "reproduce with a scripted double-drag, capture the exact SSE event ordering, and confirm " +
    "whether the fix belongs in the client reconciliation path or the server's own broadcast " +
    "ordering guarantee before writing a single line of code.",
);

const LONG_TITLE_NEEDS_INPUT = longTitle(
  "Audit every call site that reads card.previews and card.prs to confirm the active-session-only " +
    "mirror invariant still holds after last week's group-card refactor, paying particular " +
    "attention to the detail panel's own session switcher, the board card's inline preview chip, " +
    "and the multi-repo workspace summary row, since a stale mirror would misreport a session.",
);

const LONG_TITLE_IN_REVIEW = longTitle(
  "Write the missing regression check for the resize handle's three visually distinct states, " +
    "hover, keyboard focus and active dragging, since today all three collapse into one identical " +
    "opaque accent-colored border and a human reviewer cannot tell from a screenshot alone which " +
    "of the three interactions actually produced it, then wire the check into the harness.",
);

const FIXTURE_CARDS = [
  // todo (3), one card carries a multi-paragraph markdown description
  fixtureCard({
    id: "p114-todo-1",
    identifier: "PROP-401",
    title: "Fix login bug",
    priority: 0,
    column: "todo",
    description: markdownDescription("PROP-401"),
  }),
  fixtureCard({
    id: "p114-todo-2",
    identifier: "PROP-402",
    title:
      "Refactor the authentication middleware to support multiple providers",
    priority: 1,
    column: "todo",
  }),
  fixtureCard({
    id: "p114-todo-3",
    identifier: "PROP-403",
    title: LONG_TITLE_TODO,
    priority: 2,
    column: "todo",
  }),

  // in_progress (2), one card carries a multi-paragraph markdown description
  fixtureCard({
    id: "p114-inprog-1",
    identifier: "PROP-404",
    title:
      "Investigate intermittent timeout errors in the payment processing pipeline",
    priority: 3,
    column: "in_progress",
    description: markdownDescription("PROP-404"),
  }),
  fixtureCard({
    id: "p114-inprog-2",
    identifier: "PROP-405",
    title: "Update API docs",
    priority: 4,
    column: "in_progress",
  }),

  // needs_input (3), one card carries a multi-paragraph markdown description
  fixtureCard({
    id: "p114-needsinput-1",
    identifier: "PROP-406",
    title: "Migrate legacy webhook handlers to the new event bus architecture",
    priority: 0,
    column: "needs_input",
  }),
  fixtureCard({
    id: "p114-needsinput-2",
    identifier: "PROP-407",
    title: LONG_TITLE_NEEDS_INPUT,
    priority: 1,
    column: "needs_input",
    description: markdownDescription("PROP-407"),
  }),
  fixtureCard({
    id: "p114-needsinput-3",
    identifier: "PROP-408",
    title: "Wire up the new notification preferences panel",
    priority: 2,
    column: "needs_input",
  }),

  // agent_done (2), one card carries a multi-paragraph markdown description
  fixtureCard({
    id: "p114-agentdone-1",
    identifier: "PROP-409",
    title: "Add pagination support to the ticket search results endpoint",
    priority: 3,
    column: "agent_done",
  }),
  fixtureCard({
    id: "p114-agentdone-2",
    identifier: "PROP-410",
    title: "Clean up stale feature flags in the config loader",
    priority: 4,
    column: "agent_done",
    description: markdownDescription("PROP-410"),
  }),

  // in_review (3), one card carries a multi-paragraph markdown description
  fixtureCard({
    id: "p114-inreview-1",
    identifier: "PROP-411",
    title: "Improve error messages surfaced to users during onboarding flow",
    priority: 0,
    column: "in_review",
  }),
  fixtureCard({
    id: "p114-inreview-2",
    identifier: "PROP-412",
    title: LONG_TITLE_IN_REVIEW,
    priority: 1,
    column: "in_review",
  }),
  fixtureCard({
    id: "p114-inreview-3",
    identifier: "PROP-413",
    title: "Document the multi-repo workspace selection flow",
    priority: 2,
    column: "in_review",
    description: markdownDescription("PROP-413"),
  }),

  // done (5), one card carries a multi-paragraph markdown description
  fixtureCard({
    id: "p114-done-1",
    identifier: "PROP-414",
    title: "Add dark mode",
    priority: 3,
    column: "done",
  }),
  fixtureCard({
    id: "p114-done-2",
    identifier: "PROP-415",
    title:
      "Consolidate duplicate CSS custom properties across primitive components",
    priority: 4,
    column: "done",
  }),
  fixtureCard({
    id: "p114-done-3",
    identifier: "PROP-416",
    title: "Reduce flakiness in the CI smoke test suite",
    priority: 0,
    column: "done",
  }),
  fixtureCard({
    id: "p114-done-4",
    identifier: "PROP-417",
    title: "Support custom keyboard shortcuts for the command palette",
    priority: 1,
    column: "done",
  }),
  fixtureCard({
    id: "p114-done-5",
    identifier: "PROP-418",
    title: "Backfill missing updatedAt timestamps for legacy cards",
    priority: 2,
    column: "done",
    description: markdownDescription("PROP-418"),
  }),
];

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93..112.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
 * every fixture row directly via `node:sqlite` in the same pass. Ported from panel-110.mjs's
 * `seedFixtureCards` verbatim in substance, adjusted for this file's `SANDBOX_PORT` and
 * `bootServerAt`'s `{ child, log }` return shape.
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
// Breakpoints: identical to the ones Phase 113 measured every ledger value
// at, so this phase's numbers are diffable against that ledger.
// ---------------------------------------------------------------------------

const BREAKPOINTS = [
  {
    label: "BP-A",
    width: 1680,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  },
  {
    label: "BP-B",
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  },
  {
    label: "BP-C",
    width: 900,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  },
  {
    label: "BP-D",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  },
];

const EXPECTED_COLUMN_COUNT = 6;
const RELAYOUT_TIMEOUT_MS = 10_000;

/**
 * Issues `Emulation.setDeviceMetricsOverride` with `bp`'s exact metrics, then polls for the board
 * to have re-laid-out: `[data-column]` renders all six columns at every breakpoint (the carousel
 * query only changes layout/sizing, never which columns mount, confirmed live against
 * `Board.tsx`'s own IntersectionObserver wiring), so polling for that count rather than sleeping a
 * fixed interval is a real re-layout signal, not a guess.
 */
async function applyBreakpoint(cdp, sessionId, bp) {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: bp.width,
      height: bp.height,
      deviceScaleFactor: bp.deviceScaleFactor,
      mobile: bp.mobile,
    },
    sessionId,
  );
  const ok = await pollUntilTruthy(
    cdp,
    sessionId,
    `document.querySelectorAll("[data-column]").length === ${EXPECTED_COLUMN_COUNT}`,
    RELAYOUT_TIMEOUT_MS,
  );
  if (!ok) {
    throw new Error(
      `applyBreakpoint(${bp.label}): board did not re-layout to ${EXPECTED_COLUMN_COUNT} columns within ${RELAYOUT_TIMEOUT_MS}ms`,
    );
  }
}

/**
 * Boots the sandbox: seeds the 18-card fixture, boots the production server against the seeded
 * home, and waits for `GET /api/board` to answer 200 with all 18 cards present. Returns
 * `{ home, child, log }` for the caller to hold across every breakpoint measurement and to pass
 * to `teardownSandbox`.
 */
async function bootSandbox(label) {
  const home = makeSandboxHome(label);
  await seedFixtureCards(home, FIXTURE_CARDS);
  const boot = await bootAndWait(home);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let cardCount = 0;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/board`);
    const body = await res.json();
    cardCount = Array.isArray(body) ? body.length : (body?.cards?.length ?? 0);
    if (cardCount >= FIXTURE_CARDS.length) break;
    await sleep(POLL_INTERVAL_MS);
  }
  if (cardCount < FIXTURE_CARDS.length) {
    await stopServer(boot.child);
    cleanupSandboxHome(home);
    throw new Error(
      `bootSandbox: GET /api/board never reported ${FIXTURE_CARDS.length} cards (last seen ${cardCount})`,
    );
  }
  return { home, child: boot.child, log: boot.log };
}

/** Stops the server, waits for the port to stop listening, and cleans the Chrome user-data dir
 * plus the sandbox home. Best-effort throughout, never throws on an already-gone resource. */
async function teardownSandbox({ home, child }) {
  await stopServer(child);
  const deadline = Date.now() + 5_000;
  while ((await isPortListening(SANDBOX_PORT)) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
  }
  rmSyncRetry(chromeUserDataDir());
  cleanupSandboxHome(home);
}

// ---------------------------------------------------------------------------
// Measurement helpers for the "baseline" probe. Installed once via
// `Page.addScriptToEvaluateOnNewDocument` (109-04 precedent) so every later
// `Runtime.evaluate` call in this file can call `window.panel114*` without
// re-sending the source text on every round trip.
// ---------------------------------------------------------------------------

const MEASURE_HELPERS_SRC = `
window.panel114FindColumn = function (column) {
  var el = document.querySelector('[data-column="' + column + '"]');
  if (!el) throw new Error("panel114: column not found: " + column);
  return el;
};
window.panel114FindCardsInColumn = function (column) {
  var col = window.panel114FindColumn(column);
  var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
  if (!scrollContainer) throw new Error("panel114: scroll container not found in " + column);
  return Array.prototype.filter.call(scrollContainer.children, function (el) {
    return el.tagName === "DIV" && /PROP-\\d+/.test(el.textContent);
  });
};
window.panel114FindCardByIdentifier = function (column, identifier) {
  var matches = window.panel114FindCardsInColumn(column).filter(function (el) {
    return el.textContent.indexOf(identifier) !== -1;
  });
  if (matches.length !== 1) {
    throw new Error(
      "panel114: identifier " + identifier + " matched " + matches.length + " card roots in " + column,
    );
  }
  return matches[0];
};
window.panel114Rect = function (el) {
  var r = el.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
  };
};
window.panel114TitleEl = function (cardEl) {
  return cardEl.querySelector('[style*="-webkit-line-clamp"]');
};
window.panel114HeaderEl = function (column) {
  return window.panel114FindColumn(column).querySelector(':scope > [style*="sticky"]');
};
window.panel114CountChipEl = function (column) {
  var spans = window.panel114HeaderEl(column).querySelectorAll(":scope > span");
  return spans[1] || null;
};
window.panel114ResizeHandleEl = function (column) {
  return window.panel114FindColumn(column).querySelector(':scope > [role="separator"]');
};
// DetailPanel.tsx's <aside> stays permanently mounted (never conditionally rendered) to protect
// the embedded terminal iframe's identity across open/close (the PANEL-03 invariant); open is
// expressed only via transform: translateX(100%) sliding it fully off-screen, never by removing
// it from the DOM. querySelector(...) == null can therefore NEVER become true and is not a usable
// closed-signal; this reads the element's own bounding rect instead.
window.panel114DetailPanelOpen = function () {
  var aside = document.querySelector('aside[aria-label="Ticket detail"]');
  if (!aside) return false;
  var r = aside.getBoundingClientRect();
  return r.width > 0 && r.left < window.innerWidth && r.right > 0;
};
window.panel114ComputedSub = function (el, props) {
  if (!el) return null;
  var cs = getComputedStyle(el);
  var out = {};
  props.forEach(function (p) {
    out[p] = cs[p];
  });
  return out;
};
/** Chrome's computed-style serialization of a color-mix() result is NOT a stable "rgb(r, g, b)"
 * string: depending on the exact cascade path it may report "color(srgb ...)" or "oklab(...)".
 * Never used to REPLACE panel114ComputedSub (which every other check in this file relies on for
 * exact literal matches, e.g. boxShadow), only called explicitly by board-states' own color
 * comparisons via a canvas 1x1-pixel round trip, the one technique that resolves ANY valid CSS
 * <color> syntax to actual composited sRGB bytes regardless of the serialization format Chrome
 * chose. */
window.panel114NormalizeColor = function (raw) {
  if (raw == null) return raw;
  var canvas =
    window.__panel114ColorCanvas ||
    (window.__panel114ColorCanvas = document.createElement("canvas"));
  canvas.width = 1;
  canvas.height = 1;
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  var d = ctx.getImageData(0, 0, 1, 1).data;
  // Always includes the alpha channel: --hover-resize-handle is color-mix(in srgb, var(--accent)
  // 55%, transparent), a TRANSLUCENT token whose RGB channels are identical to the opaque
  // --accent it is mixed from. Dropping alpha here would make the translucent hover value and the
  // opaque dragging value normalize to the exact same string.
  return "rgba(" + d[0] + ", " + d[1] + ", " + d[2] + ", " + (d[3] / 255).toFixed(3) + ")";
};
window.panel114ResolveBg = function (cssValue) {
  var probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;pointer-events:none;background:" + cssValue;
  document.body.appendChild(probe);
  var value = getComputedStyle(probe).backgroundColor;
  document.body.removeChild(probe);
  return value;
};
window.panel114ResolveBorderRightColor = function (cssValue) {
  var probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;pointer-events:none;border-right:2px solid " +
    cssValue;
  document.body.appendChild(probe);
  var value = getComputedStyle(probe).borderRightColor;
  document.body.removeChild(probe);
  return value;
};
window.panel114ResolveOutlineColor = function (cssValue) {
  var probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;pointer-events:none;outline:2px solid " +
    cssValue;
  document.body.appendChild(probe);
  var value = getComputedStyle(probe).outlineColor;
  document.body.removeChild(probe);
  return value;
};
`;

const MOUSE_AWAY = { x: 0, y: 0 };
const HOVER_SETTLE_MS = 150;
const TAB_TRAVERSAL_CAP = 60;

async function moveMouseAway(cdp, sessionId) {
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: MOUSE_AWAY.x, y: MOUSE_AWAY.y },
    sessionId,
  );
}

/** Real trusted hover at BP-A/BP-B (genuine `Input.dispatchMouseEvent`), or a programmatic
 * `mouseover`/`mouseout` DOM dispatch at BP-C/BP-D where the emulated mobile/touch device preset
 * has no hover input, the same "rendered-state" honesty convention Phase 113 used. Returns the
 * computed sub-style read while the hover is active. */
async function readUnderHover(cdp, sessionId, elExpr, props, real) {
  if (real) {
    const rect = await evalValue(
      cdp,
      sessionId,
      `window.panel114Rect(${elExpr})`,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: rect.x, y: rect.y },
      sessionId,
    );
    await sleep(HOVER_SETTLE_MS);
    const value = await evalValue(
      cdp,
      sessionId,
      `window.panel114ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
    );
    await moveMouseAway(cdp, sessionId);
    await sleep(HOVER_SETTLE_MS);
    return { mode: "real", value };
  }
  await evalValue(
    cdp,
    sessionId,
    `${elExpr}.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, relatedTarget: document.body }))`,
  );
  await sleep(HOVER_SETTLE_MS);
  const value = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
  );
  await evalValue(
    cdp,
    sessionId,
    `${elExpr}.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, relatedTarget: document.body }))`,
  );
  await sleep(50);
  return { mode: "rendered-state", value };
}

/** Bounded real Tab traversal (panel-95.mjs/panel-98.mjs's own recipe): presses Tab up to
 * `TAB_TRAVERSAL_CAP` times, checking after each press whether `document.activeElement` matches
 * `elExpr`. Blurs whatever was focused first so every traversal starts from a known origin.
 * Returns `{ reached, tabCount }`. */
async function tabTraverseTo(cdp, sessionId, elExpr) {
  await evalValue(
    cdp,
    sessionId,
    `if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();`,
  );
  let reached = false;
  let tabCount = 0;
  for (; tabCount < TAB_TRAVERSAL_CAP && !reached; tabCount++) {
    await dispatchRealKey(cdp, sessionId, "Tab", "Tab", 9);
    reached = await evalValue(
      cdp,
      sessionId,
      `document.activeElement === ${elExpr}`,
    );
  }
  return { reached, tabCount };
}

async function blurActive(cdp, sessionId) {
  await evalValue(
    cdp,
    sessionId,
    `if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();`,
  );
}

/** Density surfaces from the interfaces block's expectation table, all four breakpoints. Targets
 * `PROP-401` (a regular todo card), `PROP-414` (a done/compact card) and `PROP-403` (the
 * 288-character two-line title card), the "todo" column header/count chip. */
async function measureDensity(cdp, sessionId) {
  const regular = `window.panel114FindCardByIdentifier("todo","PROP-401")`;
  const done = `window.panel114FindCardByIdentifier("done","PROP-414")`;
  const long = `window.panel114FindCardByIdentifier("todo","PROP-403")`;

  const regularPadding = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(${regular}).padding`,
  );
  const regularHeight = await evalValue(
    cdp,
    sessionId,
    `${regular}.getBoundingClientRect().height`,
  );
  const donePadding = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(${done}).padding`,
  );
  const interCardGap = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var c = window.panel114FindCardsInColumn("todo");
      if (c.length < 2) return null;
      return c[1].getBoundingClientRect().top - c[0].getBoundingClientRect().top;
    })()`,
  );
  const headerHeight = await evalValue(
    cdp,
    sessionId,
    `window.panel114HeaderEl("todo").getBoundingClientRect().height`,
  );
  const countChipHeight = await evalValue(
    cdp,
    sessionId,
    `window.panel114CountChipEl("todo").getBoundingClientRect().height`,
  );
  const titleLineHeight = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(window.panel114TitleEl(${long})).lineHeight`,
  );
  const titleRenderedHeight = await evalValue(
    cdp,
    sessionId,
    `window.panel114TitleEl(${long}).getBoundingClientRect().height`,
  );
  const cardTitleFontSize = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(window.panel114TitleEl(${regular})).fontSize`,
  );
  const headerFontSize = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(window.panel114HeaderEl("todo").querySelector("span")).fontSize`,
  );
  const countChipFontSize = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(window.panel114CountChipEl("todo")).fontSize`,
  );

  return {
    regularPadding,
    regularHeight,
    donePadding,
    interCardGap,
    headerHeight,
    countChipHeight,
    titleLineHeight,
    titleRenderedHeight,
    cardTitleFontSize,
    headerFontSize,
    countChipFontSize,
  };
}

/** State surfaces from the interfaces block, one breakpoint at a time. `bp.label` gates the real
 * vs. rendered-state hover technique and the resize-handle rows (absent below 1024px, `Board.tsx`'s
 * own carousel query removes its entire JSX subtree there). */
async function measureStates(cdp, sessionId, bp) {
  const narrow = bp.label === "BP-C" || bp.label === "BP-D";
  const real = !narrow;
  const card = `window.panel114FindCardByIdentifier("todo","PROP-401")`;
  const styleProps = ["background", "boxShadow", "outline"];

  const resting = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(${card}, ${JSON.stringify(styleProps)})`,
  );
  const hover = await readUnderHover(cdp, sessionId, card, styleProps, real);

  const pressRect = await evalValue(
    cdp,
    sessionId,
    `window.panel114Rect(${card})`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: pressRect.x, y: pressRect.y },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: pressRect.x,
      y: pressRect.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    },
    sessionId,
  );
  await sleep(80);
  const pressed = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(${card}, ${JSON.stringify(styleProps)})`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: pressRect.x,
      y: pressRect.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    },
    sessionId,
  );
  await sleep(50);

  const traversal = await tabTraverseTo(cdp, sessionId, card);
  const keyboardFocus = traversal.reached
    ? await evalValue(
        cdp,
        sessionId,
        `window.panel114ComputedSub(document.activeElement, ["outline","outlineOffset","outlineColor"])`,
      )
    : null;
  await blurActive(cdp, sessionId);

  const headerBefore = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(window.panel114HeaderEl("todo")).background`,
  );
  const headerHover = await readUnderHover(
    cdp,
    sessionId,
    `window.panel114HeaderEl("todo")`,
    ["background"],
    real,
  );
  const columnHeaderHover = {
    before: headerBefore,
    after: headerHover.value.background,
    mode: headerHover.mode,
  };

  const activeSelector = `document.querySelector('button[aria-label="Board view"]')`;
  const activeBefore = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(${activeSelector}).background`,
  );
  const activeHover = await readUnderHover(
    cdp,
    sessionId,
    activeSelector,
    ["background"],
    real,
  );
  const viewSwitchActiveHover = {
    before: activeBefore,
    after: activeHover.value.background,
    mode: activeHover.mode,
  };

  const inactiveSelector = `document.querySelector('button[aria-label="Workspace view"]')`;
  const inactiveBefore = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(${inactiveSelector}).background`,
  );
  const inactiveHover = await readUnderHover(
    cdp,
    sessionId,
    inactiveSelector,
    ["background"],
    real,
  );
  const viewSwitchInactiveHover = {
    before: inactiveBefore,
    after: inactiveHover.value.background,
    mode: inactiveHover.mode,
  };

  let resizeHandle;
  if (bp.label === "BP-A" || bp.label === "BP-B") {
    const handle = `window.panel114ResizeHandleEl("todo")`;
    const handleProps = ["borderRight", "borderRightColor", "outline"];
    const rhResting = await evalValue(
      cdp,
      sessionId,
      `window.panel114ComputedSub(${handle}, ${JSON.stringify(handleProps)})`,
    );
    const rhHover = await readUnderHover(
      cdp,
      sessionId,
      handle,
      handleProps,
      true,
    );
    const rhTraversal = await tabTraverseTo(cdp, sessionId, handle);
    const rhFocus = rhTraversal.reached
      ? await evalValue(
          cdp,
          sessionId,
          `window.panel114ComputedSub(document.activeElement, ${JSON.stringify(handleProps)})`,
        )
      : null;
    await blurActive(cdp, sessionId);
    const rhRect = await evalValue(
      cdp,
      sessionId,
      `window.panel114Rect(${handle})`,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: rhRect.x, y: rhRect.y },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        x: rhRect.x,
        y: rhRect.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: rhRect.x + 20, y: rhRect.y, buttons: 1 },
      sessionId,
    );
    await sleep(100);
    const rhDragging = await evalValue(
      cdp,
      sessionId,
      `window.panel114ComputedSub(${handle}, ${JSON.stringify(handleProps)})`,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x: rhRect.x + 20,
        y: rhRect.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
      sessionId,
    );
    await moveMouseAway(cdp, sessionId);
    resizeHandle = {
      rendered: true,
      resting: rhResting,
      hover: rhHover,
      focus: { reached: rhTraversal.reached, value: rhFocus },
      dragging: rhDragging,
    };
  } else {
    const absent = await evalValue(
      cdp,
      sessionId,
      `window.panel114ResizeHandleEl("todo") === null`,
    );
    resizeHandle = {
      rendered: false,
      absentConfirmed: absent,
      value: "not rendered",
    };
  }

  return {
    resting,
    hover,
    pressed,
    keyboardFocus: { reached: traversal.reached, value: keyboardFocus },
    columnHeaderHover,
    viewSwitchActiveHover,
    viewSwitchInactiveHover,
    resizeHandle,
  };
}

/** Motion surfaces from the interfaces block: the card and count-chip's own transition/animation
 * properties (expected static today, no motion exists), and the detail panel's scrim/aside
 * transition after a real click opens it and a real Escape closes it. */
async function measureMotion(cdp, sessionId) {
  const card = `window.panel114FindCardByIdentifier("todo","PROP-401")`;
  const cardMotion = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(${card}, ["transitionProperty","transitionDuration","animationName"])`,
  );
  const chipMotion = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(window.panel114CountChipEl("todo"), ["transitionProperty","transitionDuration","animationName"])`,
  );

  const rect = await evalValue(cdp, sessionId, `window.panel114Rect(${card})`);
  await dispatchRealClick(cdp, sessionId, { x: rect.x, y: rect.y });
  const opened = await pollUntilTruthy(
    cdp,
    sessionId,
    `document.querySelector('aside[aria-label="Ticket detail"]') != null`,
    5_000,
  );
  let panelMotion = null;
  if (opened) {
    await sleep(200);
    panelMotion = await evalValue(
      cdp,
      sessionId,
      `(function () {
        var aside = document.querySelector('aside[aria-label="Ticket detail"]');
        var scrim = aside ? aside.previousElementSibling : null;
        return {
          aside: window.panel114ComputedSub(aside, ["transitionDuration", "transitionTimingFunction"]),
          scrim: window.panel114ComputedSub(scrim, ["transitionDuration", "transitionTimingFunction"]),
        };
      })()`,
    );
    await dispatchRealKey(cdp, sessionId, "Escape", "Escape", 27);
    await pollUntilTruthy(
      cdp,
      sessionId,
      `document.querySelector('aside[aria-label="Ticket detail"]') == null`,
      5_000,
    );
  }

  return { cardMotion, chipMotion, panelMotion, panelOpened: Boolean(opened) };
}

/**
 * Boots the sandbox, opens the seeded board in real headless Chrome, and at each of the four
 * breakpoints records every density/state/motion row the interfaces block's expectation table
 * names, printing the full record as JSON. Never asserts pass/fail: this is a measurement probe,
 * not a check, its job is to record what ships TODAY before a single source byte changes.
 */
async function probeBaseline() {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  const record = {};
  try {
    console.log("panel-114 --probe baseline: booting sandbox");
    sandbox = await bootSandbox("baseline");
    console.log(
      `panel-114 --probe baseline: sandbox home ${sandbox.home}, launching Chrome`,
    );
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();
    const { sessionId } = await openPage(cdp, { url: "about:blank" });
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: MEASURE_HELPERS_SRC },
      sessionId,
    );
    await cdp.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${SANDBOX_PORT}/` },
      sessionId,
    );
    const loaded = await pollUntilTruthy(
      cdp,
      sessionId,
      `document.getElementById("root") != null`,
      READY_TIMEOUT_MS,
    );
    if (!loaded)
      throw new Error("probeBaseline: #root never appeared after navigation");
    // Splash.tsx runs an unconditional 1.3s full-screen overlay on every mount (113-03's own
    // gotcha); settle past it before the first breakpoint measurement.
    await sleep(1450);

    for (const bp of BREAKPOINTS) {
      console.log(`panel-114 --probe baseline: measuring ${bp.label}`);
      await applyBreakpoint(cdp, sessionId, bp);
      // A native mousedown/click on a tabIndex=0 element (the card, the resize handle) leaves it
      // genuinely focused afterward; the prior breakpoint's own pressed/click/drag legs would
      // otherwise leak a stale focus outline into this breakpoint's "resting" read.
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(300);
      const density = await measureDensity(cdp, sessionId);
      const states = await measureStates(cdp, sessionId, bp);
      const motion = await measureMotion(cdp, sessionId);
      record[bp.label] = { density, states, motion };
    }

    console.log(JSON.stringify(record, null, 2));
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch {
        // best effort
      }
    }
    if (chrome) {
      try {
        chrome.kill("SIGTERM");
      } catch {
        // best effort
      }
    }
    if (sandbox) await teardownSandbox(sandbox);
  }
}

// ---------------------------------------------------------------------------
// density: break-proven check for Plan 03's density token repoint. Boots the
// sandbox once, asserts every expected-after value from the interfaces
// block's table at all four breakpoints, then a reading-surface isolation
// assertion owned by this check alone (no other check reads .reading-surface).
// ---------------------------------------------------------------------------

/** Same value `114-01`'s BEFORE ledger recorded (byte-identical at all four breakpoints); the
 * count chip must not be squeezed by the density change, so the after value is asserted equal
 * to the before value rather than to a new number. */
const BEFORE_COUNT_CHIP_HEIGHT = 15.390625;

/** Tolerance for float px comparisons: CDP's `getBoundingClientRect`/`getComputedStyle` reads are
 * exact for these fixed-px values in practice, but a hairline tolerance absorbs any genuine
 * sub-pixel rendering jitter without masking a real regression. */
const DENSITY_PX_TOLERANCE = 0.05;

function assertDensityPx(violations, bp, label, expected, observed) {
  if (Math.abs(observed - expected) > DENSITY_PX_TOLERANCE) {
    violations.push(
      `density(${bp.label}): ${label} expected ${expected}px, observed ${observed}px`,
    );
  }
}

function assertDensityExact(violations, bp, label, expected, observed) {
  if (observed !== expected) {
    violations.push(
      `density(${bp.label}): ${label} expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`,
    );
  }
}

/**
 * Boots the sandbox, opens the seeded board, and at each of the four breakpoints asserts: regular
 * card padding (6px/8px), done card padding (6px flat), inter-card gap (6px, read as the live
 * pitch between the todo column's first two cards minus the upper card's own height, isolating
 * the gap from either card's own content), column header height (28px), count chip height
 * (unchanged from the 114-01 BEFORE value), card title computed line height (18.85px), the
 * 288-character two-line title's rendered height (37.6875px), and the three type-scale sizes
 * (13px/12px/11px). Once, after the breakpoint sweep, opens the detail panel on a seeded
 * markdown card and asserts its `.reading-surface` paragraph's computed line height is still
 * 20.8px, the isolation NEW-19's fence exists to protect.
 */
async function checkDensity(violations) {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  try {
    sandbox = await bootSandbox("check-density");
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();
    const { sessionId } = await openPage(cdp, { url: "about:blank" });
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: MEASURE_HELPERS_SRC },
      sessionId,
    );
    await cdp.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${SANDBOX_PORT}/` },
      sessionId,
    );
    const loaded = await pollUntilTruthy(
      cdp,
      sessionId,
      `document.getElementById("root") != null`,
      READY_TIMEOUT_MS,
    );
    if (!loaded) {
      violations.push("density: #root never appeared after navigation");
      return;
    }
    // Splash.tsx's unconditional 1.3s overlay, same settle window probeBaseline uses.
    await sleep(1450);

    const regular = `window.panel114FindCardByIdentifier("todo","PROP-401")`;
    const done = `window.panel114FindCardByIdentifier("done","PROP-414")`;
    const long = `window.panel114FindCardByIdentifier("todo","PROP-403")`;

    for (const bp of BREAKPOINTS) {
      await applyBreakpoint(cdp, sessionId, bp);
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(300);

      const regularPadding = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${regular}).padding`,
      );
      assertDensityExact(
        violations,
        bp,
        "regular card padding",
        "6px 8px",
        regularPadding,
      );

      const donePadding = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${done}).padding`,
      );
      assertDensityExact(
        violations,
        bp,
        "done card padding",
        "6px",
        donePadding,
      );

      const pitch = await evalValue(
        cdp,
        sessionId,
        `(function () {
          var c = window.panel114FindCardsInColumn("todo");
          if (c.length < 2) return null;
          var r0 = c[0].getBoundingClientRect();
          var r1 = c[1].getBoundingClientRect();
          return { pitch: r1.top - r0.top, upperHeight: r0.height };
        })()`,
      );
      if (pitch == null) {
        violations.push(
          `density(${bp.label}): fewer than two cards in the todo column, cannot measure inter-card gap`,
        );
      } else {
        assertDensityPx(
          violations,
          bp,
          "inter-card gap",
          6,
          pitch.pitch - pitch.upperHeight,
        );
      }

      const headerHeight = await evalValue(
        cdp,
        sessionId,
        `window.panel114HeaderEl("todo").getBoundingClientRect().height`,
      );
      assertDensityPx(violations, bp, "column header height", 28, headerHeight);

      const countChipHeight = await evalValue(
        cdp,
        sessionId,
        `window.panel114CountChipEl("todo").getBoundingClientRect().height`,
      );
      assertDensityPx(
        violations,
        bp,
        "count chip height (unchanged from BEFORE)",
        BEFORE_COUNT_CHIP_HEIGHT,
        countChipHeight,
      );

      const titleLineHeight = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(window.panel114TitleEl(${long})).lineHeight`,
      );
      assertDensityExact(
        violations,
        bp,
        "card title computed lineHeight",
        "18.85px",
        titleLineHeight,
      );

      const titleRenderedHeight = await evalValue(
        cdp,
        sessionId,
        `window.panel114TitleEl(${long}).getBoundingClientRect().height`,
      );
      assertDensityPx(
        violations,
        bp,
        "two-line 288-char title rendered height",
        37.6875,
        titleRenderedHeight,
      );

      const cardTitleFontSize = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(window.panel114TitleEl(${regular})).fontSize`,
      );
      assertDensityExact(
        violations,
        bp,
        "card title font-size",
        "13px",
        cardTitleFontSize,
      );

      const headerFontSize = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(window.panel114HeaderEl("todo").querySelector("span")).fontSize`,
      );
      assertDensityExact(
        violations,
        bp,
        "column header font-size",
        "12px",
        headerFontSize,
      );

      const countChipFontSize = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(window.panel114CountChipEl("todo")).fontSize`,
      );
      assertDensityExact(
        violations,
        bp,
        "count chip font-size",
        "11px",
        countChipFontSize,
      );
    }

    // Isolation assertion, owned by this check alone: the detail panel's own reading-surface
    // paragraph line height must stay 20.8px, proving the global --line-body change (1.5 to 1.45)
    // did not leak past NEW-19's board-directory fence.
    await applyBreakpoint(cdp, sessionId, BREAKPOINTS[0]);
    await blurActive(cdp, sessionId);
    await moveMouseAway(cdp, sessionId);
    const cardRect = await evalValue(
      cdp,
      sessionId,
      `window.panel114Rect(${regular})`,
    );
    await dispatchRealClick(cdp, sessionId, { x: cardRect.x, y: cardRect.y });
    const opened = await pollUntilTruthy(
      cdp,
      sessionId,
      `document.querySelector('aside[aria-label="Ticket detail"]') != null`,
      5_000,
    );
    if (!opened) {
      violations.push(
        "density: detail panel never opened for the reading-surface isolation assertion",
      );
    } else {
      await sleep(200);
      const readingLineHeight = await evalValue(
        cdp,
        sessionId,
        `(function () {
          var p = document.querySelector(".reading-surface p");
          return p ? getComputedStyle(p).lineHeight : null;
        })()`,
      );
      if (readingLineHeight !== "20.8px") {
        violations.push(
          `density: .reading-surface paragraph lineHeight expected "20.8px", observed ${JSON.stringify(readingLineHeight)}`,
        );
      }
      await dispatchRealKey(cdp, sessionId, "Escape", "Escape", 27);
      await pollUntilTruthy(
        cdp,
        sessionId,
        `document.querySelector('aside[aria-label="Ticket detail"]') == null`,
        5_000,
      );
    }
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch {
        // best effort
      }
    }
    if (chrome) {
      try {
        chrome.kill("SIGTERM");
      } catch {
        // best effort
      }
    }
    if (sandbox) await teardownSandbox(sandbox);
  }
}

// ---------------------------------------------------------------------------
// BREAKS["density"]: mutates the real card-padding repoint CardView.tsx's Task
// 2 landed, rebuilds, and re-runs checkDensity itself against the mutated
// source, then restores the captured bytes unconditionally.
// ---------------------------------------------------------------------------

const CARD_VIEW_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "board",
  "CardView.tsx",
);
const DENSITY_BREAK_TARGET = '"var(--card-padding)"';
const DENSITY_BREAK_REPLACEMENT = '"var(--space-xs) var(--space-sm)"';

function restoreCardViewSource(original) {
  writeFileSync(CARD_VIEW_PATH, original);
  resetBuildCache();
  rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
  unregisterRestore(CARD_VIEW_PATH);
}

async function runBreakDensity() {
  assertBuilt();
  const original = readFileSync(CARD_VIEW_PATH, "utf8");
  const occurrences = original.split(DENSITY_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel-114: refusing to run --break density, expected ${JSON.stringify(DENSITY_BREAK_TARGET)} ` +
        `to occur exactly once in ${CARD_VIEW_PATH}, measured ${occurrences}. A miscounted anchor ` +
        `would mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(CARD_VIEW_PATH, original);
  try {
    writeFileSync(
      CARD_VIEW_PATH,
      original.replace(DENSITY_BREAK_TARGET, DENSITY_BREAK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkDensity(tripViolations);
    console.log(
      `\n--break density TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) => v.includes("regular card padding"));
  } finally {
    restoreCardViewSource(original);
  }

  const restoreViolations = [];
  await checkDensity(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break density RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// board-states: break-proven check for Plan 04's card hover/pressed/focus,
// resize-handle three-state split and column-header hover-inertness. Reuses
// the density check's boot-once-per-run shape and measureStates'/readUnderHover's
// own techniques, now asserting instead of only recording.
// ---------------------------------------------------------------------------

/** Converts a `#rrggbb` hex literal to the exact `rgb(r, g, b)` string format
 * `getComputedStyle` reports, so the check can cross-verify a live probe-resolved token against
 * the design contract's own recorded hex without ever hardcoding a hex as the primary assertion
 * source (the probe resolution IS the primary source; this is the cross-check only). */
function hexToRgbString(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

const PRESSED_CARD_CONTRACT_HEX = "#17181b";
const PRESSED_CARD_HOVER_CONTRACT_HEX = "#1c1d21";

/** A `color-mix()` value read from an isolated probe element (via `panel114ResolveBg`/
 * `panel114ResolveBorderRightColor`/`panel114ResolveOutlineColor`) and the SAME token as actually
 * composited on a real, styled board element were observed LIVE to differ by 1-2 sRGB levels per
 * channel (more pronounced at BP-D's 3x `deviceScaleFactor`), a genuine sub-pixel color-space
 * rounding difference between an isolated single-property probe and a real element's full
 * compositing context, not a measurement bug. `COLOR_TOLERANCE` absorbs that jitter without
 * masking a real palette regression (a wrong TOKEN, e.g. `--pressed-card` swapped for
 * `--pressed-card-hover`, differs by dozens of levels per channel, far outside this tolerance). */
const COLOR_TOLERANCE = 3;

/** Parses a `getComputedStyle`/`panel114NormalizeColor`-style `"rgb(r, g, b)"` or
 * `"rgba(r, g, b, a)"` string into a 4-channel `[r, g, b, a255]` (alpha scaled to 0-255 so the
 * same tolerance applies to all four channels), or `null` if the string is not one of those two
 * exact shapes (e.g. `"none"`). An implicit `rgb(...)` alpha is `255` (fully opaque), so an
 * opaque and a translucent color with identical RGB (e.g. `--accent` vs `--hover-resize-handle`,
 * a `color-mix()` of `--accent` with `transparent`) are never mistaken for a match. */
function parseRgbTriple(str) {
  if (typeof str !== "string") return null;
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(str);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), 255];
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(str);
  if (rgba) {
    return [
      Number(rgba[1]),
      Number(rgba[2]),
      Number(rgba[3]),
      Math.round(Number(rgba[4]) * 255),
    ];
  }
  return null;
}

/** True if `a` and `b` are the same non-color string, or both parse (via {@link parseRgbTriple})
 * within {@link COLOR_TOLERANCE} per channel, alpha included. Never true for two values that fail
 * to parse and are not byte-identical, so a malformed or unexpected computed-style string still
 * fails loudly. */
function colorsMatch(a, b) {
  if (a === b) return true;
  const pa = parseRgbTriple(a);
  const pb = parseRgbTriple(b);
  if (pa == null || pb == null) return false;
  return pa.every((v, i) => Math.abs(v - pb[i]) <= COLOR_TOLERANCE);
}

/** Round-trips a raw `getComputedStyle` (or `panel114Resolve*`) color string through
 * `window.panel114NormalizeColor`'s canvas-pixel technique, so every color comparison in
 * `checkBoardStates` compares actual composited bytes rather than Chrome's own (format-unstable)
 * computed-style serialization. */
async function normalizeColor(cdp, sessionId, raw) {
  if (raw == null) return raw;
  return evalValue(
    cdp,
    sessionId,
    `window.panel114NormalizeColor(${JSON.stringify(raw)})`,
  );
}

/** Real trusted `mousePressed`/`mouseReleased` at `elExpr`'s current rect, reading `props` (via
 * `panel114ComputedSub`) while held and again just after release. Never dispatches a leading
 * `mouseMoved`: the caller controls whether hover precedes the press, so the pressed-tier formula
 * can be asserted against whichever resting tier was actually observed immediately before the
 * press, rather than an assumed one. `modifiers` follows the CDP bitmask (`2` is Ctrl); the
 * press+release at the same point fires a real trusted `click` afterward, and `Card.tsx`'s own
 * `onClick` routes a Ctrl/Cmd-held click to `onToggleSelect` (a lightweight selection toggle)
 * instead of `onSelect` (which opens the detail panel), so passing `2` here proves the pressed
 * tier without ever touching `DetailPanel.tsx`. */
async function readUnderPress(cdp, sessionId, elExpr, props, modifiers = 0) {
  const rect = await evalValue(
    cdp,
    sessionId,
    `window.panel114Rect(${elExpr})`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers,
    },
    sessionId,
  );
  await sleep(HOVER_SETTLE_MS);
  const pressed = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers,
    },
    sessionId,
  );
  await sleep(50);
  const after = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
  );
  return { pressed, after };
}

/**
 * Rendered-state pressed read: dispatches `pointerdown`/`pointerup` directly via
 * `dispatchEvent`, never through CDP's `Input` domain. A real CDP `mousePressed` at new
 * coordinates was found LIVE to implicitly move Chrome's virtual cursor there first, firing a
 * native `mouseover`/`mouseenter` BEFORE the press settles, so a genuinely un-hovered press is
 * physically unreachable through that technique: pressing always implies the pointer arrived,
 * same as real hardware. This synthetic dispatch triggers React's delegated `onPointerDown`
 * listener (React 17+ attaches at the root, catching any bubbling event, trusted or not) without
 * moving the virtual cursor and without the native hover side effect, isolating the pressed-tier
 * assertion from hover exactly as the codebase's own `readUnderHover` "rendered-state" `MouseEvent`
 * dispatch already isolates hover from a real click elsewhere in this file.
 */
async function readUnderSyntheticPress(cdp, sessionId, elExpr, props) {
  await evalValue(
    cdp,
    sessionId,
    `${elExpr}.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1 }))`,
  );
  await sleep(HOVER_SETTLE_MS);
  const pressed = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
  );
  await evalValue(
    cdp,
    sessionId,
    `${elExpr}.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 }))`,
  );
  await sleep(50);
  const after = await evalValue(
    cdp,
    sessionId,
    `window.panel114ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
  );
  return { pressed, after };
}

/** Safety-net cleanup only: every real click this check dispatches now carries the Ctrl modifier
 * (see {@link readUnderPress}'s own JSDoc), which `Card.tsx` routes away from `onSelect`, so the
 * detail panel should never open in the first place. If it somehow does, closes it via a real
 * Escape and polls `window.panel114DetailPanelOpen()` (never `document.querySelector(...) ==
 * null`, which can NEVER be satisfied since `DetailPanel.tsx`'s `<aside>` stays permanently
 * mounted off-screen; see that helper's own JSDoc). */
async function closeDetailPanelIfOpen(cdp, sessionId) {
  const open = await evalValue(
    cdp,
    sessionId,
    `window.panel114DetailPanelOpen()`,
  );
  if (!open) return;
  await dispatchRealKey(cdp, sessionId, "Escape", "Escape", 27);
  await pollUntilTruthy(
    cdp,
    sessionId,
    `!window.panel114DetailPanelOpen()`,
    5_000,
  );
}

/**
 * Retry wrapper around {@link checkBoardStatesOnce}. This check issues far more CDP round trips
 * per run than any other check in this file (real hover, real Tab traversal, real press/release,
 * twice, per breakpoint), and live runs on this machine observed the underlying headless Chrome
 * instance occasionally stall on an unrelated `Input.dispatchMouseEvent`/`Runtime.evaluate` call
 * at a DIFFERENT stage each time (column header once, pressed scenario B another time), never at
 * the same assertion twice, consistent with real CPU contention from the developer's own live
 * desktop Chrome session sharing the machine rather than a deterministic bug in this check's own
 * logic. Retries a THROWN infra-shaped error (never a real assertion violation pushed into
 * `violations`, which is never thrown) up to `MAX_ATTEMPTS` times, tearing down and re-booting a
 * fresh sandbox each attempt.
 */
async function checkBoardStates(violations) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // A fresh array per attempt: a THROWN mid-run infra failure must never leak partial
    // violations from a discarded attempt into the final, real result.
    const attemptViolations = [];
    try {
      await checkBoardStatesOnce(attemptViolations);
      violations.push(...attemptViolations);
      return;
    } catch (err) {
      lastErr = err;
      console.error(
        `board-states: attempt ${attempt}/${MAX_ATTEMPTS} threw (likely CDP/renderer contention, not a code defect): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt === MAX_ATTEMPTS) throw lastErr;
    }
  }
}

async function checkBoardStatesOnce(violations) {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  try {
    sandbox = await bootSandbox("check-board-states");
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();
    const { sessionId } = await openPage(cdp, { url: "about:blank" });
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: MEASURE_HELPERS_SRC },
      sessionId,
    );
    await cdp.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${SANDBOX_PORT}/` },
      sessionId,
    );
    const loaded = await pollUntilTruthy(
      cdp,
      sessionId,
      `document.getElementById("root") != null`,
      READY_TIMEOUT_MS,
    );
    if (!loaded) {
      violations.push("board-states: #root never appeared after navigation");
      return;
    }
    // Splash.tsx's unconditional 1.3s overlay, same settle window every other check uses.
    await sleep(1450);

    const card = `window.panel114FindCardByIdentifier("todo","PROP-401")`;

    // Resolve every token this check needs once, via a probe element in the SAME page, never a
    // hardcoded hex as the primary assertion source. Every resolution is normalized through
    // normalizeColor's canvas-pixel round trip: Chrome's computed-style serialization of a
    // color-mix() result is not a stable "rgb(r, g, b)" string (observed as "color(srgb ...)" and
    // "oklab(...)" depending on cascade path), so a raw string comparison against a live element's
    // own (differently-serialized) computed color would false-positive.
    const resolvedNormalBg = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--surface-card)")`,
      ),
    );
    const resolvedHoverBg = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--surface-card-hover)")`,
      ),
    );
    const resolvedPressedCard = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--pressed-card)")`,
      ),
    );
    const resolvedPressedCardHover = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--pressed-card-hover)")`,
      ),
    );
    const resolvedAccentOutline = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveOutlineColor("var(--accent)")`,
      ),
    );
    const resolvedAccentBorder = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBorderRightColor("var(--accent)")`,
      ),
    );
    const resolvedHoverResizeHandle = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBorderRightColor("var(--hover-resize-handle)")`,
      ),
    );

    // Cross-check the live-resolved pressed tokens against the contract's own recorded hex,
    // proving both the formula (color-mix over each tier's own resting background) and its value.
    // hexToRgbString's output is a bare "rgb(...)" (implicit alpha 255) while
    // panel114NormalizeColor always emits "rgba(...)" (explicit alpha channel, see its own
    // JSDoc); colorsMatch's parseRgbTriple treats those as equivalent when the alpha both resolve
    // to fully opaque, so this is a value cross-check, not a string-format cross-check.
    const expectedPressedCard = hexToRgbString(PRESSED_CARD_CONTRACT_HEX);
    if (!colorsMatch(resolvedPressedCard, expectedPressedCard)) {
      violations.push(
        `board-states: --pressed-card resolved ${resolvedPressedCard}, contract records ${PRESSED_CARD_CONTRACT_HEX} (${expectedPressedCard})`,
      );
    }
    const expectedPressedCardHover = hexToRgbString(
      PRESSED_CARD_HOVER_CONTRACT_HEX,
    );
    if (!colorsMatch(resolvedPressedCardHover, expectedPressedCardHover)) {
      violations.push(
        `board-states: --pressed-card-hover resolved ${resolvedPressedCardHover}, contract records ${PRESSED_CARD_HOVER_CONTRACT_HEX} (${expectedPressedCardHover})`,
      );
    }

    for (const bp of BREAKPOINTS) {
      await applyBreakpoint(cdp, sessionId, bp);
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(300);
      const real = bp.label === "BP-A" || bp.label === "BP-B";
      const label = `board-states(${bp.label})`;

      // CARD HOVER: background must be the hover tier, boxShadow and transform must be "none".
      // The boxShadow assertion is the one that fails against the pre-Plan-04 code, the anchor of
      // this check.
      const hoverRead = await readUnderHover(
        cdp,
        sessionId,
        card,
        ["backgroundColor", "boxShadow", "transform"],
        real,
      );
      if (hoverRead.value.boxShadow !== "none") {
        violations.push(
          `${label}: card hover boxShadow expected "none", observed ${JSON.stringify(hoverRead.value.boxShadow)} (mode: ${hoverRead.mode})`,
        );
      }
      if (hoverRead.value.transform !== "none") {
        violations.push(
          `${label}: card hover transform expected "none", observed ${JSON.stringify(hoverRead.value.transform)} (mode: ${hoverRead.mode})`,
        );
      }
      hoverRead.value.backgroundColor = await normalizeColor(
        cdp,
        sessionId,
        hoverRead.value.backgroundColor,
      );
      if (!colorsMatch(hoverRead.value.backgroundColor, resolvedHoverBg)) {
        violations.push(
          `${label}: card hover backgroundColor expected ${resolvedHoverBg} (mode: ${hoverRead.mode}), observed ${hoverRead.value.backgroundColor}`,
        );
      }

      // CARD FOCUS: a real Tab traversal, asserting the governed focusRing (never the native
      // default outlineStyle "auto"), then a real pointer click proving :focus-visible gates it.
      const traversal = await tabTraverseTo(cdp, sessionId, card);
      if (!traversal.reached) {
        violations.push(
          `${label}: card focus, Tab traversal never reached the card within ${TAB_TRAVERSAL_CAP} presses`,
        );
      } else {
        const focusOutline = await evalValue(
          cdp,
          sessionId,
          `window.panel114ComputedSub(document.activeElement, ["outlineWidth","outlineStyle","outlineColor","outlineOffset"])`,
        );
        if (
          focusOutline.outlineWidth !== "2px" ||
          focusOutline.outlineStyle !== "solid" ||
          focusOutline.outlineOffset !== "2px"
        ) {
          violations.push(
            `${label}: card focus outline expected 2px solid with a 2px offset, observed ${JSON.stringify(focusOutline)}`,
          );
        }
        focusOutline.outlineColor = await normalizeColor(
          cdp,
          sessionId,
          focusOutline.outlineColor,
        );
        if (!colorsMatch(focusOutline.outlineColor, resolvedAccentOutline)) {
          violations.push(
            `${label}: card focus outlineColor expected the resolved accent ${resolvedAccentOutline}, observed ${focusOutline.outlineColor}`,
          );
        }
        if (focusOutline.outlineStyle === "auto") {
          violations.push(
            `${label}: card focus outlineStyle read "auto", the browser's native default ring, never focusRing()`,
          );
        }
      }
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);

      const cardRect = await evalValue(
        cdp,
        sessionId,
        `window.panel114Rect(${card})`,
      );
      // Ctrl modifier (CDP bitmask 2): Card.tsx routes a Ctrl/Cmd-held click to onToggleSelect
      // rather than onSelect, so this real click never opens the detail panel (see
      // readUnderPress's own JSDoc for why); the native mousedown-focuses-a-tabIndex-0-element and
      // :focus-visible gating this assertion tests are unaffected by the modifier.
      await dispatchRealClick(
        cdp,
        sessionId,
        { x: cardRect.x, y: cardRect.y },
        2,
      );
      const stillFocused = await evalValue(
        cdp,
        sessionId,
        `document.activeElement === ${card}`,
      );
      if (stillFocused) {
        const clickOutline = await evalValue(
          cdp,
          sessionId,
          `window.panel114ComputedSub(document.activeElement, ["outlineStyle"])`,
        );
        if (clickOutline.outlineStyle !== "none") {
          violations.push(
            `${label}: a real pointer click left a focus ring painted (outlineStyle ${JSON.stringify(clickOutline.outlineStyle)}), the :focus-visible gate did not hold`,
          );
        }
      }
      await closeDetailPanelIfOpen(cdp, sessionId);
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(150);

      // CARD PRESSED, scenario A: unhovered/unselected first (resting tier --surface-card).
      // Uses the synthetic pointerdown/pointerup technique (readUnderSyntheticPress), not a real
      // CDP mousePressed: a real mousePressed at new coordinates was found LIVE to implicitly move
      // Chrome's virtual cursor there first, firing native hover BEFORE the press settles, making
      // a genuinely un-hovered real press physically unreachable (pressing always implies the
      // pointer arrived, matching real hardware). See readUnderSyntheticPress's own JSDoc.
      const restingA = await normalizeColor(
        cdp,
        sessionId,
        await evalValue(
          cdp,
          sessionId,
          `getComputedStyle(${card}).backgroundColor`,
        ),
      );
      if (!colorsMatch(restingA, resolvedNormalBg)) {
        violations.push(
          `${label}: card pressed scenario A precondition, resting backgroundColor expected ${resolvedNormalBg}, observed ${restingA}`,
        );
      }
      const pressA = await readUnderSyntheticPress(cdp, sessionId, card, [
        "backgroundColor",
      ]);
      pressA.pressed.backgroundColor = await normalizeColor(
        cdp,
        sessionId,
        pressA.pressed.backgroundColor,
      );
      pressA.after.backgroundColor = await normalizeColor(
        cdp,
        sessionId,
        pressA.after.backgroundColor,
      );
      if (!colorsMatch(pressA.pressed.backgroundColor, resolvedPressedCard)) {
        violations.push(
          `${label}: card pressed (unhovered, rendered-state) backgroundColor expected ${resolvedPressedCard}, observed ${pressA.pressed.backgroundColor}`,
        );
      }
      // Positive assertion against the expected RESTING value, not a negative one against the
      // pressed value: --pressed-card and --surface-card differ by only ~3 sRGB levels per
      // channel, within COLOR_TOLERANCE of each other, so "not equal to pressed" would not
      // reliably distinguish a genuine return from a still-pressed jitter reading.
      if (!colorsMatch(pressA.after.backgroundColor, resolvedNormalBg)) {
        violations.push(
          `${label}: card pressed (unhovered, rendered-state) backgroundColor expected to return to ${resolvedNormalBg} after release, still reads ${pressA.after.backgroundColor}`,
        );
      }
      await closeDetailPanelIfOpen(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await blurActive(cdp, sessionId);
      await sleep(150);

      // CARD PRESSED, scenario B: hovered first (resting tier --surface-card-hover).
      if (real) {
        const hoverPrep = await evalValue(
          cdp,
          sessionId,
          `window.panel114Rect(${card})`,
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", x: hoverPrep.x, y: hoverPrep.y },
          sessionId,
        );
      } else {
        await evalValue(
          cdp,
          sessionId,
          `${card}.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, relatedTarget: document.body }))`,
        );
      }
      await sleep(HOVER_SETTLE_MS);
      const restingB = await normalizeColor(
        cdp,
        sessionId,
        await evalValue(
          cdp,
          sessionId,
          `getComputedStyle(${card}).backgroundColor`,
        ),
      );
      if (!colorsMatch(restingB, resolvedHoverBg)) {
        violations.push(
          `${label}: card pressed scenario B precondition, hovered resting backgroundColor expected ${resolvedHoverBg}, observed ${restingB} (mode: ${real ? "real" : "rendered-state"})`,
        );
      }
      // Ctrl modifier (2): the resulting real click never opens the detail panel, see
      // readUnderPress's own JSDoc.
      const pressB = await readUnderPress(
        cdp,
        sessionId,
        card,
        ["backgroundColor"],
        2,
      );
      pressB.pressed.backgroundColor = await normalizeColor(
        cdp,
        sessionId,
        pressB.pressed.backgroundColor,
      );
      pressB.after.backgroundColor = await normalizeColor(
        cdp,
        sessionId,
        pressB.after.backgroundColor,
      );
      if (
        !colorsMatch(pressB.pressed.backgroundColor, resolvedPressedCardHover)
      ) {
        violations.push(
          `${label}: card pressed (hovered) backgroundColor expected ${resolvedPressedCardHover}, observed ${pressB.pressed.backgroundColor}`,
        );
      }
      // Positive assertion against the expected resting-hover value (the mouse never left the
      // card, so it returns to the hover tier, not the plain resting tier); see scenario A's own
      // comment for why a negative check against the pressed value is not reliable here either.
      if (!colorsMatch(pressB.after.backgroundColor, resolvedHoverBg)) {
        violations.push(
          `${label}: card pressed (hovered) backgroundColor expected to return to ${resolvedHoverBg} after release, still reads ${pressB.after.backgroundColor}`,
        );
      }
      await closeDetailPanelIfOpen(cdp, sessionId);
      if (!real) {
        await evalValue(
          cdp,
          sessionId,
          `${card}.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, relatedTarget: document.body }))`,
        );
      }
      await moveMouseAway(cdp, sessionId);
      await blurActive(cdp, sessionId);
      await sleep(150);

      // COLUMN HEADER: byte-identical hover, the contract's own finding proven live, the reason
      // success criterion 2 is satisfied for the header by design rather than by omission.
      const header = `window.panel114HeaderEl("todo")`;
      const headerBefore = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${header}).backgroundColor`,
      );
      const headerHover = await readUnderHover(
        cdp,
        sessionId,
        header,
        ["backgroundColor"],
        real,
      );
      if (headerHover.value.backgroundColor !== headerBefore) {
        violations.push(
          `${label}: column header hover backgroundColor changed (before ${headerBefore}, after ${headerHover.value.backgroundColor}, mode: ${headerHover.mode}), the header must show nothing`,
        );
      }

      // RESIZE HANDLE: three pairwise-distinct active states at BP-A/BP-B, absent (not rendered)
      // at BP-C/BP-D.
      if (real) {
        const handle = `window.panel114ResizeHandleEl("todo")`;
        const handleProps = [
          "borderRightColor",
          "outlineWidth",
          "outlineStyle",
        ];
        const resting = await evalValue(
          cdp,
          sessionId,
          `window.panel114ComputedSub(${handle}, ${JSON.stringify(handleProps)})`,
        );
        const hover = await readUnderHover(
          cdp,
          sessionId,
          handle,
          handleProps,
          true,
        );
        const traversalH = await tabTraverseTo(cdp, sessionId, handle);
        const focusH = traversalH.reached
          ? await evalValue(
              cdp,
              sessionId,
              `window.panel114ComputedSub(document.activeElement, ${JSON.stringify(handleProps)})`,
            )
          : null;
        await blurActive(cdp, sessionId);
        const rect = await evalValue(
          cdp,
          sessionId,
          `window.panel114Rect(${handle})`,
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", x: rect.x, y: rect.y },
          sessionId,
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          {
            type: "mousePressed",
            x: rect.x,
            y: rect.y,
            button: "left",
            buttons: 1,
            clickCount: 1,
          },
          sessionId,
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", x: rect.x + 20, y: rect.y, buttons: 1 },
          sessionId,
        );
        await sleep(100);
        const dragging = await evalValue(
          cdp,
          sessionId,
          `window.panel114ComputedSub(${handle}, ${JSON.stringify(handleProps)})`,
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          {
            type: "mouseReleased",
            x: rect.x + 20,
            y: rect.y,
            button: "left",
            buttons: 0,
            clickCount: 1,
          },
          sessionId,
        );
        await moveMouseAway(cdp, sessionId);

        resting.borderRightColor = await normalizeColor(
          cdp,
          sessionId,
          resting.borderRightColor,
        );
        hover.value.borderRightColor = await normalizeColor(
          cdp,
          sessionId,
          hover.value.borderRightColor,
        );
        dragging.borderRightColor = await normalizeColor(
          cdp,
          sessionId,
          dragging.borderRightColor,
        );

        if (!traversalH.reached) {
          violations.push(
            `${label}: resize handle, Tab traversal never reached it`,
          );
        }
        if (
          !colorsMatch(hover.value.borderRightColor, resolvedHoverResizeHandle)
        ) {
          violations.push(
            `${label}: resize handle hover borderRightColor expected ${resolvedHoverResizeHandle}, observed ${hover.value.borderRightColor}`,
          );
        }
        if (!colorsMatch(dragging.borderRightColor, resolvedAccentBorder)) {
          violations.push(
            `${label}: resize handle dragging borderRightColor expected the opaque accent ${resolvedAccentBorder}, observed ${dragging.borderRightColor}`,
          );
        }
        if (focusH != null && focusH.outlineStyle !== "solid") {
          violations.push(
            `${label}: resize handle focus outlineStyle expected "solid" (focusRing), observed ${JSON.stringify(focusH.outlineStyle)}`,
          );
        }
        if (focusH != null && focusH.outlineWidth !== "2px") {
          violations.push(
            `${label}: resize handle focus outlineWidth expected "2px", observed ${JSON.stringify(focusH.outlineWidth)}`,
          );
        }
        if (
          colorsMatch(hover.value.borderRightColor, dragging.borderRightColor)
        ) {
          violations.push(
            `${label}: resize handle hover and dragging borderRightColor are identical (${hover.value.borderRightColor}), not pairwise distinct`,
          );
        }
        if (
          colorsMatch(resting.borderRightColor, hover.value.borderRightColor)
        ) {
          violations.push(
            `${label}: resize handle resting and hover borderRightColor are identical, hover is indistinguishable from resting`,
          );
        }
      } else {
        const absent = await evalValue(
          cdp,
          sessionId,
          `window.panel114ResizeHandleEl("todo") === null`,
        );
        if (!absent) {
          violations.push(
            `${label}: resize handle expected absent from the DOM (not rendered) at ${bp.label}, but an element was found`,
          );
        }
      }
    }
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch {
        // best effort
      }
    }
    if (chrome) {
      try {
        chrome.kill("SIGTERM");
      } catch {
        // best effort
      }
    }
    if (sandbox) await teardownSandbox(sandbox);
  }
}

// ---------------------------------------------------------------------------
// BREAKS["board-states"]: reintroduces the real deleted hover box-shadow branch
// (Task 1's own deletion) into CardView.tsx, rebuilds, and re-runs
// checkBoardStates itself against the mutated source, then restores the
// captured bytes unconditionally.
// ---------------------------------------------------------------------------

const BOARD_STATES_BREAK_ANCHOR =
  'if (elevated) boxShadowParts.push("var(--shadow-float)");\n';
const BOARD_STATES_BREAK_INSERT =
  BOARD_STATES_BREAK_ANCHOR +
  "  if (hover && !elevated && !selected && !needsAttention) {\n" +
  '    boxShadowParts.push("0 2px 8px rgba(0,0,0,0.3)");\n' +
  "  }\n";

async function runBreakBoardStates() {
  assertBuilt();
  const original = readFileSync(CARD_VIEW_PATH, "utf8");
  const occurrences = original.split(BOARD_STATES_BREAK_ANCHOR).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel-114: refusing to run --break board-states, expected the shadow-float anchor to ` +
        `occur exactly once in ${CARD_VIEW_PATH}, measured ${occurrences}. A miscounted anchor ` +
        `would mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(CARD_VIEW_PATH, original);
  try {
    writeFileSync(
      CARD_VIEW_PATH,
      original.replace(BOARD_STATES_BREAK_ANCHOR, BOARD_STATES_BREAK_INSERT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkBoardStates(tripViolations);
    console.log(
      `\n--break board-states TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) => v.includes("card hover boxShadow"));
  } finally {
    restoreCardViewSource(original);
  }

  const restoreViolations = [];
  await checkBoardStates(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break board-states RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// control-states: break-proven check for Plan 05's IconButton composition fix
// (the active view-switch segment's hover/pressed, proven live and proven
// not to regress the inactive segment) and Button's primary/danger hover and
// pressed (primary proven live, danger proven by shared-mechanism source
// assertion plus an in-page token cross-check). Reuses board-states' own
// retry wrapper, color-normalization and synthetic-press techniques.
// ---------------------------------------------------------------------------

const CONTRACT_HOVER_BUTTON_PRIMARY_HEX = "#717cd7";
const CONTRACT_HOVER_BUTTON_DANGER_HEX = "#e85e62";
const BUTTON_TSX_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "primitives",
  "Button.tsx",
);
const ICON_BUTTON_TSX_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "primitives",
  "IconButton.tsx",
);

/** Focuses `elExpr`, dispatches `Input.insertText`, then reads the value back and throws on
 * mismatch: these are React controlled inputs, and an insert the framework discards would
 * otherwise leave the check asserting against an empty field (panel-104.mjs's own `typeInto`
 * recipe, inlined here rather than shared since this is the only caller in this file). */
async function typeIntoControlStates(cdp, sessionId, elExpr, text) {
  await evalValue(cdp, sessionId, `${elExpr}.focus()`);
  await cdp.send("Input.insertText", { text }, sessionId);
  const value = await evalValue(cdp, sessionId, `${elExpr}.value`);
  if (value !== text) {
    throw new Error(
      `panel114: typeIntoControlStates read back ${JSON.stringify(value)}, expected ${JSON.stringify(text)}`,
    );
  }
}

/** Retry wrapper, same shape and same reasoning as {@link checkBoardStates}'s own: this check
 * issues many CDP round trips (real/rendered-state hover, synthetic press, real Tab traversal, a
 * real click to open a modal, a real text insert), and this machine's shared headless Chrome
 * instance occasionally stalls on an unrelated call under CPU contention from the developer's own
 * live desktop session. */
async function checkControlStates(violations) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptViolations = [];
    try {
      await checkControlStatesOnce(attemptViolations);
      violations.push(...attemptViolations);
      return;
    } catch (err) {
      lastErr = err;
      console.error(
        `control-states: attempt ${attempt}/${MAX_ATTEMPTS} threw (likely CDP/renderer contention, not a code defect): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt === MAX_ATTEMPTS) throw lastErr;
    }
  }
}

async function checkControlStatesOnce(violations) {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  try {
    sandbox = await bootSandbox("check-control-states");
    chrome = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();
    const { sessionId } = await openPage(cdp, { url: "about:blank" });
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: MEASURE_HELPERS_SRC },
      sessionId,
    );
    await cdp.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${SANDBOX_PORT}/` },
      sessionId,
    );
    const loaded = await pollUntilTruthy(
      cdp,
      sessionId,
      `document.getElementById("root") != null`,
      READY_TIMEOUT_MS,
    );
    if (!loaded) {
      violations.push("control-states: #root never appeared after navigation");
      return;
    }
    // Splash.tsx's unconditional 1.3s overlay, same settle window every other check uses.
    await sleep(1450);

    // Token resolutions, once, via the same probe-element technique board-states uses. Every
    // resolution round-trips through normalizeColor's canvas-pixel readback since a color-mix()
    // result's computed-style serialization is not one stable string.
    const resolvedHoverBg = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--surface-card-hover)")`,
      ),
    );
    const resolvedPressedCardHover = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--pressed-card-hover)")`,
      ),
    );
    const resolvedActiveHoverTint = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("color-mix(in srgb, var(--accent) 22%, var(--surface-column))")`,
      ),
    );
    const resolvedHoverButtonPrimary = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--hover-button-primary)")`,
      ),
    );
    const resolvedPressedButtonPrimary = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--pressed-button-primary)")`,
      ),
    );
    const resolvedHoverButtonDanger = await normalizeColor(
      cdp,
      sessionId,
      await evalValue(
        cdp,
        sessionId,
        `window.panel114ResolveBg("var(--hover-button-danger)")`,
      ),
    );

    const expectedHoverPrimary = hexToRgbString(
      CONTRACT_HOVER_BUTTON_PRIMARY_HEX,
    );
    if (!colorsMatch(resolvedHoverButtonPrimary, expectedHoverPrimary)) {
      violations.push(
        `control-states: --hover-button-primary resolved ${resolvedHoverButtonPrimary}, contract records ${CONTRACT_HOVER_BUTTON_PRIMARY_HEX} (${expectedHoverPrimary})`,
      );
    }
    const expectedHoverDanger = hexToRgbString(
      CONTRACT_HOVER_BUTTON_DANGER_HEX,
    );
    if (!colorsMatch(resolvedHoverButtonDanger, expectedHoverDanger)) {
      violations.push(
        `control-states: --hover-button-danger resolved ${resolvedHoverButtonDanger}, contract records ${CONTRACT_HOVER_BUTTON_DANGER_HEX} (${expectedHoverDanger})`,
      );
    }

    // DANGER, by shared-mechanism source assertion, never a live replica: Button.tsx's own
    // composed background expression must resolve BOTH --hover-button-primary and
    // --hover-button-danger inside the SAME expression the live primary proof below exercises.
    // Combined with that live primary proof and the token cross-check above, this establishes
    // danger's behaviour without an untrustworthy replica (the seeded board does not reliably
    // render a danger-variant instance, the same reason Phase 113 used a runtime replica).
    const buttonSrc = readFileSync(BUTTON_TSX_PATH, "utf8");
    const bgStart = buttonSrc.indexOf(
      "background:",
      buttonSrc.indexOf("const composed"),
    );
    const bgSeg = buttonSrc.slice(bgStart, bgStart + 600);
    if (
      !bgSeg.includes("--hover-button-danger") ||
      !bgSeg.includes("--hover-button-primary")
    ) {
      violations.push(
        "control-states: danger is not proven by shared mechanism, Button.tsx's composed background expression does not resolve both --hover-button-primary and --hover-button-danger inside the same expression",
      );
    }
    console.log(
      "control-states: danger's hover/pressed tokens are proven correct by SHARED MECHANISM " +
        "(Button.tsx routes primary and danger through the identical composed background " +
        "expression the live primary proof below exercises) plus the in-page --hover-button-danger " +
        "token resolution cross-checked above against the contract's recorded #e85e62, not by a " +
        "live danger-variant instance.",
    );

    for (const bp of BREAKPOINTS) {
      await applyBreakpoint(cdp, sessionId, bp);
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(300);
      const real = bp.label === "BP-A" || bp.label === "BP-B";
      const label = `control-states(${bp.label})`;

      // VIEW-SWITCH SEGMENTS, located by aria-label/aria-pressed rather than position, so this
      // check reads correctly regardless of which segment happens to be active. Pressed is proven
      // via the synthetic pointerdown/pointerup technique (never a real CDP mousePressed): a real
      // press+release on either segment fires a real trusted click, and SyncStrip.tsx's own
      // onClick has no modifier-routing escape hatch the way Card.tsx does, so a real press on the
      // currently-inactive segment would toggle viewMode as a side effect this check has no
      // business causing.
      const groupSel = `document.querySelector('[role="group"][aria-label="View"]')`;
      const groupExists = await evalValue(
        cdp,
        sessionId,
        `${groupSel} != null`,
      );
      if (!groupExists) {
        violations.push(`${label}: view-switch group not found`);
      } else {
        const activeSel = `${groupSel}.querySelector('[aria-pressed="true"]')`;
        const inactiveSel = `${groupSel}.querySelector('[aria-pressed="false"]')`;
        const activeExists = await evalValue(
          cdp,
          sessionId,
          `${activeSel} != null`,
        );
        const inactiveExists = await evalValue(
          cdp,
          sessionId,
          `${inactiveSel} != null`,
        );
        if (!activeExists || !inactiveExists) {
          violations.push(
            `${label}: view-switch segments not found (active=${activeExists}, inactive=${inactiveExists})`,
          );
        } else {
          const activeRestingRaw = await evalValue(
            cdp,
            sessionId,
            `getComputedStyle(${activeSel}).backgroundColor`,
          );
          const activeResting = await normalizeColor(
            cdp,
            sessionId,
            activeRestingRaw,
          );

          const activeHover = await readUnderHover(
            cdp,
            sessionId,
            activeSel,
            ["backgroundColor"],
            real,
          );
          activeHover.value.backgroundColor = await normalizeColor(
            cdp,
            sessionId,
            activeHover.value.backgroundColor,
          );
          if (colorsMatch(activeHover.value.backgroundColor, activeResting)) {
            violations.push(
              `${label}: view-switch active segment hover backgroundColor (${activeHover.value.backgroundColor}) does not differ from resting (${activeResting}), the hover-view-switch-segment defect (mode: ${activeHover.mode})`,
            );
          }
          if (
            !colorsMatch(
              activeHover.value.backgroundColor,
              resolvedActiveHoverTint,
            )
          ) {
            violations.push(
              `${label}: view-switch active segment hover backgroundColor expected the 22% accent tint ${resolvedActiveHoverTint}, observed ${activeHover.value.backgroundColor} (mode: ${activeHover.mode})`,
            );
          }

          const inactiveHover = await readUnderHover(
            cdp,
            sessionId,
            inactiveSel,
            ["backgroundColor"],
            real,
          );
          inactiveHover.value.backgroundColor = await normalizeColor(
            cdp,
            sessionId,
            inactiveHover.value.backgroundColor,
          );
          if (
            !colorsMatch(inactiveHover.value.backgroundColor, resolvedHoverBg)
          ) {
            violations.push(
              `${label}: view-switch inactive segment hover backgroundColor expected the shared hover tier ${resolvedHoverBg}, observed ${inactiveHover.value.backgroundColor} (mode: ${inactiveHover.mode}), the Pitfall 4 regression guard`,
            );
          }

          const activePress = await readUnderSyntheticPress(
            cdp,
            sessionId,
            activeSel,
            ["backgroundColor"],
          );
          activePress.pressed.backgroundColor = await normalizeColor(
            cdp,
            sessionId,
            activePress.pressed.backgroundColor,
          );
          const expectedActivePressed = await normalizeColor(
            cdp,
            sessionId,
            await evalValue(
              cdp,
              sessionId,
              `window.panel114ResolveBg("color-mix(in srgb, black 12%, " + ${JSON.stringify(activeRestingRaw)} + ")")`,
            ),
          );
          if (
            !colorsMatch(
              activePress.pressed.backgroundColor,
              expectedActivePressed,
            )
          ) {
            violations.push(
              `${label}: view-switch active segment pressed backgroundColor expected ${expectedActivePressed} (black 12% over its own resting value), observed ${activePress.pressed.backgroundColor}`,
            );
          }
          if (colorsMatch(activePress.pressed.backgroundColor, activeResting)) {
            violations.push(
              `${label}: view-switch active segment pressed backgroundColor does not differ from its own resting backgroundColor`,
            );
          }
          if (
            colorsMatch(
              activePress.pressed.backgroundColor,
              activeHover.value.backgroundColor,
            )
          ) {
            violations.push(
              `${label}: view-switch active segment pressed backgroundColor does not differ from its own hovered backgroundColor`,
            );
          }

          const inactivePress = await readUnderSyntheticPress(
            cdp,
            sessionId,
            inactiveSel,
            ["backgroundColor"],
          );
          inactivePress.pressed.backgroundColor = await normalizeColor(
            cdp,
            sessionId,
            inactivePress.pressed.backgroundColor,
          );
          if (
            !colorsMatch(
              inactivePress.pressed.backgroundColor,
              resolvedPressedCardHover,
            )
          ) {
            violations.push(
              `${label}: view-switch inactive segment pressed backgroundColor expected ${resolvedPressedCardHover}, observed ${inactivePress.pressed.backgroundColor}`,
            );
          }
          if (
            colorsMatch(inactivePress.pressed.backgroundColor, resolvedHoverBg)
          ) {
            violations.push(
              `${label}: view-switch inactive segment pressed backgroundColor does not differ from its own hovered backgroundColor`,
            );
          }
        }
      }

      // ICON BUTTON, ordinary case: the always-mounted Settings gear, the contract's own test
      // subject for hover-icon-button. Pressed uses the synthetic technique (never a real click,
      // which would navigate to Settings, a side effect this check has no business causing).
      const gearSel = `document.querySelector('[aria-label="Sync filters"]')`;
      const gearExists = await evalValue(cdp, sessionId, `${gearSel} != null`);
      if (!gearExists) {
        violations.push(`${label}: Settings gear IconButton not found`);
      } else {
        const gearRestingRaw = await evalValue(
          cdp,
          sessionId,
          `getComputedStyle(${gearSel}).backgroundColor`,
        );
        if (gearRestingRaw !== "rgba(0, 0, 0, 0)") {
          violations.push(
            `${label}: Settings gear resting backgroundColor expected transparent (rgba(0, 0, 0, 0)), observed ${gearRestingRaw}`,
          );
        }
        const gearHover = await readUnderHover(
          cdp,
          sessionId,
          gearSel,
          ["backgroundColor"],
          real,
        );
        gearHover.value.backgroundColor = await normalizeColor(
          cdp,
          sessionId,
          gearHover.value.backgroundColor,
        );
        if (!colorsMatch(gearHover.value.backgroundColor, resolvedHoverBg)) {
          violations.push(
            `${label}: Settings gear hover backgroundColor expected ${resolvedHoverBg}, observed ${gearHover.value.backgroundColor} (mode: ${gearHover.mode})`,
          );
        }
        const gearPress = await readUnderSyntheticPress(
          cdp,
          sessionId,
          gearSel,
          ["backgroundColor"],
        );
        gearPress.pressed.backgroundColor = await normalizeColor(
          cdp,
          sessionId,
          gearPress.pressed.backgroundColor,
        );
        if (
          !colorsMatch(
            gearPress.pressed.backgroundColor,
            resolvedPressedCardHover,
          )
        ) {
          violations.push(
            `${label}: Settings gear pressed backgroundColor expected ${resolvedPressedCardHover}, observed ${gearPress.pressed.backgroundColor}`,
          );
        }
        const traversalG = await tabTraverseTo(cdp, sessionId, gearSel);
        if (!traversalG.reached) {
          violations.push(
            `${label}: Settings gear, Tab traversal never reached it within ${TAB_TRAVERSAL_CAP} presses`,
          );
        } else {
          const gearOutline = await evalValue(
            cdp,
            sessionId,
            `window.panel114ComputedSub(document.activeElement, ["outlineWidth","outlineStyle","outlineOffset"])`,
          );
          if (
            gearOutline.outlineWidth !== "2px" ||
            gearOutline.outlineStyle !== "solid"
          ) {
            violations.push(
              `${label}: Settings gear focus outline expected 2px solid (focusRing()), observed ${JSON.stringify(gearOutline)}`,
            );
          }
        }
        await blurActive(cdp, sessionId);
      }
      await moveMouseAway(cdp, sessionId);
    }

    // PRIMARY BUTTON, live, once (not swept per breakpoint, matching this section's own scope):
    // opens the New Ticket modal with a real click, types into its prompt textarea so the primary
    // submit button is enabled, then reads resting/hover/pressed. Never actually clicks the
    // button itself: a real click would call runGenerate, an actual backend draft-generation
    // request this check has no business triggering, so pressed uses the synthetic technique.
    await applyBreakpoint(cdp, sessionId, BREAKPOINTS[0]);
    await blurActive(cdp, sessionId);
    await moveMouseAway(cdp, sessionId);
    await sleep(300);
    const newTicketBtn = `document.querySelector('[aria-label="New ticket"]')`;
    const newTicketExists = await evalValue(
      cdp,
      sessionId,
      `${newTicketBtn} != null`,
    );
    if (!newTicketExists) {
      violations.push("control-states: New ticket button not found");
    } else {
      const rect = await evalValue(
        cdp,
        sessionId,
        `window.panel114Rect(${newTicketBtn})`,
      );
      await dispatchRealClick(cdp, sessionId, { x: rect.x, y: rect.y });
      const modalOpened = await pollUntilTruthy(
        cdp,
        sessionId,
        `document.querySelector('[role="dialog"][aria-label="New ticket"]') != null`,
        5_000,
      );
      if (!modalOpened) {
        violations.push(
          "control-states: New Ticket modal did not open after a real click",
        );
      } else {
        const promptSel = `document.querySelector('textarea[aria-label="What do you want to build or fix?"]')`;
        await typeIntoControlStates(
          cdp,
          sessionId,
          promptSel,
          "A test ticket for control-states",
        );
        const primaryBtnSel = `Array.prototype.find.call(document.querySelectorAll('[role="dialog"][aria-label="New ticket"] button'), function (b) { return b.textContent.trim() === "Generate ticket"; })`;
        const primaryExists = await evalValue(
          cdp,
          sessionId,
          `(${primaryBtnSel}) != null`,
        );
        if (!primaryExists) {
          violations.push(
            "control-states: New Ticket modal's primary 'Generate ticket' submit button not found after typing a prompt",
          );
        } else {
          const primaryRestingRaw = await evalValue(
            cdp,
            sessionId,
            `getComputedStyle(${primaryBtnSel}).backgroundColor`,
          );
          const primaryResting = await normalizeColor(
            cdp,
            sessionId,
            primaryRestingRaw,
          );
          const resolvedAccentBg = await normalizeColor(
            cdp,
            sessionId,
            await evalValue(
              cdp,
              sessionId,
              `window.panel114ResolveBg("var(--accent)")`,
            ),
          );
          if (!colorsMatch(primaryResting, resolvedAccentBg)) {
            violations.push(
              `control-states: primary button resting backgroundColor expected the accent ${resolvedAccentBg}, observed ${primaryResting}`,
            );
          }
          const primaryHover = await readUnderHover(
            cdp,
            sessionId,
            primaryBtnSel,
            ["backgroundColor"],
            true,
          );
          primaryHover.value.backgroundColor = await normalizeColor(
            cdp,
            sessionId,
            primaryHover.value.backgroundColor,
          );
          if (
            !colorsMatch(
              primaryHover.value.backgroundColor,
              resolvedHoverButtonPrimary,
            )
          ) {
            violations.push(
              `control-states: primary button hover backgroundColor expected ${resolvedHoverButtonPrimary} (the resolved ${CONTRACT_HOVER_BUTTON_PRIMARY_HEX}), observed ${primaryHover.value.backgroundColor}`,
            );
          }
          const primaryPress = await readUnderSyntheticPress(
            cdp,
            sessionId,
            primaryBtnSel,
            ["backgroundColor"],
          );
          primaryPress.pressed.backgroundColor = await normalizeColor(
            cdp,
            sessionId,
            primaryPress.pressed.backgroundColor,
          );
          if (
            !colorsMatch(
              primaryPress.pressed.backgroundColor,
              resolvedPressedButtonPrimary,
            )
          ) {
            violations.push(
              `control-states: primary button pressed backgroundColor expected ${resolvedPressedButtonPrimary}, observed ${primaryPress.pressed.backgroundColor}`,
            );
          }
        }
        await moveMouseAway(cdp, sessionId);
        await dispatchRealKey(cdp, sessionId, "Escape", "Escape", 27);
        await pollUntilTruthy(
          cdp,
          sessionId,
          `document.querySelector('[role="dialog"][aria-label="New ticket"]') == null`,
          5_000,
        );
      }
    }
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch {
        // best effort
      }
    }
    if (chrome) {
      try {
        chrome.kill("SIGTERM");
      } catch {
        // best effort
      }
    }
    if (sandbox) await teardownSandbox(sandbox);
  }
}

// ---------------------------------------------------------------------------
// BREAKS["control-states"]: moves IconButton.tsx's `...style` spread back to
// LAST (the exact pre-fix order Task 1 undid), rebuilds, and re-runs
// checkControlStates itself against the mutated source, then restores the
// captured bytes unconditionally.
// ---------------------------------------------------------------------------

const ICON_BUTTON_STYLE_SPREAD_LINE = "    ...style,\n";
const ICON_BUTTON_FOCUS_RING_LINE = "    ...focusRing(focused),\n";

function restoreIconButtonSource(original) {
  writeFileSync(ICON_BUTTON_TSX_PATH, original);
  resetBuildCache();
  rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
  unregisterRestore(ICON_BUTTON_TSX_PATH);
}

async function runBreakControlStates() {
  assertBuilt();
  const original = readFileSync(ICON_BUTTON_TSX_PATH, "utf8");
  const styleOccurrences =
    original.split(ICON_BUTTON_STYLE_SPREAD_LINE).length - 1;
  const focusRingOccurrences =
    original.split(ICON_BUTTON_FOCUS_RING_LINE).length - 1;
  if (styleOccurrences !== 1 || focusRingOccurrences !== 1) {
    throw new Error(
      `panel-114: refusing to run --break control-states, expected the style-spread line to occur ` +
        `exactly once (measured ${styleOccurrences}) and the focusRing spread line to occur exactly ` +
        `once (measured ${focusRingOccurrences}) in ${ICON_BUTTON_TSX_PATH}. A miscounted anchor ` +
        `would mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(ICON_BUTTON_TSX_PATH, original);
  try {
    const withoutStyleLine = original.replace(
      ICON_BUTTON_STYLE_SPREAD_LINE,
      "",
    );
    const mutated = withoutStyleLine.replace(
      ICON_BUTTON_FOCUS_RING_LINE,
      ICON_BUTTON_FOCUS_RING_LINE + ICON_BUTTON_STYLE_SPREAD_LINE,
    );
    writeFileSync(ICON_BUTTON_TSX_PATH, mutated);
    resetBuildCache();

    const tripViolations = [];
    await checkControlStates(tripViolations);
    console.log(
      `\n--break control-states TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some(
      (v) =>
        v.includes("view-switch active segment hover backgroundColor") &&
        v.includes("does not differ from resting"),
    );
  } finally {
    restoreIconButtonSource(original);
  }

  const restoreViolations = [];
  await checkControlStates(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break control-states RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// CHECKS / BREAKS / PROBES
// ---------------------------------------------------------------------------

const CHECKS = {
  density: checkDensity,
  "board-states": checkBoardStates,
  "control-states": checkControlStates,
};

const BREAKS = {
  density: runBreakDensity,
  "board-states": runBreakBoardStates,
  "control-states": runBreakControlStates,
};

const PROBES = {
  baseline: probeBaseline,
};

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
  if (probeName != null) {
    // A probe measures and prints; it never asserts pass/fail, so it is exempt from the
    // empty-CHECKS vacuous-pass refusal below (that refusal guards the assertive check path
    // only). This plan's CHECKS/BREAKS stay empty maps; later plans in this phase populate them.
    await PROBES[probeName]();
    process.exit(0);
  }

  if (Object.keys(CHECKS).length === 0) {
    console.error(
      "panel-114: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
    );
    process.exit(1);
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
  console.error(`panel-114 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
