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

/** Delay between `rmSyncRetry` attempts: long enough for a just-killed Chrome to finish its
 * exit-time lock/lease file writes, short enough to cost at most ~1s per teardown. */
const RM_RETRY_DELAY_MS = 200;

/**
 * `rmSync(..., { recursive: true, force: true })` still throws `ENOTEMPTY` on macOS when a just-
 * killed process (Chrome's own exit-time lock/lease file writes) races the removal; retried with
 * a short sleep between attempts. A still-failing final attempt LOGS and returns instead of
 * throwing: every caller is teardown code running in or under a `finally`, where a throw would
 * replace the run's real error with an inscrutable ENOTEMPTY and leak the directory anyway.
 */
async function rmSyncRetry(path, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === attempts) {
        console.log(
          `rmSyncRetry: giving up on ${path} after ${attempts} attempts (${err.code ?? err.message}); remove it by hand`,
        );
        return;
      }
      await sleep(RM_RETRY_DELAY_MS);
    }
  }
}

/** Best-effort sandbox home cleanup, called from a `finally` so a failing run never leaks a temp
 * directory. */
async function cleanupSandboxHome(home) {
  if (home == null) return;
  await rmSyncRetry(home);
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

/** Ported from panel-92.mjs's own `makeSession`: a missing `tmuxSession` mints the LOST shape.
 * The `?? undefined` below plus `JSON.stringify` means the seeded card stores an OMITTED
 * `tmuxSession` key (not a literal `null`); `redactCard`'s `s.tmuxSession == null` matches
 * both shapes, so the distinction is invisible at run time. */
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
 *
 * On any failure after the home is created, stops whatever booted and removes the home before
 * rethrowing: callers assign `sandbox = await bootSandbox(...)` inside their try, so on a throw
 * their `finally` sees `sandbox` still null and skips `teardownSandbox`; without this cleanup a
 * leaked (non-detached) server child would hold port 47889 (SANDBOX_PORT) and fail every later run's
 * marker guard until killed by hand.
 */
async function bootSandbox(label) {
  const home = makeSandboxHome(label);
  let boot = null;
  try {
    const primary = buildPrimaryCard(home);
    const comparison = buildComparisonCard();
    const cards = [primary, comparison];
    const eventRows = buildEventRows(primary.id);
    await seedFixtureCards(home, cards, eventRows);
    boot = await bootAndWait(home);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let cardCount = 0;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/board`);
        const body = await res.json();
        cardCount = Array.isArray(body)
          ? body.length
          : (body?.cards?.length ?? 0);
        if (cardCount >= cards.length) break;
      } catch {
        // transient fetch/parse failure while the server settles: "not ready
        // yet" (waitForReady's own idiom), never a boot abort
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (cardCount < cards.length) {
      throw new Error(
        `bootSandbox: GET /api/board never reported ${cards.length} cards (last seen ${cardCount})`,
      );
    }
    return {
      home,
      child: boot.child,
      log: boot.log,
      primaryCardId: primary.id,
    };
  } catch (err) {
    if (boot != null) await stopServer(boot.child);
    await cleanupSandboxHome(home);
    throw err;
  }
}

/** Stops the server, waits for the port to stop listening, and cleans the Chrome user-data dir
 * plus the sandbox home. Best-effort throughout, never throws: an already-gone resource is a
 * no-op and a removal that keeps failing logs and continues (see `rmSyncRetry`). Callers must
 * await Chrome's own exit (`stopServer(chrome)`) BEFORE calling this, or the user-data-dir
 * removal races Chrome's exit-time lock/lease writes. */
async function teardownSandbox({ home, child }) {
  await stopServer(child);
  const deadline = Date.now() + 5_000;
  while ((await isPortListening(SANDBOX_PORT)) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
  }
  await rmSyncRetry(chromeUserDataDir());
  await cleanupSandboxHome(home);
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
/** Resolves any CSS <color>-producing \`cssValue\` (a bare token, a color-mix(), a literal) to its
 * computed \`background-color\` string via a throwaway off-screen probe element, ported from
 * panel-114.mjs's \`panel114ResolveBg\`. Callers round-trip the result through
 * \`panel115NormalizeColor\` for a stable, format-independent comparison. */
window.panel115ResolveBg = function (cssValue) {
  var probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;pointer-events:none;background:" + cssValue;
  document.body.appendChild(probe);
  var value = getComputedStyle(probe).backgroundColor;
  document.body.removeChild(probe);
  return value;
};
/** Same technique as {@link window.panel115ResolveBg}, resolving the LEFT border's color instead:
 * DetailPanel.tsx's own resize handle is styled via \`borderLeft\`, not \`background\`, ported from
 * panel-114.mjs's \`panel114ResolveBorderRightColor\` (that board handle uses \`borderRight\`). */
window.panel115ResolveBorderLeftColor = function (cssValue) {
  var probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;pointer-events:none;border-left:2px solid " +
    cssValue;
  document.body.appendChild(probe);
  var value = getComputedStyle(probe).borderLeftColor;
  document.body.removeChild(probe);
  return value;
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

/**
 * Rendered-state pressed read: dispatches `pointerdown`/`pointerup` directly via `dispatchEvent`,
 * never through CDP's `Input` domain, ported verbatim from panel-114.mjs's `readUnderSyntheticPress`.
 * A real CDP `mousePressed`/`mouseReleased` at the same point fires a real trusted `click`
 * afterward; every panel-local control this plan measures has an `onClick` side effect the check
 * has no business causing (`switchSession`, `window.open`, panel toggles), so this synthetic
 * dispatch (which never synthesizes a `click`) is the uniform safe technique here, the same reason
 * 114-05 used it for the board's view-switch segment. Returns `{ pressed, after }`, both resolved
 * via `panel115ComputedSub`.
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
    `window.panel115ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
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
    `window.panel115ComputedSub(${elExpr}, ${JSON.stringify(props)})`,
  );
  return { pressed, after };
}

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
        // Await Chrome's actual exit (SIGKILL escalation included) so the
        // user-data-dir removal in teardownSandbox below cannot race its
        // exit-time lock/lease writes.
        await stopServer(chrome);
      } catch {
        // best effort
      }
    }
    if (sandbox) await teardownSandbox(sandbox);
  }
}

// ---------------------------------------------------------------------------
// PROBES.surfaces (Plan 116-03): a detail-panel-wide governed-property
// sweep, ported in shape from panel-114.mjs's own PROBES.surfaces (Plan
// 116-02). A PROBE, never a CHECK: it measures and prints, it never asserts
// pass or fail. Covers every src/web/features/detail/*.tsx file (11 total).
// ---------------------------------------------------------------------------

/** The one property set the generic reader below reads off every resolved surface root, matching
 * this plan's own governed-property list verbatim (identical set to panel-114.mjs's own
 * SURFACE_GOVERNED_PROPS). */
const SURFACE_GOVERNED_PROPS = [
  "fontSize",
  "fontWeight",
  "fontFamily",
  "lineHeight",
  "borderRadius",
  "backgroundColor",
  "color",
  "borderColor",
  "boxShadow",
  "padding",
  "gap",
  "outline",
  "transition",
];

/**
 * ONE generic reader for every detail-panel surface descriptor, ported in shape from
 * panel-114.mjs's own `readSurface` (Plan 116-02): resolves an element via a live JS expression,
 * asserts UNIQUENESS then SHAPE, and only reads governed CSS properties off an element that
 * passed both (T-116-05). A failed assertion records ROOT-FAIL with a written reason, never a
 * reading taken from an unasserted element.
 *
 * @remarks
 * Unlike the board reader, every color-bearing property this function reads
 * (backgroundColor/color/borderColor) is round-tripped through this file's own `normalizeColor`
 * afterward: several panel surfaces resolve `color-mix()` resting tints (the active
 * session-switcher segment, the resize handle's hover/pressed border) whose computed-style
 * serialization is not one stable string (the 114-01 finding, in force here too).
 */
