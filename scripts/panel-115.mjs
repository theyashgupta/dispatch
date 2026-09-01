/**
 * Phase 115 instrument script scaffold (LUI-05/07, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92 through
 * panel-114.mjs. `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply
 * here, but prettier still formats this file.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-114.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on the user's live service at :4700, before this script boots any server or
 * spawns any real process, and there is no override flag. It runs FIRST in `main()`, before any
 * sandbox directory is created.
 *
 * SCOPE, Plan 01 claims this phase's instrument script, its port claims, and the stable
 * fully-populated panel fixture every later plan in this phase reuses. Plan 01's own deliverable
 * is the scaffold (safety preflight, sandbox spine, raw-CDP driver, the fixture set including
 * seeded multi-session/PR/activity data) plus one probe, `baseline`, that records every BEFORE
 * value the phase must report before a single source byte changes. CHECKS and BREAKS stay empty
 * maps this plan; later plans (115-02 through 115-06) register the real checks against the
 * contrast, elevation, rhythm and state surfaces this baseline records.
 *
 * Ports, unique against every existing `panel-*.mjs` and other `scripts/*.mjs` harness (verified
 * by grepping every `SANDBOX_PORT =` and `CDP_PORT =` assignment in `scripts/*.mjs` plus a live
 * `lsof` check at plan time: nothing claims 47889 or 9384): sandbox server 47889, Chrome
 * remote-debugging 9384. Never 4700.
 *
 * Usage:
 *   node scripts/panel-115.mjs                every registered check, exits non-zero on any
 *                                                violation. Refuses to exit 0 if CHECKS is empty,
 *                                                so an accidentally emptied map can never read as
 *                                                a vacuous pass.
 *   node scripts/panel-115.mjs --check <name>  one named check only. Unknown name exits non-zero
 *                                                and lists every registered name.
 *   node scripts/panel-115.mjs --break <name>  that check's OWN break: mutates the real artifact
 *                                                the check reads, confirms the SAME check function
 *                                                the real run uses reports the violation by name
 *                                                (TRIP leg), restores the captured original
 *                                                unconditionally in a `finally`, and re-confirms a
 *                                                clean pass (RESTORE leg). Never edits a source
 *                                                file without capturing and restoring its bytes.
 *   node scripts/panel-115.mjs --probe <name>  one named probe only: measures and prints, never
 *                                                asserts pass/fail. Used to record ledger values.
 *
 * Exit-code contract: 0 when every requested check reports zero violations, or when a break's
 * trip leg correctly fired and its restore leg re-passed, or when a probe completes. 1 on any
 * violation, any safety trip (`assertNoLiveService`), or a break whose trip/restore leg did not
 * behave as expected.
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
// Constants, sandbox/boot helper set. Ported from panel-114.mjs, renamed for
// this phase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

const SANDBOX_PORT = 47889;
const CDP_PORT = 9384;
const SANDBOX_PREFIX = "dispatch-panel-115-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-115-harness-fake-key-never-real";

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
      "PANEL-115-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
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
      "panel-115: removed dist/ (it may hold break-mutated output); run `npm run build`",
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
        `panel-115: the booted child did not bind ${SANDBOX_PORT} (EADDRINUSE fallback or ` +
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
// panel-114.mjs (itself ported from panel-110.mjs), renamed for this phase.
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

async function evalValue(cdp, sessionId, expression, timeoutMs = 20_000) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: false },
    sessionId,
    timeoutMs,
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
// Fixture: one fully populated panel card (every DetailPanel region at once,
// this plan's own deliverable) plus one plain comparison card in a different
// column. Field names come from src/shared/types.ts's Card/Session interface
// only. Session-shape precedent: scripts/panel-92.mjs:476 (makeSession); PR
// fixture precedent: scripts/panel-98.mjs:469 (per-session `prs`).
// ---------------------------------------------------------------------------

const FIXTURE_TIMESTAMP = "2026-08-31T12:00:00.000Z";

/** Ported from panel-92.mjs's own `makeSession`: `tmuxSession: null` (rather than an omitted
 * key) mints the LOST shape `redactCard` reads via `s.tmuxSession == null`. */
function makeSession(home, tmuxSession, ttydPort, createdAtOffsetMs) {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - createdAtOffsetMs).toISOString();
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    tmuxSession: tmuxSession ?? undefined,
    ttydPort: ttydPort ?? undefined,
    workspacePath: join(
      home,
      "workspaces",
      basename(home) + "-" + id.slice(0, 8),
    ),
  };
}

function makePr({ number, repo, state, isDraft = false, ci, title }) {
  return {
    number,
    url: `https://github.com/acme/${repo}/pull/${number}`,
    title: title ?? `panel-115 fixture PR #${number} (${repo})`,
    state,
    isDraft,
    ci,
    repo,
  };
}

/** h1, h2, prose paragraph, bulleted list, inline code span, fenced code block: exercises the
 * `.md-body` first-child/last-child margin rule and the Notice mono code surface once a later
 * plan measures them. */
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

/**
 * Builds the primary fixture card: three sessions (active, sibling, lost), two of those sessions
 * carrying PRs (one a CI-fail row), a multi-paragraph markdown description, all three muted
 * notices (`statusReason`/`startWarning`/`cleanupWarning`), a provisioning `startError`, and one
 * `previews` entry, so every panel region `DetailPanel.tsx` renders at once. Seeded on `column:
 * "done"` (the panel-92.mjs precedent): `reconcileSessions()` and the watcher's 3-strike detector
 * never touch a todo/done card whose claimed tmux session isn't live, so nothing mutates these
 * fields mid-measurement even though no real tmux server is running at all.
 */
