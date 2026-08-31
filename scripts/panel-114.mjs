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
 * `BREAKS` still holds only `density`; later plans in this phase register the state/motion/
 * reduced-motion checks and their own break-proof legs.
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
window.panel114ComputedSub = function (el, props) {
  if (!el) return null;
  var cs = getComputedStyle(el);
  var out = {};
  props.forEach(function (p) {
    out[p] = cs[p];
  });
  return out;
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
  await sleep(50);
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
// CHECKS / BREAKS / PROBES
// ---------------------------------------------------------------------------

const CHECKS = {
  density: checkDensity,
};

const BREAKS = {
  density: runBreakDensity,
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