async function readSurface(
  cdp,
  sessionId,
  surface,
  part,
  resolverExpr,
  uniquenessExpr,
  shapeExprTemplate,
) {
  let uniqueOk;
  try {
    uniqueOk = await evalValue(cdp, sessionId, uniquenessExpr);
  } catch (err) {
    return {
      surface,
      part,
      status: "ROOT-FAIL",
      reason: `uniqueness assertion threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!uniqueOk) {
    return {
      surface,
      part,
      status: "ROOT-FAIL",
      reason: `uniqueness assertion failed: ${uniquenessExpr}`,
    };
  }
  const shapeExpr = shapeExprTemplate.split("$EL").join(`(${resolverExpr})`);
  let shapeOk;
  try {
    shapeOk = await evalValue(cdp, sessionId, shapeExpr);
  } catch (err) {
    return {
      surface,
      part,
      status: "ROOT-FAIL",
      reason: `shape assertion threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!shapeOk) {
    return {
      surface,
      part,
      status: "ROOT-FAIL",
      reason: `shape assertion failed: ${shapeExpr}`,
    };
  }
  const style = await evalValue(
    cdp,
    sessionId,
    `window.panel115ComputedSub((${resolverExpr}), ${JSON.stringify(SURFACE_GOVERNED_PROPS)})`,
  );
  style.backgroundColor = await normalizeColor(
    cdp,
    sessionId,
    style.backgroundColor,
  );
  style.color = await normalizeColor(cdp, sessionId, style.color);
  style.borderColor = await normalizeColor(cdp, sessionId, style.borderColor);
  const rect = await evalValue(
    cdp,
    sessionId,
    `window.panel115Rect((${resolverExpr}))`,
  );
  return {
    surface,
    part,
    status: "OK",
    style,
    width: rect.width,
    height: rect.height,
  };
}

/** Scrolls `elExpr` into view then reads its rect and dispatches a real click there. Named after
 * panel-114.mjs's own `clickElementInView` (Plan 116-02), but that board-side version
 * deliberately skips `scrollIntoView()` for a different reason (a live-verified renderer hang
 * tied to specific board carousel triggers). This panel-side version DOES scroll first, matching
 * `checkStates.measureAndAssertControl`'s own established idiom in THIS file: the CardTimeline
 * toggle this function clicks lives inside the scrollable `.scroll-stable-y.reading-surface`
 * wrapper, and a first pass without the scroll dispatched the click at the button's real (but
 * scrolled-out-of-view) viewport coordinates, silently missing it. */
async function clickElementInView(cdp, sessionId, elExpr, modifiers = 0) {
  await evalValue(
    cdp,
    sessionId,
    `${elExpr}.scrollIntoView({ behavior: "instant", block: "nearest" })`,
  );
  await sleep(50);
  const rect = await evalValue(
    cdp,
    sessionId,
    `window.panel115Rect(${elExpr})`,
  );
  await dispatchRealClick(cdp, sessionId, { x: rect.x, y: rect.y }, modifiers);
}

/** True below `DetailPanel.tsx`'s own `CAROUSEL_QUERY` threshold (max-width: 1023px), the same
 * boundary that forces `takeover`/`effectiveFullscreen` true and structurally removes the resize
 * handle and `PanelHeader.tsx`'s fullscreen toggle from the JSX tree entirely (never a probe
 * gap). */
function isTakeoverBp(bp) {
  return bp.width < 1024;
}

/**
 * Every detail-panel surface descriptor's reading for one breakpoint, covering all 11
 * `src/web/features/detail/*.tsx` files. Three of the eleven are structurally NOT-MOUNTED by this
 * fixture at EVERY breakpoint, each confirmed by reading the component's own source gate rather
 * than assumed:
 *   - `SessionLostSection.tsx` renders only when `activeSessionLost`
 *     (`c.activeSessionId != null && !c.tmuxSession`, DetailPanel.tsx:335); this fixture's active
 *     session carries a live `tmuxSession`, so it is never true.
 *   - `StartAnotherSessionButton.tsx` returns `null` outright when `card.column === "done"`
 *     (its own line 24); this fixture's primary card sits in `column: "done"`.
 *   - `UnknownProbeRow.tsx` renders only when `previewsUnknown`/`prsUnknown` is set; this
 *     fixture's card sets `previews`/`prs` directly and never either `Unknown` field.
 * None of the three is forced by editing the fixture: `rhythm`/`elevation`/`states` assert
 * against that exact fixture (116-03-PLAN.md's own instruction).
 */
async function measureSurfaces(cdp, sessionId, bp) {
  const records = [];
  const push = (rec) => records.push({ bp: bp.label, ...rec });
  const notMounted = (surface, part, reason) =>
    push({ surface, part, status: "NOT-MOUNTED", reason });
  const takeover = isTakeoverBp(bp);
  const asideExpr = `document.querySelector('aside[aria-label="Ticket detail"]')`;

  // --- SURF-12 CardTimeline.tsx --------------------------------------------
  const cardTimelineToggleExpr = `document.querySelector('aside[aria-label="Ticket detail"] button[aria-controls="card-timeline-region"]')`;
  push(
    await readSurface(
      cdp,
      sessionId,
      "CardTimeline.tsx",
      "activity-toggle",
      cardTimelineToggleExpr,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-controls="card-timeline-region"]').length === 1`,
      `$EL.getAttribute('aria-label') === "Toggle activity"`,
    ),
  );

  // CardTimeline.tsx's own `useState(true)`: the region starts EXPANDED, not collapsed. Read the
  // default-expanded region first (this fixture's 5 seeded event rows keep `rows.length > 0`,
  // the `#card-timeline-region` branch with content, never the empty-state branch), then toggle
  // closed for the collapsed reading, then toggle back open so the rest of this sweep (PrList
  // lives in the SAME scroll container) sees the same settled, expanded DOM shape every other
  // check in this file assumes.
  const timelineExpandedFirst = await evalValue(
    cdp,
    sessionId,
    `document.querySelector('#card-timeline-region') != null`,
  );
  if (timelineExpandedFirst) {
    push(
      await readSurface(
        cdp,
        sessionId,
        "CardTimeline.tsx",
        "timeline-region-expanded",
        `document.querySelector('#card-timeline-region')`,
        `document.querySelectorAll('#card-timeline-region').length === 1`,
        `$EL.id === "card-timeline-region"`,
      ),
    );
  } else {
    notMounted(
      "CardTimeline.tsx",
      "timeline-region-expanded",
      "expanded was false at the moment this breakpoint was measured (CardTimeline.tsx's own local `expanded` state)",
    );
  }
  await clickElementInView(cdp, sessionId, cardTimelineToggleExpr);
  await sleep(150);
  const timelineNowCollapsed = await evalValue(
    cdp,
    sessionId,
    `document.querySelector('#card-timeline-region') == null`,
  );
  notMounted(
    "CardTimeline.tsx",
    "timeline-region-collapsed",
    timelineNowCollapsed
      ? "CardTimeline.tsx's own `{expanded && (...)}` conditional render removes #card-timeline-region from the DOM entirely while collapsed, live-confirmed by a real toggle click this run, the correct absence, not a probe gap"
      : "toggle click did not collapse the region within 150ms, recorded honestly rather than silently reusing the expanded reading",
  );
  await clickElementInView(cdp, sessionId, cardTimelineToggleExpr);
  await sleep(150);

  // --- SURF-13 DetailPanel.tsx ----------------------------------------------
  push(
    await readSurface(
      cdp,
      sessionId,
      "DetailPanel.tsx",
      "panel-root",
      asideExpr,
      `document.querySelectorAll('aside[aria-label="Ticket detail"]').length === 1`,
      `$EL.getAttribute('aria-label') === "Ticket detail"`,
    ),
  );

  if (!takeover) {
    push(
      await readSurface(
        cdp,
        sessionId,
        "DetailPanel.tsx",
        "resize-handle",
        `document.querySelector('aside[aria-label="Ticket detail"] [role="separator"][aria-label="Resize panel"]')`,
        `document.querySelectorAll('aside[aria-label="Ticket detail"] [role="separator"][aria-label="Resize panel"]').length === 1`,
        `$EL.getAttribute('aria-orientation') === "vertical"`,
      ),
    );
  } else {
    notMounted(
      "DetailPanel.tsx",
      "resize-handle",
      "DetailPanel.tsx's own `!docked && !effectiveFullscreen` gate: below the 1024px carousel threshold `takeover` forces `effectiveFullscreen` true, removing the handle's JSX subtree entirely",
    );
  }

  push(
    await readSurface(
      cdp,
      sessionId,
      "DetailPanel.tsx",
      "reading-surface-wrapper (ReferenceBlocks+CardTimeline)",
      `document.querySelector('aside[aria-label="Ticket detail"] .scroll-stable-y.reading-surface')`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] .scroll-stable-y.reading-surface').length === 1`,
      `$EL.className.indexOf('reading-surface') !== -1`,
    ),
  );

  push(
    await readSurface(
      cdp,
      sessionId,
      "DetailPanel.tsx",
      "previews-wrapper",
      `document.querySelector('aside[aria-label="Ticket detail"] button[aria-label^="Open localhost"]').parentElement.parentElement`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-label^="Open localhost"]').length === 1`,
      `$EL.className.indexOf('reading-surface') !== -1`,
    ),
  );

  // --- SURF-14 PanelHeader.tsx ------------------------------------------------
  push(
    await readSurface(
      cdp,
      sessionId,
      "PanelHeader.tsx",
      "h1-title",
      `document.querySelector('aside[aria-label="Ticket detail"] h1[title]')`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] h1[title]').length === 1`,
      `$EL.textContent.length > 0`,
    ),
  );

  // Same aria-controls exclusion `checkStates` already uses for this same button (not a text
  // search): at BP-D's narrowPanel width (<= 520px, PanelHeader.tsx's own narrowPanel gate) the
  // button's visible text collapses to just the chevron icon, aria-label/title carry "Details"
  // instead, and `panel115FindByText`'s textContent search stops matching, a real narrow-viewport
  // selector gap this run's BP-D reading exposed live, not a rendering defect.
  const detailsToggleExpr = `Array.prototype.find.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-expanded]'), function (b) { return b.getAttribute("aria-controls") !== "card-timeline-region"; })`;
  push(
    await readSurface(
      cdp,
      sessionId,
      "PanelHeader.tsx",
      "details-toggle",
      detailsToggleExpr,
      `Array.prototype.filter.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-expanded]'), function (b) { return b.getAttribute("aria-controls") !== "card-timeline-region"; }).length === 1`,
      `$EL.getAttribute('aria-expanded') != null`,
    ),
  );

  const fullscreenSelector = `aside[aria-label="Ticket detail"] button[aria-label="Enter fullscreen"], aside[aria-label="Ticket detail"] button[aria-label="Exit fullscreen"]`;
  if (!takeover) {
    push(
      await readSurface(
        cdp,
        sessionId,
        "PanelHeader.tsx",
        "fullscreen-toggle",
        `document.querySelector('${fullscreenSelector}')`,
        `document.querySelectorAll('${fullscreenSelector}').length === 1`,
        `$EL != null`,
      ),
    );
  } else {
    notMounted(
      "PanelHeader.tsx",
      "fullscreen-toggle",
      "PanelHeader.tsx's own `hasLiveSession && !docked && !takeover` gate: `takeover` is forced true by the same isCarousel query DetailPanel.tsx's resize handle uses, removing this IconButton below 1024px",
    );
  }

  const closeSelector = `aside[aria-label="Ticket detail"] button[aria-label="Close panel"], aside[aria-label="Ticket detail"] button[aria-label="Back to board"]`;
  push(
    await readSurface(
      cdp,
      sessionId,
      "PanelHeader.tsx",
      "close-button",
      `document.querySelector('${closeSelector}')`,
      `document.querySelectorAll('${closeSelector}').length === 1`,
      `$EL != null`,
    ),
  );

  const vscodeSelector = `aside[aria-label="Ticket detail"] button[aria-label="Open in VS Code"]`;
  const vscodePresent = await evalValue(
    cdp,
    sessionId,
    `document.querySelector('${vscodeSelector}') != null`,
  );
  if (vscodePresent) {
    push(
      await readSurface(
        cdp,
        sessionId,
        "PanelHeader.tsx",
        "vscode-button",
        `document.querySelector('${vscodeSelector}')`,
        `document.querySelectorAll('${vscodeSelector}').length === 1`,
        `$EL != null`,
      ),
    );
  } else {
    notMounted(
      "PanelHeader.tsx",
      "vscode-button",
      "PanelHeader.tsx renders this IconButton only when board.editors.code is true (server-side resolveEditors host detection) AND the card carries a workspacePath; this sandbox's boot-time editor detection reported code:false (no `code` binary resolved on PATH), a host-environment fact, not a fixture gap",
    );
  }

  const cursorSelector = `aside[aria-label="Ticket detail"] button[aria-label="Open in Cursor"]`;
  const cursorPresent = await evalValue(
    cdp,
    sessionId,
    `document.querySelector('${cursorSelector}') != null`,
  );
  if (cursorPresent) {
    push(
      await readSurface(
        cdp,
        sessionId,
        "PanelHeader.tsx",
        "cursor-button",
        `document.querySelector('${cursorSelector}')`,
        `document.querySelectorAll('${cursorSelector}').length === 1`,
        `$EL != null`,
      ),
    );
  } else {
    notMounted(
      "PanelHeader.tsx",
      "cursor-button",
      "PanelHeader.tsx renders this IconButton only when board.editors.cursor is true (server-side resolveEditors host detection) AND the card carries a workspacePath; this sandbox's boot-time editor detection reported cursor:false (no `cursor` binary resolved on PATH), a host-environment fact, not a fixture gap",
    );
  }

  // --- SURF-15 PreviewRow.tsx -------------------------------------------------
  push(
    await readSurface(
      cdp,
      sessionId,
      "PreviewRow.tsx",
      "preview-row",
      `document.querySelector('aside[aria-label="Ticket detail"] button[aria-label^="Open localhost"]').parentElement`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-label^="Open localhost"]').length === 1`,
      `$EL.querySelector('button[aria-label^="Open localhost"]') != null`,
    ),
  );
  push(
    await readSurface(
      cdp,
      sessionId,
      "PreviewRow.tsx",
      "open-button",
      `document.querySelector('aside[aria-label="Ticket detail"] button[aria-label^="Open localhost"]')`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-label^="Open localhost"]').length === 1`,
      `$EL.getAttribute('aria-label').indexOf('Open localhost') === 0`,
    ),
  );

  // --- SURF-16 PrList.tsx -----------------------------------------------------
  push(
    await readSurface(
      cdp,
      sessionId,
      "PrList.tsx",
      "section-label",
      `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Pull Requests")`,
      `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Pull Requests") != null`,
      `$EL.textContent.indexOf("Pull Requests") !== -1`,
    ),
  );
  push(
    await readSurface(
      cdp,
      sessionId,
      "PrList.tsx",
      "pr-row",
      `document.querySelector('aside[aria-label="Ticket detail"] button[aria-label^="Open PR"]').parentElement`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-label^="Open PR"]').length >= 1`,
      `$EL.querySelector('button[aria-label^="Open PR"]') != null`,
    ),
  );
  push(
    await readSurface(
      cdp,
      sessionId,
      "PrList.tsx",
      "open-pr-button",
      `document.querySelector('aside[aria-label="Ticket detail"] button[aria-label^="Open PR"]')`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-label^="Open PR"]').length >= 1`,
      `$EL.getAttribute('aria-label').indexOf('Open PR') === 0`,
    ),
  );

  // --- SURF-17 ReferenceBlocks.tsx ---------------------------------------------
  push(
    await readSurface(
      cdp,
      sessionId,
      "ReferenceBlocks.tsx",
      "description-markdown",
      `document.querySelector('aside[aria-label="Ticket detail"] .md-body').parentElement`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] .md-body').length === 1`,
      `$EL.querySelector('.md-body') != null`,
    ),
  );
  push(
    await readSurface(
      cdp,
      sessionId,
      "ReferenceBlocks.tsx",
      "muted-notice",
      `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Status").parentElement`,
      `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Status") != null`,
      `$EL.textContent.indexOf("Status") !== -1`,
    ),
  );
  push(
    await readSurface(
      cdp,
      sessionId,
      "ReferenceBlocks.tsx",
      "start-error-block",
      `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Provisioning error").parentElement.parentElement`,
      `window.panel115FindByText('aside[aria-label="Ticket detail"] span', "Provisioning error") != null`,
      `$EL.textContent.indexOf("Provisioning error") !== -1`,
    ),
  );

  // --- SURF-18 SessionLostSection.tsx: structurally NOT-MOUNTED, see JSDoc above. ---
  notMounted(
    "SessionLostSection.tsx",
    "session-lost-section",
    "renders only when `activeSessionLost` (c.activeSessionId != null && !c.tmuxSession, DetailPanel.tsx:335); this fixture's active session carries a live tmuxSession",
  );

  // --- SURF-19 SessionSwitcher.tsx ---------------------------------------------
  const sessionGroupExpr = `document.querySelector('aside[aria-label="Ticket detail"] [role="group"][aria-label="Sessions"]')`;
  push(
    await readSurface(
      cdp,
      sessionId,
      "SessionSwitcher.tsx",
      "sessions-group",
      sessionGroupExpr,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] [role="group"][aria-label="Sessions"]').length === 1`,
      `$EL.getAttribute('role') === "group"`,
    ),
  );
  push(
    await readSurface(
      cdp,
      sessionId,
      "SessionSwitcher.tsx",
      "segment (active)",
      `${sessionGroupExpr}.children[0]`,
      `${sessionGroupExpr}.children.length >= 1`,
      `$EL.getAttribute('aria-pressed') != null`,
    ),
  );

  // --- SURF-20 StartAnotherSessionButton.tsx: structurally NOT-MOUNTED, see JSDoc above. ---
  notMounted(
    "StartAnotherSessionButton.tsx",
    "start-another-session-button",
    'returns null outright when card.column === "done" (StartAnotherSessionButton.tsx:24); this fixture\'s primary card sits in column: "done"',
  );

  // --- SURF-21 TerminalRegion.tsx -----------------------------------------------
  const terminalIframeExpr = `document.querySelector('aside[aria-label="Ticket detail"] iframe[title^="Live terminal for"]')`;
  push(
    await readSurface(
      cdp,
      sessionId,
      "TerminalRegion.tsx",
      "terminal-wrapper",
      `${terminalIframeExpr}.parentElement`,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] iframe[title^="Live terminal for"]').length === 1`,
      `$EL.querySelector('iframe') != null`,
    ),
  );
  push(
    await readSurface(
      cdp,
      sessionId,
      "TerminalRegion.tsx",
      "terminal-iframe",
      terminalIframeExpr,
      `document.querySelectorAll('aside[aria-label="Ticket detail"] iframe[title^="Live terminal for"]').length === 1`,
      `$EL.tagName === "IFRAME"`,
    ),
  );

  // --- SURF-22 UnknownProbeRow.tsx: structurally NOT-MOUNTED, see JSDoc above. ---
  notMounted(
    "UnknownProbeRow.tsx",
    "unknown-probe-row",
    "renders only when previewsUnknown/prsUnknown is set on the card; this fixture's card sets previews/prs directly and never either Unknown field",
  );

  return records;
}