function buildPrimaryCard(home) {
  const active = makeSession(home, "dsp-panel115-active", 48001, 9000);
  const sibling = makeSession(home, "dsp-panel115-sibling", 48002, 6000);
  const lost = makeSession(home, null, null, 3000);

  active.prs = [
    makePr({ number: 501, repo: "web", state: "open", ci: "pass" }),
    makePr({ number: 502, repo: "web", state: "open", ci: "fail" }),
  ];
  sibling.prs = [
    makePr({ number: 90, repo: "api", state: "open", ci: "pending" }),
  ];

  return {
    id: "p115-main",
    issueId: "p115-main-issue",
    identifier: "PROP-501",
    title: "Panel-115 fully populated fixture card",
    description: markdownDescription("PROP-501"),
    priority: 1,
    column: "done",
    updatedAt: FIXTURE_TIMESTAMP,
    sessions: [active, sibling, lost],
    activeSessionId: active.id,
    tmuxSession: active.tmuxSession,
    ttydPort: active.ttydPort,
    workspacePath: active.workspacePath,
    prs: active.prs,
    statusReason: "Waiting on a reviewer to approve the open pull request.",
    startWarning:
      "The initial provisioning attempt was slow, a retry succeeded on the second pass.",
    cleanupWarning:
      "Automatic workspace cleanup failed once, retry cleanup to clear the blocked repo.",
    startError: {
      step: "creating worktrees",
      stderr:
        "fatal: could not create worktree 'p115-main-active': directory already exists\n" +
        "hint: remove the stale worktree directory or run `git worktree prune` first.",
      variant: "generic",
    },
    previews: [
      {
        port: 5173,
        url: "http://localhost:5173",
        evidence: {
          pid: 51234,
          source: "cwd",
          matchedCwd: "web",
          bindAddress: "127.0.0.1:5173",
        },
      },
    ],
  };
}

function buildComparisonCard() {
  return {
    id: "p115-plain",
    issueId: "p115-plain-issue",
    identifier: "PROP-502",
    title: "Panel-115 plain comparison card",
    description: null,
    priority: 3,
    column: "todo",
    updatedAt: FIXTURE_TIMESTAMP,
  };
}

/** Four activity rows spanning distinct `type` values, including one destructive
 * (`session_lost`) so `ActivityItem`'s `EVENT_TINT` destructive glyph renders. Column names taken
 * from `src/shared/types.ts`'s `Column` union. */
function buildEventRows(cardId) {
  const now = Date.now();
  return [
    {
      cardId,
      type: "sync_in",
      fromCol: null,
      toCol: "todo",
      reason: null,
      source: "linear",
      ts: new Date(now - 5 * 60_000).toISOString(),
    },
    {
      cardId,
      type: "move_manual",
      fromCol: "todo",
      toCol: "in_progress",
      reason: null,
      source: "ui",
      ts: new Date(now - 4 * 60_000).toISOString(),
    },
    {
      cardId,
      type: "session_start",
      fromCol: null,
      toCol: null,
      reason: null,
      source: "ui",
      ts: new Date(now - 3 * 60_000).toISOString(),
    },
    {
      cardId,
      type: "session_lost",
      fromCol: null,
      toCol: null,
      reason: "tmux session no longer answered a liveness probe",
      source: "watcher",
      ts: new Date(now - 2 * 60_000).toISOString(),
    },
    {
      cardId,
      type: "move_manual",
      fromCol: "in_progress",
      toCol: "done",
      reason: null,
      source: "ui",
      ts: new Date(now - 60_000).toISOString(),
    },
  ];
}

// ---------------------------------------------------------------------------
// Breakpoints: identical to Phase 114's, so this phase's numbers stay
// diffable against the board-level ledger.
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
 * to have re-laid-out: `[data-column]` renders all six columns at every breakpoint, so polling for
 * that count rather than sleeping a fixed interval is a real re-layout signal, not a guess.
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

const FIXTURE_CARDS = [];

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93..114.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
 * every fixture card AND every fixture activity-event row directly via `node:sqlite` in the same
 * pass. `cards` shape ported from panel-114.mjs's own `seedFixtureCards`; the `events` insert is
 * new this phase, columns taken verbatim from `src/server/store/board-db.ts:465`.
 */
async function seedFixtureCards(home, cards, eventRows) {
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
      const hasEventsTable =
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'",
          )
          .get() != null;
      if (!hasCardsTable || !hasEventsTable) {
        console.log(
          `seedFixtureCards: schema not yet created after warmup attempt ${attempt}/${ATTEMPTS}, retrying`,
        );
        continue;
      }
      const insertCard = db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      );
      for (const card of cards) insertCard.run(card.id, JSON.stringify(card));

      const insertEvent = db.prepare(
        `INSERT INTO events (card_id, type, from_col, to_col, reason, source, ts)
         VALUES (@cardId, @type, @fromCol, @toCol, @reason, @source, @ts)`,
      );
      for (const row of eventRows) insertEvent.run(row);
      return;
    } finally {
      db.close();
    }
  }
  throw new Error(
    `seedFixtureCards: sqlite schema never appeared after ${ATTEMPTS} warmup-boot attempts`,
  );
}