/**
 * Retry wrapper, same shape and reasoning as panel-114.mjs's own `probeSurfaces` (Plan 116-02): a
 * full sandbox boot plus well over 100 CDP round trips occasionally hits an unresponsive
 * `Runtime.evaluate` under CPU contention from the developer's own live desktop session (a
 * renderer stall, not a code defect); a fresh sandbox boot on the next attempt reliably clears
 * it. A higher budget than the three checks' own 3-attempt convention, matching this probe's
 * proportionally higher round-trip count.
 */
async function probeSurfaces() {
  const MAX_ATTEMPTS = 5;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await probeSurfacesOnce();
      return;
    } catch (err) {
      lastErr = err;
      console.error(
        `panel-115 --probe surfaces: attempt ${attempt}/${MAX_ATTEMPTS} threw (likely CDP/renderer contention, not a code defect): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw lastErr;
}

async function probeSurfacesOnce() {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  const allRecords = [];
  try {
    console.log("panel-115 --probe surfaces: booting sandbox");
    sandbox = await bootSandbox("surfaces");
    console.log(
      `panel-115 --probe surfaces: sandbox home ${sandbox.home}, launching Chrome`,
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
      throw new Error("probeSurfaces: #root never appeared after navigation");
    // Splash.tsx's own unconditional 1.3s overlay, the same settle window every other probe/check
    // in this file uses.
    await sleep(1450);

    // Same open-once-per-run discipline as probeBaseline/checkRhythm/checkElevation/checkStates:
    // DetailPanel.tsx re-layouts an already-open panel in place on resize, and closing/reopening
    // across the carousel boundary reproduces the DETAIL-PANEL FINDING renderer wedge
    // (115-01/panel-114 precedent). Logged explicitly, once, per this plan's own acceptance
    // criterion that the single-open discipline be asserted in the probe's own log line.
    let panelOpened = false;
    for (const bp of BREAKPOINTS) {
      console.log(`panel-115 --probe surfaces: measuring ${bp.label}`);
      await applyBreakpoint(cdp, sessionId, bp);
      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(300);
      if (!panelOpened) {
        await openPrimaryCardPanel(cdp, sessionId);
        panelOpened = true;
        console.log(
          "panel-115 --probe surfaces: panel opened exactly once this run, every remaining breakpoint only resizes underneath it",
        );
      } else {
        await sleep(HOVER_SETTLE_MS);
      }
      const records = await measureSurfaces(cdp, sessionId, bp);
      allRecords.push(...records);
    }

    console.log(JSON.stringify(allRecords, null, 2));
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
        // Await Chrome's actual exit (SIGKILL escalation included) so the
        // user-data-dir removal in teardownSandbox below cannot race its
        // exit-time lock/lease writes.
        await stopServer(chrome);
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
        // Await Chrome's actual exit (SIGKILL escalation included) so the
        // user-data-dir removal in teardownSandbox below cannot race its
        // exit-time lock/lease writes.
        await stopServer(chrome);
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
// elevation: break-proven check reading every board and panel surface LIVE
// against the one elevation ladder (LUI-07's second half). Boots the sandbox
// once, opens the fully populated fixture card's detail panel, and at each of
// the four breakpoints reads every panel/board surface the plan's interfaces
// block names through the canvas 1x1 normalizer, ranks them by the WCAG
// relative-luminance functions ported verbatim from contrast-113.mjs (lines
// 88-101: hexToRgb/lin/relLum, the formula is not re-derived), and confirms
// resting surfaces carry no elevation-implying box-shadow.
// ---------------------------------------------------------------------------

/** Ported verbatim from scripts/contrast-113.mjs lines 88-101 (hexToRgb/lin/relLum), the WCAG
 * relative-luminance formula this file's own rank assertions reuse rather than re-derive. */
function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lin(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relLum([r, g, b]) {
  const [R, G, B] = [r, g, b].map(lin);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** The four elevation-ladder tokens' literal hex values, tokens.css's own source of truth
 * (design-contract.md's `## Elevation` table). Used to build the "expected" side of every live
 * token-match assertion below; never re-derived from a live read. */
const ELEVATION_TOKEN_HEX = {
  "--bg": "#0b0c0e",
  "--surface-column": "#131417",
  "--surface-card": "#1a1b1f",
  "--surface-card-hover": "#202126",
};

/** Builds the same `"rgba(r, g, b, 1.000)"` shape `window.panel115NormalizeColor` produces for an
 * opaque background, so a token-match assertion can reuse {@link colorsMatch}'s tolerance. */
function expectedRgba(hex) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, 1.000)`;
}

/** Relative luminance of a `window.panel115NormalizeColor`-shaped `"rgba(r, g, b, a)"` string, via
 * {@link parseRgbTriple} (already tolerant of both the `"rgb(...)"` and `"rgba(...)"` shapes). */
function relLumFromNormalized(str) {
  const parsed = parseRgbTriple(str);
  if (parsed == null) {
    throw new Error(
      `relLumFromNormalized: "${str}" is not a parseable rgb()/rgba() string`,
    );
  }
  return relLum([parsed[0], parsed[1], parsed[2]]);
}

function assertElevationToken(violations, bp, name, measured, tokenName) {
  const expected = expectedRgba(ELEVATION_TOKEN_HEX[tokenName]);
  if (!colorsMatch(measured, expected)) {
    violations.push(
      `elevation(${bp.label}): ${name} measured ${measured}, expected ${tokenName} (${expected})`,
    );
  }
}

/** Named per the plan's own requirement: "A surface measured out of rank is a violation naming
 * both surfaces and both luminances, not a bare boolean." */
function assertLuminanceGreater(
  violations,
  bp,
  lowerName,
  lowerValue,
  higherName,
  higherValue,
) {
  const lowerLum = relLumFromNormalized(lowerValue);
  const higherLum = relLumFromNormalized(higherValue);
  if (!(higherLum > lowerLum)) {
    violations.push(
      `elevation(${bp.label}): rank violation, ${higherName} (luminance ${higherLum.toFixed(5)}) ` +
        `is not strictly greater than ${lowerName} (luminance ${lowerLum.toFixed(5)})`,
    );
  }
}

function assertElevationExact(violations, bp, label, expected, observed) {
  if (observed !== expected) {
    violations.push(
      `elevation(${bp.label}): ${label} expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`,
    );
  }
}

/** The comparison fixture card (`p115-plain`), never opened/selected: `CardView.tsx`'s own
 * `elevated`/`selected`/`pressed` background formula means the PRIMARY fixture card (whose panel
 * this check opens) reads its own `--surface-card-hover` "selected" tint, not a genuinely resting
 * tier, once its panel is open, confirmed live in 115-01's own BEFORE ledger. The comparison card
 * is the only card in this fixture that is ever genuinely at rest. */
const RESTING_CARD_COLUMN = "todo";
const RESTING_CARD_IDENTIFIER = "PROP-502";

/**
 * `Column.tsx`'s own `[data-column]` root carries an UNCONDITIONAL `boxShadow: "inset 0 1px 0
 * rgba(255,255,255,0.02)"` (a hairline top-edge highlight, never state-conditional, never routed
 * through `--shadow-float`) at every breakpoint, live-measured while building this check. This
 * contradicts design-contract.md's "columns keep no shadow" phrasing, whose own Note column only
 * ever live-confirmed a resting CARD's boxShadow, never a column's. `Column.tsx` sits outside this
 * plan's file scope (Task 1/2/3 touch only `panel-115.mjs`, `TerminalRegion.tsx` and the ledger),
 * so this asserts the column's boxShadow against its OWN measured baseline (a real regression
 * guard against a future accidental change) rather than a false "none" expectation, the 114-04
 * "record the actual evidence" precedent this plan's own Task 2 names. See 115-04-SUMMARY.md's
 * Deviations and the ledger's `## Elevation` section for the full finding.
 */