/**
 * Boots the sandbox: builds the fixture set (primary + comparison card, plus the primary card's
 * activity rows), seeds it, boots the production server against the seeded home, and waits for
 * `GET /api/board` to answer 200 with both cards present. Returns `{ home, child, log }` for the
 * caller to hold across every breakpoint measurement and to pass to `teardownSandbox`.
 */
async function bootSandbox(label) {
  const home = makeSandboxHome(label);
  const primary = buildPrimaryCard(home);
  const comparison = buildComparisonCard();
  const cards = [primary, comparison];
  const eventRows = buildEventRows(primary.id);
  await seedFixtureCards(home, cards, eventRows);
  const boot = await bootAndWait(home);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let cardCount = 0;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/board`);
    const body = await res.json();
    cardCount = Array.isArray(body) ? body.length : (body?.cards?.length ?? 0);
    if (cardCount >= cards.length) break;
    await sleep(POLL_INTERVAL_MS);
  }
  if (cardCount < cards.length) {
    await stopServer(boot.child);
    cleanupSandboxHome(home);
    throw new Error(
      `bootSandbox: GET /api/board never reported ${cards.length} cards (last seen ${cardCount})`,
    );
  }
  return { home, child: boot.child, log: boot.log, primaryCardId: primary.id };
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
// `Runtime.evaluate` call in this file can call `window.panel115*` without
// re-sending the source text on every round trip.
// ---------------------------------------------------------------------------

const MEASURE_HELPERS_SRC = `
window.panel115FindColumn = function (column) {
  var el = document.querySelector('[data-column="' + column + '"]');
  if (!el) throw new Error("panel115: column not found: " + column);
  return el;
};
window.panel115FindCardsInColumn = function (column) {
  var col = window.panel115FindColumn(column);
  var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
  if (!scrollContainer) throw new Error("panel115: scroll container not found in " + column);
  return Array.prototype.filter.call(scrollContainer.children, function (el) {
    return el.tagName === "DIV" && /PROP-\\d+/.test(el.textContent);
  });
};
window.panel115FindCardByIdentifier = function (column, identifier) {
  var matches = window.panel115FindCardsInColumn(column).filter(function (el) {
    return el.textContent.indexOf(identifier) !== -1;
  });
  if (matches.length !== 1) {
    throw new Error(
      "panel115: identifier " + identifier + " matched " + matches.length + " card roots in " + column,
    );
  }
  return matches[0];
};
window.panel115Rect = function (el) {
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
window.panel115ComputedSub = function (el, props) {
  if (!el) return null;
  var cs = getComputedStyle(el);
  var out = {};
  props.forEach(function (p) {
    out[p] = cs[p];
  });
  return out;
};
window.panel115FindByText = function (selector, text) {
  var els = document.querySelectorAll(selector);
  for (var i = 0; i < els.length; i++) {
    if (els[i].textContent && els[i].textContent.indexOf(text) !== -1) return els[i];
  }
  return null;
};
// DetailPanel.tsx's <aside> stays permanently mounted (never conditionally rendered) to protect
// the embedded terminal iframe's identity across open/close (the PANEL-03 invariant); open is
// expressed only via transform: translateX(100%) sliding it fully off-screen, never by removing
// it from the DOM. querySelector(...) == null can therefore NEVER become true and is not a usable
// closed-signal; this reads the element's own resolved transform and bounding rect instead.
window.panel115DetailPanelOpen = function () {
  var aside = document.querySelector('aside[aria-label="Ticket detail"]');
  if (!aside) return false;
  var r = aside.getBoundingClientRect();
  return r.width > 0 && r.left < window.innerWidth && r.right > 0;
};
window.panel115DetailPanelTransform = function () {
  var aside = document.querySelector('aside[aria-label="Ticket detail"]');
  if (!aside) return null;
  return getComputedStyle(aside).transform;
};
/** Chrome's computed-style serialization of a color-mix() result is NOT a stable "rgb(r, g, b)"
 * string: depending on the exact cascade path it may report "color(srgb ...)" or "oklab(...)".
 * Round-trips through a canvas 1x1-pixel fill/readback instead, the one technique that resolves
 * ANY valid CSS <color> syntax to actual composited sRGB bytes regardless of the serialization
 * format Chrome chose (114-01 finding, ported verbatim). */
window.panel115NormalizeColor = function (raw) {
  if (raw == null) return raw;
  var canvas =
    window.__panel115ColorCanvas ||
    (window.__panel115ColorCanvas = document.createElement("canvas"));
  canvas.width = 1;
  canvas.height = 1;
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  var d = ctx.getImageData(0, 0, 1, 1).data;
  return "rgba(" + d[0] + ", " + d[1] + ", " + d[2] + ", " + (d[3] / 255).toFixed(3) + ")";
};
/** Direct children of the FIRST \`.reading-surface\` under the open panel (the ReferenceBlocks +
 * CardTimeline container): the vertical gap between each adjacent sibling pair, computed as
 * next.top - prev.bottom, exactly the LUI-05 finding plan 115-03 closes. Entry 0 is the
 * container's OWN padding-box top to the first child's top (never a sibling-margin collapse,
 * since a non-zero parent padding always blocks parent/child margin collapse), included because
 * every block-to-block sibling pair here collapses to the SAME 16px (\`ReferenceBlocks.tsx\`'s
 * "Pull Requests"/notices/start-error/CardTimeline blocks all declare a one-sided
 * \`var(--space-lg)\` margin, and the only zero-margin block, the description, never sits between
 * two zero-margin neighbours, so CSS's max-of-adjoining-margins collapse rule always resolves to
 * 16 for THIS fixture's block combination) while the container's own \`--space-xl\` (24px)
 * padding-top is genuinely different, an honest measured example of the ad hoc, non-uniform
 * rhythm 115-03 closes. Each entry also carries a short text snippet of both elements so the
 * ledger stays human-readable without re-deriving DOM order by hand. */
window.panel115ReferenceBlockGaps = function () {
  var container = document.querySelector(
    'aside[aria-label="Ticket detail"] .reading-surface',
  );
  if (!container) return [];
  var children = Array.prototype.filter.call(container.children, function (el) {
    return el.getBoundingClientRect().height > 0;
  });
  var gaps = [];
  if (children.length > 0) {
    var containerRect = container.getBoundingClientRect();
    var firstRect = children[0].getBoundingClientRect();
    gaps.push({
      index: 0,
      gap: firstRect.top - containerRect.top,
      prevSnippet: "(container border-box top, includes --space-xl padding-top)",
      nextSnippet: (children[0].textContent || "").trim().slice(0, 40),
    });
  }
  for (var i = 1; i < children.length; i++) {
    var prevRect = children[i - 1].getBoundingClientRect();
    var nextRect = children[i].getBoundingClientRect();
    gaps.push({
      index: i,
      gap: nextRect.top - prevRect.bottom,
      prevSnippet: (children[i - 1].textContent || "").trim().slice(0, 40),
      nextSnippet: (children[i].textContent || "").trim().slice(0, 40),
    });
  }
  return gaps;
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
 * has no hover input, the same "rendered-state" honesty convention Phase 113/114 used. Returns the
 * computed sub-style read while the hover is active. Ported for later plans in this phase; not
 * called by this plan's own `baseline` probe. */
async function readUnderHover(cdp, sessionId, elExpr, props, real) {
  if (real) {
    const rect = await evalValue(
      cdp,
      sessionId,
      `window.panel115Rect(${elExpr})`,
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
      `window.panel115ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
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
    `window.panel115ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
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
 * Returns `{ reached, tabCount }`. Ported for later plans in this phase. */
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

/** Tolerance for float px comparisons: CDP's `getBoundingClientRect`/`getComputedStyle` reads are
 * exact for fixed-px values in practice, but a hairline tolerance absorbs any genuine sub-pixel
 * rendering jitter without masking a real regression. Ported for later plans in this phase; the
 * `baseline` probe itself never asserts and has no need of it yet. */
const DENSITY_PX_TOLERANCE = 0.05;
void DENSITY_PX_TOLERANCE;

/** A `color-mix()` value read from an isolated probe element and the SAME token as actually
 * composited on a real, styled element were observed LIVE (Phase 114) to differ by 1-2 sRGB
 * levels per channel, a genuine sub-pixel color-space rounding difference, not a measurement bug.
 * `COLOR_TOLERANCE` absorbs that jitter without masking a real palette regression. Ported for
 * later plans in this phase. */
const COLOR_TOLERANCE = 3;

/** Parses a `getComputedStyle`/`panel115NormalizeColor`-style `"rgb(r, g, b)"` or
 * `"rgba(r, g, b, a)"` string into a 4-channel `[r, g, b, a255]` (alpha scaled to 0-255 so the
 * same tolerance applies to all four channels), or `null` if the string is not one of those two
 * exact shapes (e.g. `"none"`). */
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
 * within {@link COLOR_TOLERANCE} per channel, alpha included. */
function colorsMatch(a, b) {
  if (a === b) return true;
  const pa = parseRgbTriple(a);
  const pb = parseRgbTriple(b);
  if (pa == null || pb == null) return false;
  return pa.every((v, i) => Math.abs(v - pb[i]) <= COLOR_TOLERANCE);
}
void colorsMatch;

/** Round-trips a raw `getComputedStyle` color string through `window.panel115NormalizeColor`'s
 * canvas-pixel technique, so every color comparison in this file's probe compares actual
 * composited bytes rather than Chrome's own (format-unstable) computed-style serialization. */
async function normalizeColor(cdp, sessionId, raw) {
  if (raw == null) return raw;
  return evalValue(
    cdp,
    sessionId,
    `window.panel115NormalizeColor(${JSON.stringify(raw)})`,
  );
}

// ---------------------------------------------------------------------------
// baseline probe: opens the fully populated fixture card's detail panel at
// each breakpoint and records every BEFORE value later plans in this phase
// retune against. Never asserts pass/fail: this is a measurement probe, not
// a check.
// ---------------------------------------------------------------------------

/**
 * Opens the panel on the primary fixture card via a real trusted click, confirms the open state
 * by reading the aside's resolved transform (PANEL-03: never a DOM-presence query). This
 * fixture's active session carries a live `tmuxSession`, so `hasLiveSession` is true and
 * `ReferenceBlocks`/`CardTimeline` render only once the header's "Details" toggle is expanded;
 * clicks it when present so the rest of this probe reads everything in one settled DOM snapshot
 * instead of requiring a second interaction later plans would each have to reproduce.
 */
async function openPrimaryCardPanel(cdp, sessionId) {
  const cardExpr = `window.panel115FindCardByIdentifier("done", "PROP-501")`;
  // Below CAROUSEL_QUERY's 1023px threshold (useMediaQuery.ts:12) Board.tsx swaps to a
  // horizontally scrolling column carousel (overflowX: auto); the "done" column can sit fully
  // off-screen at BP-C/BP-D, so a real click at its own (still-correct) getBoundingClientRect()
  // lands outside the viewport and never reaches the card. Board.tsx's own `handlePillSelect`
  // scrolls a column into view via `scrollIntoView`; this does the same for the fixture column
  // before measuring, an instant (non-smooth) scroll so no animation settle time is needed.
  await evalValue(
    cdp,
    sessionId,
    `window.panel115FindColumn("done").scrollIntoView({ behavior: "instant", inline: "start", block: "nearest" })`,
  );
  await sleep(50);
  const rect = await evalValue(
    cdp,
    sessionId,
    `window.panel115Rect(${cardExpr})`,
  );
  await dispatchRealClick(cdp, sessionId, { x: rect.x, y: rect.y });
  const opened = await pollUntilTruthy(
    cdp,
    sessionId,
    `window.panel115DetailPanelOpen()`,
    5_000,
  );
  if (!opened) {
    throw new Error("openPrimaryCardPanel: panel did not open within 5000ms");
  }
  // `window.panel115DetailPanelOpen()` is satisfied as soon as the aside's slide-in transform
  // starts moving (any nonzero on-screen overlap), well before the 200ms `--motion-panel-open`
  // transition finishes; a click dispatched against a rect read mid-slide misses the "Details"
  // button's real (still-animating) on-screen position. Settling past the transition before
  // reading its rect is required, not just tidy, a live run without this sleep clicked the wrong
  // point and the toggle's `aria-expanded` never flipped.
  await sleep(250);
  // Scoped to the aside: CardView.tsx:542 renders its own unrelated "Details" text on a board
  // card (a session-count disclosure), which sits earlier in DOM order than the panel's own
  // header toggle. An unscoped `document.querySelectorAll("button")` text search matches that
  // board-level button first, a real collision discovered live while developing this probe (the
  // click landed on a board card instead of the panel header and the toggle never flipped).
  const detailsToggleExpr = `window.panel115FindByText('aside[aria-label="Ticket detail"] button', "Details")`;
  const detailsToggle = await evalValue(
    cdp,
    sessionId,
    `${detailsToggleExpr} != null`,
  );
  if (detailsToggle) {
    const toggleRect = await evalValue(
      cdp,
      sessionId,
      `window.panel115Rect(${detailsToggleExpr})`,
    );
    await dispatchRealClick(cdp, sessionId, {
      x: toggleRect.x,
      y: toggleRect.y,
    });
    const expanded = await pollUntilTruthy(
      cdp,
      sessionId,
      `${detailsToggleExpr}.getAttribute("aria-expanded") === "true"`,
      2_000,
    );
    if (!expanded) {
      throw new Error(
        "openPrimaryCardPanel: Details toggle click did not flip aria-expanded within 2000ms",
      );
    }
  }
  return opened;
}

async function closePrimaryCardPanel(cdp, sessionId) {
  await dispatchRealKey(cdp, sessionId, "Escape", "Escape", 27);
  await pollUntilTruthy(
    cdp,
    sessionId,
    `!window.panel115DetailPanelOpen()`,
    5_000,
  );
}

/** Every BEFORE reading the interfaces block's expectation table names, for one breakpoint. */
async function measurePanel(cdp, sessionId) {
  const asideExpr = `document.querySelector('aside[aria-label="Ticket detail"]')`;
  const h1Expr = `document.querySelector('aside[aria-label="Ticket detail"] h1')`;

  const asideBackgroundRaw = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(${asideExpr}).backgroundColor`,
  );
  const asideBackground = await normalizeColor(
    cdp,
    sessionId,
    asideBackgroundRaw,
  );
  const asideTransform = await evalValue(
    cdp,
    sessionId,
    `window.panel115DetailPanelTransform()`,
  );

  const headerRowExpr = `${h1Expr}.parentElement.parentElement`;
  const headerPadding = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(${headerRowExpr}).padding`,
  );
  const headerHeight = await evalValue(
    cdp,
    sessionId,
    `${headerRowExpr}.getBoundingClientRect().height`,
  );
  const identifierGap = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var h1 = ${h1Expr};
      var idEl = h1.previousElementSibling;
      if (!idEl) return null;
      return h1.getBoundingClientRect().left - idEl.getBoundingClientRect().right;
    })()`,
  );
  const h1Style = await evalValue(
    cdp,
    sessionId,
    `window.panel115ComputedSub(${h1Expr}, ["fontSize","fontWeight","lineHeight"])`,
  );
  const h1Height = await evalValue(
    cdp,
    sessionId,
    `${h1Expr}.getBoundingClientRect().height`,
  );

  const identifierFieldStyle = await evalValue(
    cdp,
    sessionId,
    `window.panel115ComputedSub(${h1Expr}.previousElementSibling, ["fontSize","fontWeight","color","fontFamily"])`,
  );
  const sectionFieldEl = `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Pull Requests")`;
  const sectionFieldStyle = await evalValue(
    cdp,
    sessionId,
    `window.panel115ComputedSub(${sectionFieldEl}, ["fontSize","fontWeight","color"])`,
  );
  const mutedLabelEl = `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Status")`;
  const mutedLabelStyle = await evalValue(
    cdp,
    sessionId,
    `window.panel115ComputedSub(${mutedLabelEl}, ["fontSize","fontWeight","color"])`,
  );

  const readingSurfacePadding = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var el = document.querySelector('aside[aria-label="Ticket detail"] .reading-surface');
      return el ? getComputedStyle(el).padding : null;
    })()`,
  );
  const mdBodyLineHeight = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var p = document.querySelector('aside[aria-label="Ticket detail"] .md-body p');
      return p ? getComputedStyle(p).lineHeight : null;
    })()`,
  );

  const referenceBlockGaps = await evalValue(
    cdp,
    sessionId,
    `window.panel115ReferenceBlockGaps()`,
  );

  const sessionGroupExpr = `document.querySelector('aside[aria-label="Ticket detail"] [role="group"][aria-label="Sessions"]')`;
  const sessionSwitcherButtonCount = await evalValue(
    cdp,
    sessionId,
    `${sessionGroupExpr} ? ${sessionGroupExpr}.querySelectorAll("button").length : 0`,
  );
  const sessionSwitcherHeight = await evalValue(
    cdp,
    sessionId,
    `${sessionGroupExpr} ? ${sessionGroupExpr}.getBoundingClientRect().height : null`,
  );
  const sessionSwitcherBgRaw = await evalValue(
    cdp,
    sessionId,
    `${sessionGroupExpr} ? getComputedStyle(${sessionGroupExpr}).backgroundColor : null`,
  );
  const sessionSwitcherBackground = await normalizeColor(
    cdp,
    sessionId,
    sessionSwitcherBgRaw,
  );
  const sessionSwitcherRowPadding = await evalValue(
    cdp,
    sessionId,
    `${sessionGroupExpr} ? getComputedStyle(${sessionGroupExpr}.parentElement.parentElement).padding : null`,
  );

  const prListRowCount = await evalValue(
    cdp,
    sessionId,
    `document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-label^="Open PR"]').length`,
  );
  const mutedNoticeLabelCount = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var labels = ["Status", "Start warning", "Cleanup"];
      return labels.filter(function (t) {
        return window.panel115FindByText('aside[aria-label="Ticket detail"] span', t) != null;
      }).length;
    })()`,
  );
  const provisioningErrorPresent = await evalValue(
    cdp,
    sessionId,
    `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Provisioning error") != null`,
  );
  const previewRowCount = await evalValue(
    cdp,
    sessionId,
    `document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-label^="Open localhost"]').length`,
  );
  const activityLabelPresent = await evalValue(
    cdp,
    sessionId,
    `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Activity") != null`,
  );
  const timelineRowCount = await evalValue(
    cdp,
    sessionId,
    `document.querySelectorAll('#card-timeline-region > div').length`,
  );

  const columnBgRaw = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(window.panel115FindColumn("done")).backgroundColor`,
  );
  const columnBackground = await normalizeColor(cdp, sessionId, columnBgRaw);
  const cardBgRaw = await evalValue(
    cdp,
    sessionId,
    `getComputedStyle(window.panel115FindCardByIdentifier("done", "PROP-501")).backgroundColor`,
  );
  const cardBackground = await normalizeColor(cdp, sessionId, cardBgRaw);

  return {
    asideBackground,
    asideTransform,
    header: {
      padding: headerPadding,
      height: headerHeight,
      identifierGap,
      h1: { ...h1Style, height: h1Height },
    },
    fieldVariants: {
      identifierMono: identifierFieldStyle,
      section: sectionFieldStyle,
      mutedLabel: mutedLabelStyle,
    },
    readingSurface: { padding: readingSurfacePadding, mdBodyLineHeight },
    referenceBlockGaps,
    sessionSwitcher: {
      buttonCount: sessionSwitcherButtonCount,
      height: sessionSwitcherHeight,
      background: sessionSwitcherBackground,
      rowPadding: sessionSwitcherRowPadding,
    },
    contentPresence: {
      prListRowCount,
      mutedNoticeLabelCount,
      provisioningErrorPresent,
      previewRowCount,
      activityLabelPresent,
      timelineRowCount,
    },
    boardSurfaces: { columnBackground, cardBackground },
  };
}

/**
 * Boots the sandbox, opens the fully populated fixture card's detail panel in real headless
 * Chrome, and at each of the four breakpoints records every panel surface the interfaces block's
 * expectation table names, printing the full record as JSON. Never asserts pass/fail: this is a
 * measurement probe, not a check, its job is to record what ships TODAY before a single source
 * byte changes.
 */
async function probeBaseline() {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  const record = {};
  try {
    console.log("panel-115 --probe baseline: booting sandbox");
    sandbox = await bootSandbox("baseline");
    console.log(
      `panel-115 --probe baseline: sandbox home ${sandbox.home}, launching Chrome`,
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
    // Splash.tsx runs an unconditional 1.3s full-screen overlay on every mount (113-03/114-01's
    // own gotcha); settle past it before the first breakpoint measurement.
    await sleep(1450);

    // The panel is opened exactly ONCE, at the first breakpoint, and never closed/reopened
    // between breakpoints: DetailPanel.tsx re-layouts an already-open panel in place on resize
    // (it never unmounts, PANEL-03), so nothing about a viewport resize requires a new open. This
    // is deliberate, not an optimization: closing across the >=1024px/<1024px carousel boundary
    // (BP-B -> BP-C, BP-C -> BP-D) drives DetailPanel.tsx's own `window.history.back()`/
    // `pushState` pair, and reopening immediately afterward reproduced a genuine renderer wedge
    // live during this plan's own harness development (`CDP.send: no response to
    // Runtime.evaluate ... the renderer likely stalled`), matching panel-114.mjs's own
    // DETAIL-PANEL FINDING (a wedge under history-navigation system contention at a narrow
    // breakpoint). Opening once and only resizing underneath it avoids that churn entirely.
    let panelOpened = false;
    for (const bp of BREAKPOINTS) {
      console.log(`panel-115 --probe baseline: measuring ${bp.label}`);
      await applyBreakpoint(cdp, sessionId, bp);
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(300);
      if (!panelOpened) {
        await openPrimaryCardPanel(cdp, sessionId);
        panelOpened = true;
      } else {
        await sleep(HOVER_SETTLE_MS);
      }
      const panel = await measurePanel(cdp, sessionId);
      record[bp.label] = panel;
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
// rhythm: break-proven check for Plan 03's shared panel section-rhythm token
// (LUI-05). Boots the sandbox once, asserts the landed --panel-section-gap
// value between every adjacent reading-surface sibling pair at all four
// breakpoints, the description block's own gap by name (the exact
// flush-description regression LUI-05 closes), the v2.9 reading-surface
// padding/line-height contract rows staying in force, and the header/h1
// verdicts 115-03's own ledger recorded as UNCHANGED (Task 2).
// ---------------------------------------------------------------------------

/** Landed value, tokens.css's own `--panel-section-gap`. */
const PANEL_SECTION_GAP_PX = 16;
/** `.reading-surface`'s own `--space-xl` padding-top: gap index 0 in
 * `panel115ReferenceBlockGaps()`'s output, unaffected by the flex `gap` declaration (which only
 * applies between children, never before the first one). */
const READING_SURFACE_PADDING_TOP_PX = 24;
/** Sub-pixel tolerance for float px comparisons, the panel-114 `assertDensityPx` precedent. */
const RHYTHM_PX_TOLERANCE = 0.05;

function assertRhythmPx(violations, bp, label, expected, observed) {
  if (Math.abs(observed - expected) > RHYTHM_PX_TOLERANCE) {
    violations.push(
      `rhythm(${bp.label}): ${label} expected ${expected}px, observed ${observed}px`,
    );
  }
}

function assertRhythmExact(violations, bp, label, expected, observed) {
  if (observed !== expected) {
    violations.push(
      `rhythm(${bp.label}): ${label} expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`,
    );
  }
}

/**
 * Boots the sandbox, opens the fully populated fixture card's detail panel, and at each of the
 * four breakpoints asserts: every adjacent reading-surface sibling gap equals
 * `--panel-section-gap` (16px, sub-pixel tolerance), the description block's own gap to both
 * neighbours is non-zero (named separately from the generic loop), `.reading-surface`'s padding
 * and `.md-body` line-height stay at their v2.9 values, and the header row padding / `h1`
 * fontSize/fontWeight/lineHeight match Task 2's UNCHANGED verdicts.
 */
async function checkRhythm(violations) {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  try {
    sandbox = await bootSandbox("check-rhythm");
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
      violations.push("rhythm: #root never appeared after navigation");
      return;
    }
    // Splash.tsx's unconditional 1.3s overlay, same settle window probeBaseline/checkDensity use.
    await sleep(1450);

    const h1Expr = `document.querySelector('aside[aria-label="Ticket detail"] h1')`;
    const headerRowExpr = `${h1Expr}.parentElement.parentElement`;

    // Same open-once-per-run discipline as probeBaseline: DetailPanel.tsx re-layouts an
    // already-open panel in place on resize, and closing/reopening across the carousel boundary
    // reproduces the DETAIL-PANEL FINDING renderer wedge (115-01/panel-114 precedent).
    let panelOpened = false;
    for (const bp of BREAKPOINTS) {
      await applyBreakpoint(cdp, sessionId, bp);
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(300);
      if (!panelOpened) {
        await openPrimaryCardPanel(cdp, sessionId);
        panelOpened = true;
      } else {
        await sleep(HOVER_SETTLE_MS);
      }

      const gaps = await evalValue(
        cdp,
        sessionId,
        `window.panel115ReferenceBlockGaps()`,
      );
      if (gaps.length === 0) {
        violations.push(
          `rhythm(${bp.label}): no reading-surface children found, cannot measure section rhythm`,
        );
      } else {
        assertRhythmPx(
          violations,
          bp,
          "reading-surface top padding (gap index 0)",
          READING_SURFACE_PADDING_TOP_PX,
          gaps[0].gap,
        );
        for (let i = 1; i < gaps.length; i++) {
          assertRhythmPx(
            violations,
            bp,
            `sibling gap ${i} (${gaps[i].prevSnippet.slice(0, 20)} -> ${gaps[i].nextSnippet.slice(0, 20)})`,
            PANEL_SECTION_GAP_PX,
            gaps[i].gap,
          );
        }
        // Named separately from the generic loop above: this is the exact regression LUI-05
        // motivates, a description block sitting flush (zero gap) against its neighbour. Gap
        // index 1 is PrList -> description; gap index 2 is description -> the next notice.
        if (gaps.length > 1 && gaps[1].gap <= 0) {
          violations.push(
            `rhythm(${bp.label}): flush-description violation, the description block has a ${gaps[1].gap}px gap to its previous sibling (expected ${PANEL_SECTION_GAP_PX}px)`,
          );
        }
        if (gaps.length > 2 && gaps[2].gap <= 0) {
          violations.push(
            `rhythm(${bp.label}): flush-description violation, the description block has a ${gaps[2].gap}px gap to its next sibling (expected ${PANEL_SECTION_GAP_PX}px)`,
          );
        }
      }

      const readingSurfacePadding = await evalValue(
        cdp,
        sessionId,
        `(function () {
          var el = document.querySelector('aside[aria-label="Ticket detail"] .reading-surface');
          return el ? getComputedStyle(el).padding : null;
        })()`,
      );
      assertRhythmExact(
        violations,
        bp,
        "reading-surface padding (v2.9, in force)",
        "24px 16px",
        readingSurfacePadding,
      );
      const mdBodyLineHeight = await evalValue(
        cdp,
        sessionId,
        `(function () {
          var p = document.querySelector('aside[aria-label="Ticket detail"] .md-body p');
          return p ? getComputedStyle(p).lineHeight : null;
        })()`,
      );
      assertRhythmExact(
        violations,
        bp,
        "md-body resolved line-height (v2.9, in force)",
        "20.8px",
        mdBodyLineHeight,
      );

      const headerPadding = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${headerRowExpr}).padding`,
      );
      assertRhythmExact(
        violations,
        bp,
        "header row resolved padding (Task 2: UNCHANGED)",
        "8px 16px 8px 24px",
        headerPadding,
      );
      const h1Style = await evalValue(
        cdp,
        sessionId,
        `window.panel115ComputedSub(${h1Expr}, ["fontSize","fontWeight","lineHeight"])`,
      );
      assertRhythmExact(
        violations,
        bp,
        "h1 resolved fontSize (Task 2: UNCHANGED)",
        "17px",
        h1Style.fontSize,
      );
      assertRhythmExact(
        violations,
        bp,
        "h1 resolved fontWeight (Task 2: UNCHANGED)",
        "600",
        h1Style.fontWeight,
      );
      assertRhythmExact(
        violations,
        bp,
        "h1 resolved lineHeight (Task 2: UNCHANGED)",
        "22.1px",
        h1Style.lineHeight,
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
// BREAKS["rhythm"]: mutates the real flex-gap declaration Task 1 landed on
// the hasLiveSession reading-surface wrapper (DetailPanel.tsx), the wrapper
// this fixture's card actually renders through (its session carries a live
// tmuxSession and the harness expands Details), rebuilds, and re-runs
// checkRhythm itself against the mutated source, then restores the captured
// bytes unconditionally.
// ---------------------------------------------------------------------------

const DETAIL_PANEL_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "detail",
  "DetailPanel.tsx",
);
// 26-space indent is unique to the hasLiveSession wrapper; the sibling reading-surface wrapper
// carries the identical property at 24-space indent. Confirmed by the exact occurrence-count
// guard below before any mutation runs.
const RHYTHM_BREAK_TARGET =
  '                          gap: "var(--panel-section-gap)",\n';

function restoreDetailPanelSource(original) {
  writeFileSync(DETAIL_PANEL_PATH, original);
  resetBuildCache();
  rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });
  unregisterRestore(DETAIL_PANEL_PATH);
}

async function runBreakRhythm() {
  assertBuilt();
  const original = readFileSync(DETAIL_PANEL_PATH, "utf8");
  const occurrences = original.split(RHYTHM_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel-115: refusing to run --break rhythm, expected the hasLiveSession wrapper's gap ` +
        `declaration to occur exactly once in ${DETAIL_PANEL_PATH}, measured ${occurrences}. A ` +
        `miscounted anchor would mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(DETAIL_PANEL_PATH, original);
  try {
    writeFileSync(DETAIL_PANEL_PATH, original.replace(RHYTHM_BREAK_TARGET, ""));
    resetBuildCache();

    const tripViolations = [];
    await checkRhythm(tripViolations);
    console.log(
      `\n--break rhythm TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) => v.includes("flush-description"));
  } finally {
    restoreDetailPanelSource(original);
  }

  const restoreViolations = [];
  await checkRhythm(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break rhythm RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// CHECKS / BREAKS / PROBES.
// ---------------------------------------------------------------------------

const CHECKS = {
  rhythm: checkRhythm,
};

const BREAKS = {
  rhythm: runBreakRhythm,
};

const PROBES = {
  baseline: probeBaseline,
};

// Silence no-unused-vars for spine identifiers ported ahead of the checks that will call them
// (states/elevation, 115-04 onward), matching this file's own doc-block explanation of the
// port-now-use-later shape.
void evalAsyncValue;
void readUnderHover;
void tabTraverseTo;
void closePrimaryCardPanel;

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
      "panel-115: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
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

void FIXTURE_CARDS;

main().catch((err) => {
  console.error(`panel-115 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