const COLUMN_RESTING_BOX_SHADOW =
  "rgba(255, 255, 255, 0.02) 0px 1px 0px 0px inset";

/**
 * Boots the sandbox, opens the fully populated fixture card's detail panel, and at each of the
 * four breakpoints reads every panel surface (aside, session-switcher container, the Notice mono
 * provisioning-stderr block, the terminal viewport, and four transparent/inherited rows) and every
 * board surface (the comparison card's own column, its resting background, and its hovered
 * background) through the canvas normalizer, then asserts: each resolves to its expected ladder
 * token, the live luminance rank the ladder claims actually holds, and every resting surface's
 * boxShadow matches its (measured, not assumed) baseline.
 */
async function checkElevation(violations) {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  try {
    sandbox = await bootSandbox("check-elevation");
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
      violations.push("elevation: #root never appeared after navigation");
      return;
    }
    // Splash.tsx's unconditional 1.3s overlay, same settle window every other probe/check uses.
    await sleep(1450);

    const asideExpr = `document.querySelector('aside[aria-label="Ticket detail"]')`;
    const sessionGroupExpr = `document.querySelector('aside[aria-label="Ticket detail"] [role="group"][aria-label="Sessions"]')`;
    // Scoped two levels: `.reading-surface` itself also carries the `scroll-stable-y` class (on
    // the SAME element, DetailPanel.tsx:602/628), so the descendant combinator below can only
    // match the nested Notice mono block, never the wrapper matching its own selector.
    const noticeMonoExpr = `document.querySelector('aside[aria-label="Ticket detail"] .reading-surface .scroll-stable-y')`;
    const terminalViewportExpr = `(function () { var f = document.querySelector('aside[aria-label="Ticket detail"] iframe[title^="Live terminal for"]'); return f ? f.parentElement : null; })()`;
    const headerRowExpr = `document.querySelector('aside[aria-label="Ticket detail"] h1').parentElement.parentElement`;
    const sessionSwitcherRowExpr = `${sessionGroupExpr}.parentElement.parentElement`;
    const readingSurfaceExpr = `document.querySelector('aside[aria-label="Ticket detail"] .reading-surface')`;
    const cardTimelineRootExpr = `(function () { var r = document.querySelector('#card-timeline-region'); return r ? r.parentElement : null; })()`;
    const columnExpr = `window.panel115FindColumn("${RESTING_CARD_COLUMN}")`;
    const restingCardExpr = `window.panel115FindCardByIdentifier("${RESTING_CARD_COLUMN}", "${RESTING_CARD_IDENTIFIER}")`;

    // Same open-once-per-run discipline as checkRhythm/probeBaseline: DetailPanel.tsx re-layouts
    // an already-open panel in place on resize, and closing/reopening across the carousel
    // boundary reproduces the DETAIL-PANEL FINDING renderer wedge (115-01/panel-114 precedent).
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

      // Below CAROUSEL_QUERY's 1024px threshold the comparison card's own "todo" column can sit
      // off-screen, the same carousel gotcha openPrimaryCardPanel already works around for "done".
      await evalValue(
        cdp,
        sessionId,
        `window.panel115FindColumn("${RESTING_CARD_COLUMN}").scrollIntoView({ behavior: "instant", inline: "start", block: "nearest" })`,
      );
      await sleep(50);

      // --- Panel surfaces ---
      const asideBgRaw = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${asideExpr}).backgroundColor`,
      );
      const asideBackground = await normalizeColor(cdp, sessionId, asideBgRaw);
      const asideBoxShadow = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${asideExpr}).boxShadow`,
      );

      const sessionSwitcherBgRaw = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${sessionGroupExpr}).backgroundColor`,
      );
      const sessionSwitcherBackground = await normalizeColor(
        cdp,
        sessionId,
        sessionSwitcherBgRaw,
      );

      const noticeMonoBgRaw = await evalValue(
        cdp,
        sessionId,
        `${noticeMonoExpr} ? getComputedStyle(${noticeMonoExpr}).backgroundColor : null`,
      );
      const noticeMonoBackground =
        noticeMonoBgRaw != null
          ? await normalizeColor(cdp, sessionId, noticeMonoBgRaw)
          : null;
      if (noticeMonoBackground == null) {
        violations.push(
          `elevation(${bp.label}): Notice mono block not found (provisioning stderr block missing from DOM)`,
        );
      }

      const terminalBgRaw = await evalValue(
        cdp,
        sessionId,
        `${terminalViewportExpr} ? getComputedStyle(${terminalViewportExpr}).backgroundColor : null`,
      );
      const terminalBackground =
        terminalBgRaw != null
          ? await normalizeColor(cdp, sessionId, terminalBgRaw)
          : null;
      if (terminalBackground == null) {
        violations.push(
          `elevation(${bp.label}): terminal viewport not found (iframe missing from DOM)`,
        );
      }

      const headerRowBgRaw = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${headerRowExpr}).backgroundColor`,
      );
      const sessionSwitcherRowBgRaw = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${sessionSwitcherRowExpr}).backgroundColor`,
      );
      const readingSurfaceBgRaw = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${readingSurfaceExpr}).backgroundColor`,
      );
      const cardTimelineRootBgRaw = await evalValue(
        cdp,
        sessionId,
        `${cardTimelineRootExpr} ? getComputedStyle(${cardTimelineRootExpr}).backgroundColor : null`,
      );

      // --- Board surfaces ---
      const columnBgRaw = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${columnExpr}).backgroundColor`,
      );
      const columnBackground = await normalizeColor(
        cdp,
        sessionId,
        columnBgRaw,
      );
      const columnBoxShadow = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${columnExpr}).boxShadow`,
      );

      await blurActive(cdp, sessionId);
      await moveMouseAway(cdp, sessionId);
      await sleep(HOVER_SETTLE_MS);
      const restingCardBgRaw = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${restingCardExpr}).backgroundColor`,
      );
      const restingCardBackground = await normalizeColor(
        cdp,
        sessionId,
        restingCardBgRaw,
      );
      const restingCardBoxShadow = await evalValue(
        cdp,
        sessionId,
        `getComputedStyle(${restingCardExpr}).boxShadow`,
      );

      // Rendered-state dispatch at EVERY breakpoint, never real coordinate-based hover, here.
      // DetailPanel.tsx's own scrim (`!docked`, `position: fixed; inset: 0; pointerEvents: "auto"`
      // while `open`, `zIndex: 10`, above the board's own cards at their default stacking order)
      // covers the ENTIRE board whenever the panel is open in this fixture's floating (non-docked)
      // mode, live-confirmed while building this check: a real `Input.dispatchMouseEvent` at the
      // card's own coordinates hits the scrim, not the card, so the card's hover state never
      // flips (`elementFromPoint` at the card's rect returns a bare, class-less `<div>` either
      // way, since both the scrim and the card use inline styles with no className, an ambiguous
      // read that masked this for a first pass). A real hover on a BOARD card is physically
      // unreachable via coordinate-based input while the panel is open, the same "real input
      // cannot reach this state" category as 114-04's own unhovered-pressed finding. The
      // rendered-state technique (`element.dispatchEvent(...)` on the card's own DOM reference,
      // which bypasses hit-testing entirely) is the only valid technique here, not a fallback.
      const hovered = await readUnderHover(
        cdp,
        sessionId,
        restingCardExpr,
        ["backgroundColor", "boxShadow"],
        false,
      );
      const hoveredCardBackground = await normalizeColor(
        cdp,
        sessionId,
        hovered.value.backgroundColor,
      );

      console.log(
        `elevation(${bp.label}): aside=${asideBackground} sessionSwitcher=${sessionSwitcherBackground} ` +
          `noticeMono=${noticeMonoBackground} terminal=${terminalBackground} column=${columnBackground} ` +
          `restingCard=${restingCardBackground} hoveredCard=${hoveredCardBackground} (${hovered.mode}) ` +
          `asideBoxShadow=${asideBoxShadow} columnBoxShadow=${columnBoxShadow} restingCardBoxShadow=${restingCardBoxShadow}`,
      );

      // ---- token-match assertions ----
      assertElevationToken(
        violations,
        bp,
        "aside panel root",
        asideBackground,
        "--surface-column",
      );
      assertElevationToken(
        violations,
        bp,
        "session-switcher container",
        sessionSwitcherBackground,
        "--surface-card",
      );
      if (noticeMonoBackground != null) {
        assertElevationToken(
          violations,
          bp,
          "Notice mono block (provisioning stderr)",
          noticeMonoBackground,
          "--surface-card",
        );
      }
      if (terminalBackground != null) {
        assertElevationToken(
          violations,
          bp,
          "terminal viewport (accepted recessed exception, see Task 3)",
          terminalBackground,
          "--bg",
        );
      }
      assertElevationToken(
        violations,
        bp,
        "board column (todo)",
        columnBackground,
        "--surface-column",
      );
      assertElevationToken(
        violations,
        bp,
        "board resting card (PROP-502)",
        restingCardBackground,
        "--surface-card",
      );
      assertElevationToken(
        violations,
        bp,
        `board hovered card (PROP-502, ${hovered.mode})`,
        hoveredCardBackground,
        "--surface-card-hover",
      );

      // ---- transparent/inherited-background assertions ----
      assertElevationExact(
        violations,
        bp,
        "header row background (transparent)",
        "rgba(0, 0, 0, 0)",
        headerRowBgRaw,
      );
      assertElevationExact(
        violations,
        bp,
        "session-switcher row background (transparent)",
        "rgba(0, 0, 0, 0)",
        sessionSwitcherRowBgRaw,
      );
      assertElevationExact(
        violations,
        bp,
        "reading-surface wrapper background (transparent)",
        "rgba(0, 0, 0, 0)",
        readingSurfaceBgRaw,
      );
      if (cardTimelineRootBgRaw != null) {
        assertElevationExact(
          violations,
          bp,
          "CardTimeline root background (transparent)",
          "rgba(0, 0, 0, 0)",
          cardTimelineRootBgRaw,
        );
      }

      // ---- rank-order assertions (live luminance, both surfaces + values named) ----
      if (terminalBackground != null) {
        assertLuminanceGreater(
          violations,
          bp,
          "terminal viewport (--bg tier)",
          terminalBackground,
          "aside panel root (--surface-column tier)",
          asideBackground,
        );
        assertLuminanceGreater(
          violations,
          bp,
          "terminal viewport (--bg tier)",
          terminalBackground,
          "board column (--surface-column tier)",
          columnBackground,
        );
      }
      assertLuminanceGreater(
        violations,
        bp,
        "aside panel root (--surface-column tier)",
        asideBackground,
        "session-switcher container (--surface-card tier)",
        sessionSwitcherBackground,
      );
      assertLuminanceGreater(
        violations,
        bp,
        "board column (--surface-column tier)",
        columnBackground,
        "board resting card (--surface-card tier)",
        restingCardBackground,
      );
      assertLuminanceGreater(
        violations,
        bp,
        "board resting card (--surface-card tier)",
        restingCardBackground,
        "board hovered card (--surface-card-hover tier)",
        hoveredCardBackground,
      );
      assertLuminanceGreater(
        violations,
        bp,
        "session-switcher container (--surface-card tier)",
        sessionSwitcherBackground,
        "board hovered card (--surface-card-hover tier)",
        hoveredCardBackground,
      );

      // ---- resting box-shadow assertions ----
      assertElevationExact(
        violations,
        bp,
        "aside resting boxShadow (v2.9, in force)",
        "none",
        asideBoxShadow,
      );
      assertElevationExact(
        violations,
        bp,
        "board resting card boxShadow (v2.9, in force)",
        "none",
        restingCardBoxShadow,
      );
      assertElevationExact(
        violations,
        bp,
        "board column resting boxShadow (measured baseline, see Deviations)",
        COLUMN_RESTING_BOX_SHADOW,
        columnBoxShadow,
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
        // Await Chrome's actual exit (SIGKILL escalation included) so the
        // user-data-dir removal in teardownSandbox below cannot race its
        // exit-time lock/lease writes.
        await stopServer(chrome);
      } catch {
        // best effort
      }
    }
    if (sandbox) await teardownSandbox(sandbox);
  }
}

// ---------------------------------------------------------------------------
// BREAKS["elevation"]: mutates the real aside background declaration
// DetailPanel.tsx:390 (the single, unique `background: "var(--surface-column)",`
// occurrence in that file), repointing the panel aside from the
// --surface-column tier onto --surface-card, which puts the panel above the
// session-switcher card it sits beside and must trip the live rank
// assertion, naming both surfaces and both luminances.
// ---------------------------------------------------------------------------

const ELEVATION_BREAK_TARGET =
  '          background: "var(--surface-column)",\n';
const ELEVATION_BREAK_REPLACEMENT =
  '          background: "var(--surface-card)",\n';

async function runBreakElevation() {
  assertBuilt();
  const original = readFileSync(DETAIL_PANEL_PATH, "utf8");
  const occurrences = original.split(ELEVATION_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel-115: refusing to run --break elevation, expected the aside's own ` +
        `background: "var(--surface-column)" declaration to occur exactly once in ` +
        `${DETAIL_PANEL_PATH}, measured ${occurrences}. A miscounted anchor would mutate the ` +
        `wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(DETAIL_PANEL_PATH, original);
  try {
    writeFileSync(
      DETAIL_PANEL_PATH,
      original.replace(ELEVATION_BREAK_TARGET, ELEVATION_BREAK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkElevation(tripViolations);
    console.log(
      `\n--break elevation TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some(
      (v) => v.includes("rank violation") && v.includes("aside panel root"),
    );
  } finally {
    restoreDetailPanelSource(original);
  }

  const restoreViolations = [];
  await checkElevation(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break elevation RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// states: break-proven check extending the v3.4 hover/pressed/focus state
// palette and CSS-only motion to every panel-local interactive element
// (LUI-05/LUI-07's states half). Boots the sandbox once, opens the fully
// populated fixture card's panel, and at each of the four breakpoints reads
// resting/hover/pressed/focus-visible plus the resolved CSS transition for
// every panel-local control the plan's interfaces block names.
// ---------------------------------------------------------------------------

const PANEL_HEADER_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "detail",
  "PanelHeader.tsx",
);
const SESSION_LOST_SECTION_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "detail",
  "SessionLostSection.tsx",
);
const START_ANOTHER_SESSION_BUTTON_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "detail",
  "StartAnotherSessionButton.tsx",
);
const CARD_TIMELINE_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "detail",
  "CardTimeline.tsx",
);
const PR_LIST_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "detail",
  "PrList.tsx",
);
const PREVIEW_ROW_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "detail",
  "PreviewRow.tsx",
);
const SESSION_SWITCHER_PATH = join(
  REPO_ROOT,
  "src",
  "web",
  "features",
  "detail",
  "SessionSwitcher.tsx",
);

/** Every panel-local file this plan's interfaces block names, none of which may render a raw
 * `<button>` outside the governed `IconButton`/`Button` primitives (a shared-mechanism proof, the
 * same category as `control-states`'s own danger-variant proof in panel-114.mjs): a raw button
 * inherits the browser's ungoverned default hover/pressed/focus rendering, exactly the defect
 * CONTEXT.md's "nothing keeps an inherited browser default state" truth forbids. `PanelHeader.tsx`
 * carries several column/state-gated action buttons this fixture's `column: "done"` card never
 * renders (Promote/Move/Sync/Clean up/Start); `SessionLostSection.tsx` renders only for a LOST
 * active session (this fixture's active session is live); `StartAnotherSessionButton.tsx` returns
 * `null` outright on `column: "done"`. None of the three is live-reachable with this fixture
 * without inventing a second fixture card this plan has no other use for, so this source-level
 * proof is the honest substitute: it establishes every button in these files still routes through
 * the SAME primitive this check independently live-proves elsewhere in this run (Details toggle,
 * CardTimeline toggle, PR/preview open, session-switcher segments).
 */
const STATES_RAW_BUTTON_SWEEP = [
  { path: PANEL_HEADER_PATH, label: "PanelHeader.tsx" },
  { path: SESSION_LOST_SECTION_PATH, label: "SessionLostSection.tsx" },
  {
    path: START_ANOTHER_SESSION_BUTTON_PATH,
    label: "StartAnotherSessionButton.tsx",
  },
  { path: CARD_TIMELINE_PATH, label: "CardTimeline.tsx" },
  { path: PR_LIST_PATH, label: "PrList.tsx" },
  { path: PREVIEW_ROW_PATH, label: "PreviewRow.tsx" },
  { path: SESSION_SWITCHER_PATH, label: "SessionSwitcher.tsx" },
];

function checkNoRawButtons(violations) {
  for (const f of STATES_RAW_BUTTON_SWEEP) {
    const src = readFileSync(f.path, "utf8");
    if (/<button[\s>]/.test(src)) {
      violations.push(
        `states: ${f.label} renders a raw <button> element outside the governed IconButton/Button primitive (shared-mechanism proof failed)`,
      );
    }
  }
}

function assertStatesToken(violations, bp, label, tier, measured, expected) {
  if (!colorsMatch(measured, expected)) {
    violations.push(
      `states(${bp.label}): ${label} ${tier} backgroundColor expected ${expected}, observed ${measured}`,
    );
  }
}

/** Confirms `transitionStr` names `property` with a strictly positive duration, in either `s` or
 * `ms` units (Chrome's own serialization is not stable across shorthand forms): the CSS-only proof
 * a WAAPI call or an instant swap cannot satisfy, so the reduced-motion kill switch (a CSS-only
 * block, 113-04 finding) genuinely reaches every state change this check asserts. */
function assertStatesTransition(
  violations,
  bp,
  label,
  transitionStr,
  property,
) {
  const re = new RegExp(`${property}\\s+([\\d.]+)(m?s)`);
  const match = re.exec(transitionStr ?? "");
  const durationMs = match
    ? parseFloat(match[1]) * (match[2] === "s" ? 1000 : 1)
    : 0;
  if (match == null || durationMs <= 0) {
    violations.push(
      `states(${bp.label}): ${label} resolved transition "${transitionStr}" does not name ${property} with a non-zero CSS transition duration`,
    );
  }
}

function assertStatesFocus(violations, bp, label, reached, style) {
  if (!reached) {
    violations.push(
      `states(${bp.label}): ${label} Tab traversal never reached it (focus-visible unreachable)`,
    );
    return;
  }
  if (style.outlineStyle !== "solid" || style.outlineWidth !== "2px") {
    violations.push(
      `states(${bp.label}): ${label} focus-visible outline expected 2px solid, observed ${style.outlineWidth} ${style.outlineStyle}`,
    );
  }
}

/**
 * Full resting/hover/pressed/focus/transition read-and-assert for one `IconButton`/`Button`-backed
 * control, reused across every panel-local control this check measures except the resize handle
 * (a different element shape, styled via `borderLeft` rather than `background`, and pressed by a
 * real drag rather than a click). Hover uses `real` (BP-A/BP-B) or rendered-state (BP-C/BP-D), the
 * convention `readUnderHover`'s own JSDoc already documents. Pressed always uses the synthetic
 * dispatch (`readUnderSyntheticPress`), since every control this check measures has an `onClick`
 * side effect the check has no business triggering.
 */
async function measureAndAssertControl(
  cdp,
  sessionId,
  violations,
  bp,
  real,
  { label, expr, expectedResting, expectedHover, expectedPressed },
) {
  const props = ["backgroundColor", "transition"];
  const resting = await evalValue(
    cdp,
    sessionId,
    `window.panel115ComputedSub(${expr}, ${JSON.stringify(props)})`,
  );
  if (resting == null) {
    violations.push(`states(${bp.label}): ${label} not found in the DOM`);
    return;
  }
  const restingBg = await normalizeColor(
    cdp,
    sessionId,
    resting.backgroundColor,
  );
  // Live-confirmed: a bare Tab-key press does not always restart sequential focus navigation
  // from the top of the document after a blur(); this file's own repeated tabTraverseTo calls,
  // issued for controls out of strict DOM order, were observed dragging the scrollable
  // `.reading-surface` container to a scrollTop far from 0 (up to its max), a side effect of an
  // EARLIER control's own traversal, leaving a LATER (but DOM-earlier) control's real on-screen
  // rect off-screen (a negative `top`) by the time this function computes it for a REAL
  // coordinate-based hover dispatch. Explicitly scrolling the element into view before every
  // interaction (the same `scrollIntoView` idiom `openPrimaryCardPanel`/`checkElevation` already
  // use for the board carousel) makes this function's own real-input reads correct regardless of
  // tab-order side effects from whichever control ran before it.
  await evalValue(
    cdp,
    sessionId,
    `${expr}.scrollIntoView({ behavior: "instant", block: "nearest" })`,
  );
  await sleep(50);
  const hover = await readUnderHover(cdp, sessionId, expr, props, real);
  const hoverBg = await normalizeColor(
    cdp,
    sessionId,
    hover.value.backgroundColor,
  );
  const press = await readUnderSyntheticPress(cdp, sessionId, expr, props);
  const pressBg = await normalizeColor(
    cdp,
    sessionId,
    press.pressed.backgroundColor,
  );
  const traversal = await tabTraverseTo(cdp, sessionId, expr);
  const focusStyle = traversal.reached
    ? await evalValue(
        cdp,
        sessionId,
        `window.panel115ComputedSub(document.activeElement, ["outlineWidth","outlineStyle"])`,
      )
    : { outlineWidth: "none", outlineStyle: "none" };
  await blurActive(cdp, sessionId);
  await moveMouseAway(cdp, sessionId);
  await sleep(50);

  console.log(
    `states(${bp.label}): ${label} resting=${restingBg} hover=${hoverBg} (${hover.mode}) ` +
      `pressed=${pressBg} transition="${resting.transition}" focusReached=${traversal.reached}`,
  );

  assertStatesToken(
    violations,
    bp,
    label,
    "resting",
    restingBg,
    expectedResting,
  );
  assertStatesToken(violations, bp, label, "hover", hoverBg, expectedHover);
  assertStatesToken(violations, bp, label, "pressed", pressBg, expectedPressed);
  assertStatesTransition(
    violations,
    bp,
    label,
    resting.transition,
    "background-color",
  );
  assertStatesFocus(violations, bp, label, traversal.reached, focusStyle);
}

async function checkStates(violations) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptViolations = [];
    try {
      await checkStatesOnce(attemptViolations);
      violations.push(...attemptViolations);
      return;
    } catch (err) {
      lastErr = err;
      console.error(
        `states: attempt ${attempt}/${MAX_ATTEMPTS} threw (likely CDP/renderer contention, not a code defect): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt === MAX_ATTEMPTS) throw lastErr;
    }
  }
}

/** `SessionSwitcher.tsx`'s own `activeSegmentTint` constant, copied verbatim so the check resolves
 * the EXACT same color-mix() expression the component composes, never a re-derivation. If that
 * constant's value ever changes, this literal must be updated alongside it (a hazard shared by
 * every other CSS-literal-mirroring assertion already in this file, e.g. `ELEVATION_BREAK_TARGET`). */
const SESSION_SWITCHER_ACTIVE_TINT_CSS =
  "color-mix(in srgb, var(--accent) 16%, var(--surface-column))";

async function checkStatesOnce(violations) {
  let sandbox = null;
  let chrome = null;
  let cdp = null;
  try {
    sandbox = await bootSandbox("check-states");
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
      violations.push("states: #root never appeared after navigation");
      return;
    }
    // Splash.tsx's unconditional 1.3s overlay, same settle window every other check uses.
    await sleep(1450);

    checkNoRawButtons(violations);

    // Token resolutions, once, via the same off-screen probe-element technique control-states
    // uses in panel-114.mjs. Every resolution round-trips through normalizeColor's canvas-pixel
    // readback since a color-mix() result's computed-style serialization is not one stable string.
    const resolve = async (cssValue) =>
      normalizeColor(
        cdp,
        sessionId,
        await evalValue(
          cdp,
          sessionId,
          `window.panel115ResolveBg(${JSON.stringify(cssValue)})`,
        ),
      );
    const resolveBorderLeft = async (cssValue) =>
      normalizeColor(
        cdp,
        sessionId,
        await evalValue(
          cdp,
          sessionId,
          `window.panel115ResolveBorderLeftColor(${JSON.stringify(cssValue)})`,
        ),
      );

    const transparentBg = await resolve("transparent");
    const hoverIconBg = await resolve("var(--surface-card-hover)");
    const pressedIconBg = await resolve("var(--pressed-card-hover)");
    const activeSegmentRestingBg = await resolve(
      SESSION_SWITCHER_ACTIVE_TINT_CSS,
    );
    const activeSegmentHoverBg = await resolve(
      "color-mix(in srgb, var(--accent) 22%, var(--surface-column))",
    );
    const activeSegmentPressedBg = await resolve(
      `color-mix(in srgb, black 12%, ${SESSION_SWITCHER_ACTIVE_TINT_CSS})`,
    );
    const resizeHandleTransparentBorder =
      await resolveBorderLeft("transparent");
    const resizeHandleHoverBorder = await resolveBorderLeft(
      "var(--hover-resize-handle)",
    );
    const resizeHandleAccentBorder = await resolveBorderLeft("var(--accent)");

    console.log(
      `states: resolved tokens transparentBg=${transparentBg} hoverIconBg=${hoverIconBg} ` +
        `pressedIconBg=${pressedIconBg} activeSegmentResting=${activeSegmentRestingBg} ` +
        `activeSegmentHover=${activeSegmentHoverBg} activeSegmentPressed=${activeSegmentPressedBg} ` +
        `resizeHandleTransparentBorder=${resizeHandleTransparentBorder} ` +
        `resizeHandleHoverBorder=${resizeHandleHoverBorder} resizeHandleAccentBorder=${resizeHandleAccentBorder}`,
    );

    const sessionGroupExpr = `document.querySelector('aside[aria-label="Ticket detail"] [role="group"][aria-label="Sessions"]')`;
    const detailsToggleExpr = `Array.prototype.find.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button[aria-expanded]'), function (b) { return b.getAttribute("aria-controls") !== "card-timeline-region"; })`;
    const cardTimelineToggleExpr = `document.querySelector('aside[aria-label="Ticket detail"] button[aria-controls="card-timeline-region"]')`;
    const prOpenExpr = `document.querySelector('aside[aria-label="Ticket detail"] button[aria-label^="Open PR"]')`;
    const previewOpenExpr = `document.querySelector('aside[aria-label="Ticket detail"] button[aria-label^="Open localhost"]')`;
    const resizeHandleExpr = `document.querySelector('aside[aria-label="Ticket detail"] [role="separator"][aria-label="Resize panel"]')`;

    // Same open-once-per-run discipline as checkRhythm/checkElevation/probeBaseline:
    // DetailPanel.tsx re-layouts an already-open panel in place on resize, and closing/reopening
    // across the carousel boundary reproduces the DETAIL-PANEL FINDING renderer wedge
    // (115-01/panel-114 precedent).
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

      // readUnderHover's own JSDoc: real trusted hover at BP-A/BP-B, rendered-state dispatch at
      // BP-C/BP-D where the emulated mobile/touch device preset has no hover input.
      const real = bp.label === "BP-A" || bp.label === "BP-B";

      // --- SessionSwitcher: the three segment variants, read separately (inactive/active/lost). ---
      await measureAndAssertControl(cdp, sessionId, violations, bp, real, {
        label: "session-switcher segment 2 (inactive, sibling)",
        expr: `${sessionGroupExpr}.children[1]`,
        expectedResting: transparentBg,
        expectedHover: hoverIconBg,
        expectedPressed: pressedIconBg,
      });
      await measureAndAssertControl(cdp, sessionId, violations, bp, real, {
        label: "session-switcher segment 3 (lost)",
        expr: `${sessionGroupExpr}.children[2]`,
        expectedResting: transparentBg,
        expectedHover: hoverIconBg,
        expectedPressed: pressedIconBg,
      });
      // The active segment (ordinal 1) routes through IconButton's `callerBackground` branch
      // (114-05's fix for the board's own view-switch segment): unverified on the PANEL's own
      // active segment until this live read, per the interfaces block's explicit instruction.
      await measureAndAssertControl(cdp, sessionId, violations, bp, real, {
        label: "session-switcher segment 1 (active, callerBackground branch)",
        expr: `${sessionGroupExpr}.children[0]`,
        expectedResting: activeSegmentRestingBg,
        expectedHover: activeSegmentHoverBg,
        expectedPressed: activeSegmentPressedBg,
      });

      // --- PanelHeader's "Details" toggle (Button, secondary variant). ---
      await measureAndAssertControl(cdp, sessionId, violations, bp, real, {
        label: "PanelHeader Details toggle",
        expr: detailsToggleExpr,
        expectedResting: transparentBg,
        expectedHover: hoverIconBg,
        expectedPressed: pressedIconBg,
      });

      // --- PrList's PR-open IconButton. Tested in DOM order relative to CardTimeline (both
      // share the SAME scrollable `.reading-surface` container): `measureAndAssertControl`'s own
      // `scrollIntoView` guard makes real-input reads correct regardless of order, but keeping
      // the test order DOM-monotonic minimizes the number of full-page Tab-traversal wraps this
      // check issues. ---
      await measureAndAssertControl(cdp, sessionId, violations, bp, real, {
        label: "PrList PR-open IconButton",
        expr: prOpenExpr,
        expectedResting: transparentBg,
        expectedHover: hoverIconBg,
        expectedPressed: pressedIconBg,
      });

      // --- CardTimeline's activity toggle (IconButton). ---
      await measureAndAssertControl(cdp, sessionId, violations, bp, real, {
        label: "CardTimeline activity toggle",
        expr: cardTimelineToggleExpr,
        expectedResting: transparentBg,
        expectedHover: hoverIconBg,
        expectedPressed: pressedIconBg,
      });

      // --- PreviewRow's preview-open IconButton (its own, separate `.reading-surface` scroll
      // container, so no ordering constraint with the block above). ---
      await measureAndAssertControl(cdp, sessionId, violations, bp, real, {
        label: "PreviewRow preview-open IconButton",
        expr: previewOpenExpr,
        expectedResting: transparentBg,
        expectedHover: hoverIconBg,
        expectedPressed: pressedIconBg,
      });

      // --- Resize handle: DetailPanel.tsx:404's own takeover guard (`!docked &&
      // !effectiveFullscreen`) means it is not rendered at all below the 1024px carousel
      // threshold (BP-C/BP-D go `takeover`), the exact same threshold Column.tsx's own board
      // handle uses ("absent (not rendered)" at BP-C/BP-D, panel-114's own control-states
      // finding). Only measured at BP-A/BP-B, where it is real and `isCoarsePointer` is false (a
      // genuine mouse hover input is valid there). Pressed is proven via a REAL CDP
      // mousePressed/mouseReleased at the SAME point (zero movement): `handleResizePointerDown`
      // calls `setPointerCapture`, which throws on a synthetic (non-UA-tracked) pointerId, so the
      // synthetic dispatch this check uses everywhere else cannot reach this element's pressed
      // state; a real CDP press IS UA-tracked and works, and a zero-movement release stays inside
      // the 3px tap threshold, so it commits no persisted width change (component's own tap-vs-drag
      // branch, DetailPanel.tsx `handlePointerUp`).
      if (real) {
        const handleResting = await evalValue(
          cdp,
          sessionId,
          `window.panel115ComputedSub(${resizeHandleExpr}, ["borderLeftColor","transition"])`,
        );
        if (handleResting == null) {
          violations.push(
            `states(${bp.label}): resize handle not found in the DOM at a breakpoint where it should be rendered`,
          );
        } else {
          const handleRestingBorder = await normalizeColor(
            cdp,
            sessionId,
            handleResting.borderLeftColor,
          );
          const handleHover = await readUnderHover(
            cdp,
            sessionId,
            resizeHandleExpr,
            ["borderLeftColor"],
            true,
          );
          const handleHoverBorder = await normalizeColor(
            cdp,
            sessionId,
            handleHover.value.borderLeftColor,
          );

          const rect = await evalValue(
            cdp,
            sessionId,
            `window.panel115Rect(${resizeHandleExpr})`,
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
          await sleep(HOVER_SETTLE_MS);
          const handlePressed = await evalValue(
            cdp,
            sessionId,
            `window.panel115ComputedSub(${resizeHandleExpr}, ["borderLeftColor"])`,
          );
          const handlePressedBorder = await normalizeColor(
            cdp,
            sessionId,
            handlePressed.borderLeftColor,
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
            },
            sessionId,
          );
          await sleep(50);
          await moveMouseAway(cdp, sessionId);

          const traversal = await tabTraverseTo(
            cdp,
            sessionId,
            resizeHandleExpr,
          );
          const handleFocusStyle = traversal.reached
            ? await evalValue(
                cdp,
                sessionId,
                `window.panel115ComputedSub(document.activeElement, ["outlineWidth","outlineStyle"])`,
              )
            : { outlineWidth: "none", outlineStyle: "none" };
          await blurActive(cdp, sessionId);

          console.log(
            `states(${bp.label}): resize handle resting=${handleRestingBorder} hover=${handleHoverBorder} ` +
              `pressed=${handlePressedBorder} transition="${handleResting.transition}" focusReached=${traversal.reached}`,
          );

          assertStatesToken(
            violations,
            bp,
            "resize handle",
            "resting",
            handleRestingBorder,
            resizeHandleTransparentBorder,
          );
          assertStatesToken(
            violations,
            bp,
            "resize handle",
            "hover",
            handleHoverBorder,
            resizeHandleHoverBorder,
          );
          assertStatesToken(
            violations,
            bp,
            "resize handle",
            "pressed (resizing)",
            handlePressedBorder,
            resizeHandleAccentBorder,
          );
          if (colorsMatch(handleHoverBorder, handlePressedBorder)) {
            violations.push(
              `states(${bp.label}): resize handle hover and pressed borderLeftColor are identical (${handleHoverBorder}), not pairwise distinct`,
            );
          }
          assertStatesTransition(
            violations,
            bp,
            "resize handle",
            handleResting.transition,
            "border-left-color",
          );
          assertStatesFocus(
            violations,
            bp,
            "resize handle",
            traversal.reached,
            handleFocusStyle,
          );
        }
      } else {
        console.log(
          `states(${bp.label}): resize handle not rendered (takeover breakpoint, same threshold as Column.tsx's board handle)`,
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
        // Await Chrome's actual exit (SIGKILL escalation included) so the
        // user-data-dir removal in teardownSandbox below cannot race its
        // exit-time lock/lease writes.
        await stopServer(chrome);
      } catch {
        // best effort
      }
    }
    if (sandbox) await teardownSandbox(sandbox);
  }
}

// ---------------------------------------------------------------------------
// BREAKS["states"]: mutates the real hover-tier fix Task 2 landed on
// DetailPanel.tsx's resize handle (the "2px solid var(--hover-resize-handle)"
// branch), collapsing hover back onto the pre-fix bug (solid --accent,
// indistinguishable from pressed), rebuilds, and re-runs checkStates itself
// against the mutated source, then restores the captured bytes unconditionally.
// ---------------------------------------------------------------------------

const STATES_BREAK_TARGET = '"2px solid var(--hover-resize-handle)"';
const STATES_BREAK_REPLACEMENT = '"2px solid var(--accent)"';

async function runBreakStates() {
  assertBuilt();
  const original = readFileSync(DETAIL_PANEL_PATH, "utf8");
  const occurrences = original.split(STATES_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel-115: refusing to run --break states, expected the resize handle's hover-tier ` +
        `declaration to occur exactly once in ${DETAIL_PANEL_PATH}, measured ${occurrences}. A ` +
        `miscounted anchor would mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(DETAIL_PANEL_PATH, original);
  try {
    writeFileSync(
      DETAIL_PANEL_PATH,
      original.replace(STATES_BREAK_TARGET, STATES_BREAK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkStates(tripViolations);
    console.log(
      `\n--break states TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some(
      (v) =>
        v.includes("resize handle") &&
        (v.includes("hover backgroundColor") ||
          v.includes("hover") ||
          v.includes("not pairwise distinct")),
    );
  } finally {
    restoreDetailPanelSource(original);
  }

  const restoreViolations = [];
  await checkStates(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break states RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// CHECKS / BREAKS / PROBES.
// ---------------------------------------------------------------------------

const CHECKS = {
  rhythm: checkRhythm,
  elevation: checkElevation,
  states: checkStates,
};

const BREAKS = {
  rhythm: runBreakRhythm,
  elevation: runBreakElevation,
  states: runBreakStates,
};

const PROBES = {
  baseline: probeBaseline,
  surfaces: probeSurfaces,
};

// Silence no-unused-vars for spine identifiers ported ahead of the checks that will call them,
// matching this file's own doc-block explanation of the port-now-use-later shape.
void evalAsyncValue;
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

main().catch((err) => {
  console.error(`panel-115 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
