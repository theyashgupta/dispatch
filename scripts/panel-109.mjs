/**
 * Phase 109 instrument script scaffold (PUSH-07, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92 through
 * panel-108. `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply here,
 * but prettier still formats this file.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-108.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on the user's live service at :4700, before this script boots any server or
 * spawns any real process, and there is no override flag. It runs FIRST in `main()`, before any
 * sandbox directory is created.
 *
 * SCOPE, Plan 01 claims this phase's instrument script, its port pair, and its registry shape
 * with one static-asset check (`pwa-manifest-assets`) that needs only the HTTP+build legs of the
 * sandbox/boot helper set below. Later plans in this phase add headless Chrome and CDP driven
 * checks for the Settings push row, and rely on `resetBuildCache()` (below) to force a genuine
 * rebuild when a break mutates a TypeScript source file rather than a built artifact.
 *
 * Ports, unique against every existing `panel-*.mjs` harness (verified against every `panel-9x.mjs`,
 * `panel-100.mjs` (47876), `panel-104.mjs`, `panel-108.mjs` (47880, 47881)): sandbox server 47882,
 * CDP 9380 (declared now for a later plan's headless Chrome harness, not yet used by this plan).
 * Port 4700 is the user's live service and is forbidden as a sandbox port.
 *
 * Usage:
 *   node scripts/panel-109.mjs                every registered check, exits non-zero on any
 *                                                violation. Refuses to exit 0 if CHECKS is empty,
 *                                                so an accidentally emptied map can never read as
 *                                                a vacuous pass.
 *   node scripts/panel-109.mjs --check <name>  one named check only. Unknown name exits non-zero
 *                                                and lists every registered name.
 *   node scripts/panel-109.mjs --break <name>  that check's OWN break: mutates the real artifact
 *                                                the check reads, confirms the SAME check function
 *                                                the real run uses reports the violation by name
 *                                                (TRIP leg), restores the captured original
 *                                                unconditionally in a `finally`, and re-confirms a
 *                                                clean pass (RESTORE leg). Never edits a source
 *                                                file without capturing and restoring its bytes.
 *   node scripts/panel-109.mjs --probe <name>  a non-assertion measurement run (e.g. an egress
 *                                                verdict). Never registered in CHECKS and never
 *                                                run by a bare invocation: a measurement that can
 *                                                report "blocked" as a legitimate answer would
 *                                                make the suite's exit code meaningless. Unknown
 *                                                name exits non-zero and lists every registered
 *                                                probe name. Exits 0 for either verdict; exits
 *                                                non-zero only when the probe could not run at
 *                                                all (no Chrome binary, server never ready, CDP
 *                                                never came up), an unmeasured environment rather
 *                                                than a blocked one.
 *
 * Exit-code contract: 0 when every requested check reports zero violations, or when a break's
 * trip leg correctly fired and its restore leg re-passed. 1 on any violation, any safety trip
 * (`assertNoLiveService`), or a break whose trip/restore leg did not behave as expected.
 *
 * BREAK EVIDENCE, appended to by every plan in this phase that registers a check. The quoted
 * lines below are the VERBATIM TRIP-leg output captured from a real `--break` run:
 *   - `pwa-manifest-assets` proven able to fail (Plan 01): rewriting the built
 *     `dist/web/manifest.json`'s `"display": "standalone"` to `"display": "browser"` produced
 *     `pwa-manifest-assets: GET /manifest.json expected display exactly "standalone", got
 *     "browser"` against a real booted sandbox server. A clean run reported the observed
 *     `display`, `start_url` and the three icon dimension pairs, machine-verifying the phase's
 *     iOS Home Screen platform precondition.
 *   - `push-row-state-machine` proven able to fail (Plan 04): rewriting `SettingsScreen.tsx`'s
 *     enabled-state comparison from `hasSubscription === true` to `hasSubscription === false`,
 *     rebuilding, and re-running the same check against a real booted sandbox server and real
 *     headless Chrome produced, verbatim:
 *     `push-row-state-machine: leg2 (enabled) expected buttons exactly ["Disable push
 *     notifications"], got ["Enable push notifications"]`
 *     `push-row-state-machine: leg2 (enabled) expected statusText exactly "Push enabled - this
 *     device will get a push notification when a card needs your input, even with the tab
 *     closed.", got null`
 *     `push-row-state-machine: leg2 (enabled) expected statusColor exactly "var(--status-ok)",
 *     got null`
 *     The RESTORE leg re-ran clean (`--break push-row-state-machine RESTORE leg: PASS`) after the
 *     captured bytes were restored, and `git diff --quiet` on `SettingsScreen.tsx` confirmed a
 *     byte-identical restore.
 *   - `denied-state-no-button` proven able to fail (Plan 04): rewriting the push hook's
 *     `permission === "denied"` comparison to `permission === "never-denied"`, rebuilding, and
 *     re-running the same check produced, verbatim:
 *     `denied-state-no-button: expected statusText exactly "Blocked - enable notifications for
 *     this site in your browser settings.", got null`
 *     `denied-state-no-button: expected statusColor exactly "var(--status-down)", got null`
 *     `denied-state-no-button: expected zero buttons in the push row while permission is denied,
 *     got ["Enable push notifications"]`
 *     Dropping the blocked branch fell through to the default branch's dead-button-free "Enable
 *     push notifications" control, exactly the failure the requirement bans. The RESTORE leg
 *     re-ran clean and `git diff --quiet` confirmed a byte-identical restore.
 *   - `push-prompt-on-click-only` proven able to fail (Plan 05): rewriting `push.ts`'s load-time
 *     refresh guard clause `Notification.permission !== "granted"` to `false`, rebuilding, and
 *     re-running the same check against a real booted sandbox server and real headless Chrome
 *     produced, verbatim:
 *     `push-prompt-on-click-only: legC expected no "register" or "subscribe" call recorded for a
 *     stale marker with non-granted permission, got ["register","requestPermission","subscribe"]`
 *     A stale "on" marker with permission still "prompt" now called `register` and `subscribe` on
 *     page load, exactly the drift the guard exists to prevent. The RESTORE leg re-ran clean
 *     (`--break push-prompt-on-click-only RESTORE leg: PASS`) and `git diff --quiet` on `push.ts`
 *     confirmed a byte-identical restore. NOTE: legA and legC deliberately assert only the
 *     absence of "register"/"subscribe", not a blanket "requestPermission never recorded": the
 *     pre-existing, unrelated `useTransitionNotifications` hook (ATTN-01, v0.2 phase 08) also
 *     calls `Notification.requestPermission()` once, unconditionally, on every mount, for desktop
 *     notifications. legB instead compares that call's COUNT immediately before vs. after the
 *     dispatched click, proving the click-driven subscribe path itself adds zero new calls.
 *   - `ios-guidance-branch` proven able to fail (Plan 06): neutering `isIOSDevice` in `push.ts` to
 *     unconditionally `return false`, rebuilding, and re-running the same check against a real
 *     booted sandbox server and real headless Chrome produced, verbatim:
 *     `ios-guidance-branch: leg1 (iPhone) expected labelText exactly "Add to your Home Screen to
 *     enable push", got "Push notifications (this device)"`
 *     `ios-guidance-branch: leg1 (iPhone) expected listItems exactly [...four steps...], got []`
 *     `ios-guidance-branch: leg1 (iPhone) expected zero buttons, got ["Enable push
 *     notifications"]`
 *     `ios-guidance-branch: leg2 (iPad masquerade) expected labelText exactly "Add to your Home
 *     Screen to enable push", got "Push notifications (this device)"`
 *     `ios-guidance-branch: leg2 (iPad masquerade) expected listItems exactly [...four steps...],
 *     got []`
 *     `ios-guidance-branch: leg2 (iPad masquerade) expected zero buttons, got ["Enable push
 *     notifications"]`
 *     Under-detecting BOTH the real iPhone UA and the iPadOS desktop-UA masquerade fell through to
 *     the normal enable control on a device that cannot actually subscribe, exactly the silent
 *     failure PUSH-07 forbids. The RESTORE leg re-ran clean (`--break ios-guidance-branch RESTORE
 *     leg: PASS`) and `git diff --quiet` on `push.ts` confirmed a byte-identical restore. NOTE:
 *     legs 1 and 2 assert only the absence of "register"/"subscribe" from `window.__pushCalls`,
 *     not "requestPermission", for the identical `useTransitionNotifications` reason noted above
 *     for `push-prompt-on-click-only`. NOTE: leg 3's standalone state is seeded by stubbing
 *     `navigator.standalone = true` via an init script, not
 *     `Emulation.setEmulatedMedia({ features: [{ name: "display-mode", value: "standalone" }] })`
 *     as this plan's interfaces named - that CDP call was tried first and confirmed (against a
 *     working `prefers-color-scheme` override through the same endpoint) to accept the
 *     `display-mode` feature without error while never actually changing
 *     `matchMedia("(display-mode: standalone)").matches` on this Chrome build. Stubbing
 *     `navigator.standalone`, the other half of the shipped hook's own OR'd boolean, is a faithful
 *     substitute for the same real-device signal, not a weaker one.
 *
 * ASSUMPTION EVIDENCE (Plan 03). `node scripts/panel-109.mjs --probe fcm-egress` was run 13 times
 * against headless Chrome with a real, unmocked network path while authoring and hardening this
 * probe. The verbatim output of the most recent run:
 *   `probe fcm-egress: VERDICT=reachable outcome=subscribed endpointHost=fcm.googleapis.com`
 * 8 of the 13 runs reported that same `VERDICT=reachable` line with the same `endpointHost`; the
 * other 5 reported `probe fcm-egress: VERDICT=blocked outcome=timeout detail=TimeoutError:
 * subscribe timed out`. No run ever reported a hard rejection (a permission or network-refused
 * error): every observed outcome was either a real subscribe to `fcm.googleapis.com` or the
 * in-page 30 second timeout, so this is a real but flaky egress path, not a structurally blocked
 * one.
 *
 * CONSEQUENCE for the `subscribe-round-trip` check in plan 109-05: this sandbox CAN reach a real
 * push service, so that check drives a real click and asserts a real `board.db` row end to end,
 * the `VERDICT=reachable` branch of this plan's own design. Given the observed ~38% transient
 * timeout rate, that check must tolerate at least one retry of the subscribe step, and should use
 * a generous per-attempt timeout, rather than treating a single slow round trip as a structural
 * block.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants, sandbox/boot helper set. Ported from panel-108.mjs, renamed for
// this phase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const DIST_WEB = join(REPO_ROOT, "dist", "web");
const BUILD_SCRIPT = "build";

const SANDBOX_PORT = 47882;
const SANDBOX_PREFIX = "dispatch-panel-109-";
const CDP_PORT = 9380;

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-109-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-109-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-109-LIVE"))
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

/** Teardown helper: SIGTERM, escalate to SIGKILL after a timeout. Always awaited in a `finally`. */
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
 * Later plans in this phase break UI behavior by mutating a TypeScript source file and
 * rebuilding; without this, `assertBuilt`'s memo would skip that rebuild and the break would
 * mutate dist without the source change ever reaching it.
 */
function resetBuildCache() {
  headBuild = null;
}

/** `entry` is REALPATH'd before being handed to `node`, the macOS /var -> /private/var trap. */
function bootServerAt(home) {
  assertBuilt();
  const env = { ...process.env, HOME: home, NODE_ENV: "production" };
  return spawn("node", [realpathSync(DIST_ENTRY)], {
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function readFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// CDP harness, ported verbatim in substance from panel-100.mjs. Every later
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

/** Identical to {@link evalValue} but for an expression that itself evaluates to a Promise, since
 * every push call the probes make in page returns one.
 *
 * @remarks
 * Passes a 35 second `CDP.send` timeout, deliberately above `FCM_EGRESS_PAGE_EXPRESSION`'s own 30
 * second in-page race: a "blocked" outcome resolves the page promise only after that internal
 * timeout fires, and `CDP.send`'s 20 second default would misreport that legitimate slow path as a
 * lost renderer response instead of the probe's own measured verdict. */
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

// ---------------------------------------------------------------------------
// Settings > Notifications navigation and row reading helpers, reused by
// plans 109-05 and 109-06 in addition to this plan's two checks.
// ---------------------------------------------------------------------------

/** Tracks the targetId of the last page `seedPage` handed out, so the NEXT `seedPage` call can
 * close it once the new target has confirmed navigation, matching `panel-100.mjs`'s
 * fresh-target-per-scenario pattern. */
let lastSeededTargetId = null;

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

/** Opens a fresh page at the sandbox root, closing the previously seeded target, applying the
 * requested notification permission, and, when `initScript` is given, installing it BEFORE
 * navigation so it runs ahead of every app script. Returns the new `sessionId`.
 * @remarks Navigates from `about:blank` rather than passing the sandbox URL to
 * `Target.createTarget` directly, since `Page.addScriptToEvaluateOnNewDocument` must be installed
 * on the target before the real navigation starts. `userAgent`/`platform` and `touchEmulation` are
 * optional device-shape overrides (Plan 06's iOS/iPad legs), applied before `Page.navigate` so
 * `navigator.userAgent`/`platform`/`maxTouchPoints` already report the emulated shape on first
 * paint. `Emulation.setEmulatedMedia({ features: [{ name: "display-mode", ... }] })` was tried and
 * rejected for the standalone leg: verified against this Chrome build that it accepts the call
 * without error but never changes `matchMedia("(display-mode: standalone)").matches` (confirmed
 * `prefers-color-scheme` DOES apply via the same endpoint, isolating this to `display-mode`
 * specifically not being a supported override feature) - the standalone leg instead stubs
 * `navigator.standalone` via `initScript`, the other half of the same OR'd boolean the shipped
 * hook already reads. */
async function seedPage(
  cdp,
  { permission, initScript, userAgent, platform, touchEmulation },
) {
  const origin = `http://127.0.0.1:${SANDBOX_PORT}`;
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
  if (userAgent) {
    await cdp.send(
      "Emulation.setUserAgentOverride",
      { userAgent, platform },
      sessionId,
    );
  }
  if (touchEmulation) {
    await cdp.send(
      "Emulation.setTouchEmulationEnabled",
      { enabled: true, maxTouchPoints: 5 },
      sessionId,
    );
  }
  await cdp.send("Browser.setPermission", {
    origin,
    permission: { name: "notifications" },
    setting: permission,
  });
  if (initScript) {
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: initScript },
      sessionId,
    );
  }
  await cdp.send("Page.navigate", { url: `${origin}/` }, sessionId);
  const loaded = await pollUntilTruthy(
    cdp,
    sessionId,
    `document.readyState === "complete"`,
    READY_TIMEOUT_MS,
  );
  if (!loaded) {
    throw new Error(
      `seedPage: navigation to ${origin}/ never reached document.readyState "complete" within ${READY_TIMEOUT_MS}ms`,
    );
  }
  if (lastSeededTargetId != null) {
    await cdp
      .send("Target.closeTarget", { targetId: lastSeededTargetId })
      .catch(() => {});
  }
  lastSeededTargetId = targetId;
  return sessionId;
}

const SETTINGS_NAV_TIMEOUT_MS = 15_000;

/** Clicks through Settings > Notifications on an already-seeded page: the Settings trigger, then
 * the "Notifications" section nav button, then waits for the push row's label span to exist.
 * Throws with the last observed DOM state on timeout. Both clicks are synthetic `.click()` calls
 * deliberately: this path only navigates and depends on no trusted user activation, reserving real
 * input dispatch for the Enable button a later plan drives. */
async function openSettingsNotifications(cdp, sessionId) {
  const domSnapshot = async () => {
    try {
      return await evalValue(
        cdp,
        sessionId,
        `document.body ? document.body.innerHTML.slice(0, 2000) : "(no body)"`,
      );
    } catch (err) {
      return `(could not read DOM: ${err instanceof Error ? err.message : String(err)})`;
    }
  };

  const trigger = await pollUntilTruthy(
    cdp,
    sessionId,
    `!!document.querySelector('[aria-label="Sync filters"]')`,
    SETTINGS_NAV_TIMEOUT_MS,
  );
  if (!trigger) {
    throw new Error(
      `openSettingsNotifications: Settings trigger [aria-label="Sync filters"] never appeared ` +
        `within ${SETTINGS_NAV_TIMEOUT_MS}ms. Last observed DOM:\n${await domSnapshot()}`,
    );
  }
  await evalValue(
    cdp,
    sessionId,
    `document.querySelector('[aria-label="Sync filters"]').click()`,
  );

  const dialog = await pollUntilTruthy(
    cdp,
    sessionId,
    `!!document.querySelector('div[role="dialog"][aria-label="Settings"]')`,
    SETTINGS_NAV_TIMEOUT_MS,
  );
  if (!dialog) {
    throw new Error(
      `openSettingsNotifications: Settings dialog never appeared within ${SETTINGS_NAV_TIMEOUT_MS}ms ` +
        `after clicking the trigger. Last observed DOM:\n${await domSnapshot()}`,
    );
  }

  const navClicked = await evalValue(
    cdp,
    sessionId,
    `(() => {
      const btn = [...document.querySelectorAll('nav[aria-label="Settings sections"] button')]
        .find((b) => b.textContent.trim() === "Notifications");
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
  if (!navClicked) {
    const navLabels = await evalValue(
      cdp,
      sessionId,
      `[...document.querySelectorAll('nav[aria-label="Settings sections"] button')].map((b) => b.textContent.trim())`,
    );
    throw new Error(
      `openSettingsNotifications: no Settings section nav button with trimmed text ` +
        `"Notifications" was found. Observed nav button labels: ${JSON.stringify(navLabels)}`,
    );
  }

  const rowLabel = await pollUntilTruthy(
    cdp,
    sessionId,
    `!!([...document.querySelectorAll("span")].find((s) =>
      s.textContent === "Push notifications (this device)" ||
      s.textContent === "Add to your Home Screen to enable push"
    ))`,
    SETTINGS_NAV_TIMEOUT_MS,
  );
  if (!rowLabel) {
    throw new Error(
      `openSettingsNotifications: the push row's label span never appeared within ` +
        `${SETTINGS_NAV_TIMEOUT_MS}ms after navigating to Notifications. Last observed DOM:\n${await domSnapshot()}`,
    );
  }
}

/** Scrapes the rendered push row into a plain object. Returns `{ found: false }` rather than
 * throwing when the row is absent, so a check can report a named violation instead of a stack
 * trace. */
async function readPushRow(cdp, sessionId) {
  return evalValue(
    cdp,
    sessionId,
    `
    (() => {
      const label = [...document.querySelectorAll("span")].find((s) =>
        s.textContent === "Push notifications (this device)" ||
        s.textContent === "Add to your Home Screen to enable push"
      );
      if (!label) return { found: false };
      const row = label.parentElement;
      const statusEl = row.querySelector('[role="status"]');
      const alertEl = row.querySelector('[role="alert"]');
      const dot = statusEl ? statusEl.querySelector('span[aria-hidden="true"]') : null;
      return {
        found: true,
        labelText: label.textContent,
        text: row.innerText,
        buttons: [...row.querySelectorAll("button")].map((b) => b.textContent.trim()),
        statusText: statusEl ? statusEl.textContent.trim() : null,
        statusColor: dot ? dot.style.background : null,
        alertText: alertEl ? alertEl.textContent.trim() : null,
        listItems: [...row.querySelectorAll("li")].map((li) => li.textContent),
      };
    })()
    `,
  );
}

/** Locates a button anywhere in the document by exact trimmed `textContent` and returns its
 * bounding-rect center, or `null` if no such button is currently rendered. Shared by every real
 * `Input.dispatchMouseEvent` click plans 109-05 and 109-06 issue. */
async function findButtonRect(cdp, sessionId, label) {
  return evalValue(
    cdp,
    sessionId,
    `(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === ${JSON.stringify(label)},
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
}

/** Real `Input.dispatchMouseEvent` press then release at `point`, the one real-input click
 * primitive this phase uses (`panel-100.mjs`'s own press/move/release recipe, without the
 * intermediate moves a plain click needs none of), reserved for the Enable/Disable push buttons
 * whose click-driven-only trust boundary this phase exists to prove. */
async function dispatchRealClick(cdp, sessionId, point) {
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
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
    },
    sessionId,
  );
}

/** Installed via `Page.addScriptToEvaluateOnNewDocument` for the "live subscription" leg: stubs
 * only `navigator.serviceWorker.getRegistration`, the one browser API boundary
 * `readPushSubscription` reads, and nothing in the app's own hook, derivation or render path. */
const ENABLED_SUBSCRIPTION_INIT_SCRIPT = `
(() => {
  const subscription = {
    endpoint: "https://example.invalid/panel-109-state",
    unsubscribe: async () => true,
    toJSON: () => ({
      endpoint: "https://example.invalid/panel-109-state",
      keys: { p256dh: "x", auth: "y" },
    }),
  };
  const registration = {
    pushManager: {
      getSubscription: async () => subscription,
    },
  };
  navigator.serviceWorker.getRegistration = async () => registration;
})();
`;

/** Installed via `Page.addScriptToEvaluateOnNewDocument` for the "push unsupported" leg: deletes
 * `window.PushManager` while leaving `Notification` in place, so `isPushSupported()` reads false
 * for the real reason (no PushManager) rather than a fabricated one. */
const UNSUPPORTED_INIT_SCRIPT = `
(() => {
  delete window.PushManager;
})();
`;

// ---------------------------------------------------------------------------
// pwa-manifest-assets: boots a real sandbox production server and asserts,
// over real HTTP, the parsed manifest field values and the four served
// files' actual bytes, never file presence alone.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Parses a PNG's IHDR width/height from its first 24 bytes (signature + chunk header). */
function parsePngDimensions(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function assertPngAsset(label, url, expected, violations) {
  const res = await fetch(url);
  const contentType = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) {
    violations.push(`${label}: expected status 200, got ${res.status}`);
    return;
  }
  if (!contentType.startsWith("image/png")) {
    violations.push(
      `${label}: expected content-type starting "image/png", got ${JSON.stringify(contentType)}`,
    );
  }
  const sigOk =
    buf.length >= 8 && PNG_SIGNATURE.every((byte, idx) => buf[idx] === byte);
  if (!sigOk) {
    violations.push(`${label}: response body is not a valid PNG signature`);
    return;
  }
  const { width, height } = parsePngDimensions(buf);
  const observed = `${width}x${height}`;
  console.log(
    `pwa-manifest-assets: observed ${label} dimensions = ${observed}`,
  );
  if (width !== expected.width || height !== expected.height) {
    violations.push(
      `${label}: expected ${expected.width}x${expected.height}, got ${observed}`,
    );
  }
}

async function checkPwaManifestAssets(violations) {
  assertBuilt();
  const home = makeSandboxHome("pwa");
  let child;
  try {
    child = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);
    const base = `http://127.0.0.1:${SANDBOX_PORT}`;

    const manifestRes = await fetch(`${base}/manifest.json`);
    const manifestContentType = manifestRes.headers.get("content-type") ?? "";
    const manifestBody = await manifestRes.text();
    if (manifestRes.status !== 200) {
      violations.push(
        `pwa-manifest-assets: GET /manifest.json expected status 200, got ${manifestRes.status}`,
      );
    }
    if (!manifestContentType.startsWith("application/json")) {
      violations.push(
        `pwa-manifest-assets: GET /manifest.json expected content-type starting "application/json", got ${JSON.stringify(manifestContentType)}`,
      );
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestBody);
    } catch (err) {
      violations.push(
        `pwa-manifest-assets: GET /manifest.json body does not parse as JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      manifest = null;
    }
    if (manifest != null) {
      console.log(
        `pwa-manifest-assets: observed display=${JSON.stringify(manifest.display)} start_url=${JSON.stringify(manifest.start_url)}`,
      );
      if (manifest.display !== "standalone") {
        violations.push(
          `pwa-manifest-assets: GET /manifest.json expected display exactly "standalone", got ${JSON.stringify(manifest.display)}`,
        );
      }
      if (manifest.start_url !== "/") {
        violations.push(
          `pwa-manifest-assets: GET /manifest.json expected start_url exactly "/", got ${JSON.stringify(manifest.start_url)}`,
        );
      }
      if (manifest.name !== "Dispatch") {
        violations.push(
          `pwa-manifest-assets: GET /manifest.json expected name exactly "Dispatch", got ${JSON.stringify(manifest.name)}`,
        );
      }
      const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
      for (const src of ["/icon-192.png", "/icon-512.png"]) {
        if (!icons.some((icon) => icon && icon.src === src)) {
          violations.push(
            `pwa-manifest-assets: GET /manifest.json icons array is missing an entry with src ${JSON.stringify(src)}`,
          );
        }
      }
    }

    await assertPngAsset(
      "GET /apple-touch-icon.png",
      `${base}/apple-touch-icon.png`,
      { width: 180, height: 180 },
      violations,
    );
    await assertPngAsset(
      "GET /icon-192.png",
      `${base}/icon-192.png`,
      { width: 192, height: 192 },
      violations,
    );
    await assertPngAsset(
      "GET /icon-512.png",
      `${base}/icon-512.png`,
      { width: 512, height: 512 },
      violations,
    );

    const rootRes = await fetch(`${base}/`);
    const rootBody = await rootRes.text();
    if (!rootBody.includes('rel="manifest"')) {
      violations.push(
        `pwa-manifest-assets: GET / body does not contain rel="manifest"`,
      );
    }
    if (!rootBody.includes('rel="apple-touch-icon"')) {
      violations.push(
        `pwa-manifest-assets: GET / body does not contain rel="apple-touch-icon"`,
      );
    }

    const terminalPath = join(DIST_WEB, "terminal.html");
    const terminalBody = existsSync(terminalPath)
      ? readFileSync(terminalPath, "utf8")
      : "";
    if (
      terminalBody.includes("manifest") ||
      terminalBody.includes("apple-touch-icon")
    ) {
      violations.push(
        `pwa-manifest-assets: dist/web/terminal.html contains "manifest" or "apple-touch-icon", it must contain neither`,
      );
    }
  } finally {
    await stopServer(child);
    cleanupSandboxHome(home);
  }
}

/** `--break pwa-manifest-assets`: mutates the BUILT artifact (`dist/web/manifest.json`), not the
 * source, since editing dist needs no rebuild and any subsequent `npm run build` regenerates it
 * regardless. `assertBuilt()` runs FIRST, before the mutation, so it caches `headBuild` and the
 * SAME check function's own internal `assertBuilt()` call skips rebuilding the tree out from
 * under the mutated dist file. */
async function runBreakPwaManifestAssets() {
  assertBuilt();

  const distManifestPath = join(DIST_WEB, "manifest.json");
  const TARGET = '"display": "standalone"';
  const REPLACEMENT = '"display": "browser"';
  const original = readFileSync(distManifestPath, "utf8");
  const occurrences = original.split(TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel109: refusing to run --break pwa-manifest-assets, expected ${TARGET} to occur exactly ` +
        `once in ${distManifestPath}, measured ${occurrences}. A miscounted anchor would mutate ` +
        `the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  try {
    writeFileSync(distManifestPath, original.replace(TARGET, REPLACEMENT));

    const tripViolations = [];
    await checkPwaManifestAssets(tripViolations);
    console.log(
      `\n--break pwa-manifest-assets TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes('expected display exactly "standalone"'),
    );
  } finally {
    writeFileSync(distManifestPath, original);
  }

  const restoreViolations = [];
  await checkPwaManifestAssets(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break pwa-manifest-assets RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// push-row-state-machine: pins the row's default, enabled and unsupported
// branches to the real rendered DOM of a real build in real headless Chrome.
// ---------------------------------------------------------------------------

const PUSH_ROW_DEFAULT_COPY =
  "Get a push notification when a card needs your input, even with the tab closed.";
const PUSH_ROW_ENABLED_STATUS =
  "Push enabled - this device will get a push notification when a card needs your input, even with the tab closed.";

async function checkPushRowStateMachine(violations) {
  assertBuilt();
  const home = makeSandboxHome("push-row-state");
  let server;
  let chromeChild;
  let cdp;
  try {
    server = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);
    chromeChild = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    // Leg 1: nothing subscribed, permission prompt -> the "default" branch.
    const sessionId1 = await seedPage(cdp, { permission: "prompt" });
    await openSettingsNotifications(cdp, sessionId1);
    const row1 = await readPushRow(cdp, sessionId1);
    console.log(
      `push-row-state-machine: leg1 (default) observed buttons=${JSON.stringify(row1.buttons)} ` +
        `statusText=${JSON.stringify(row1.statusText)} statusColor=${JSON.stringify(row1.statusColor)}`,
    );
    if (!row1.found) {
      violations.push(
        "push-row-state-machine: leg1 (default) - the push row was never found",
      );
    } else {
      if (
        JSON.stringify(row1.buttons) !==
        JSON.stringify(["Enable push notifications"])
      ) {
        violations.push(
          `push-row-state-machine: leg1 (default) expected buttons exactly ["Enable push notifications"], got ${JSON.stringify(row1.buttons)}`,
        );
      }
      if (!row1.text.includes(PUSH_ROW_DEFAULT_COPY)) {
        violations.push(
          `push-row-state-machine: leg1 (default) expected row text to contain ${JSON.stringify(PUSH_ROW_DEFAULT_COPY)}, got ${JSON.stringify(row1.text)}`,
        );
      }
      if (row1.statusText !== null) {
        violations.push(
          `push-row-state-machine: leg1 (default) expected statusText null, got ${JSON.stringify(row1.statusText)}`,
        );
      }
      if (row1.alertText !== null) {
        violations.push(
          `push-row-state-machine: leg1 (default) expected alertText null, got ${JSON.stringify(row1.alertText)}`,
        );
      }
    }

    // Leg 2: live subscription, permission granted -> the "enabled" branch.
    const sessionId2 = await seedPage(cdp, {
      permission: "granted",
      initScript: ENABLED_SUBSCRIPTION_INIT_SCRIPT,
    });
    await openSettingsNotifications(cdp, sessionId2);
    const row2 = await readPushRow(cdp, sessionId2);
    console.log(
      `push-row-state-machine: leg2 (enabled) observed buttons=${JSON.stringify(row2.buttons)} ` +
        `statusText=${JSON.stringify(row2.statusText)} statusColor=${JSON.stringify(row2.statusColor)}`,
    );
    if (!row2.found) {
      violations.push(
        "push-row-state-machine: leg2 (enabled) - the push row was never found",
      );
    } else {
      if (
        JSON.stringify(row2.buttons) !==
        JSON.stringify(["Disable push notifications"])
      ) {
        violations.push(
          `push-row-state-machine: leg2 (enabled) expected buttons exactly ["Disable push notifications"], got ${JSON.stringify(row2.buttons)}`,
        );
      }
      if (row2.statusText !== PUSH_ROW_ENABLED_STATUS) {
        violations.push(
          `push-row-state-machine: leg2 (enabled) expected statusText exactly ${JSON.stringify(PUSH_ROW_ENABLED_STATUS)}, got ${JSON.stringify(row2.statusText)}`,
        );
      }
      if (row2.statusColor !== "var(--status-ok)") {
        violations.push(
          `push-row-state-machine: leg2 (enabled) expected statusColor exactly "var(--status-ok)", got ${JSON.stringify(row2.statusColor)}`,
        );
      }
    }

    // Leg 3: push unsupported (window.PushManager deleted) -> the "unsupported" branch.
    const sessionId3 = await seedPage(cdp, {
      permission: "prompt",
      initScript: UNSUPPORTED_INIT_SCRIPT,
    });
    await openSettingsNotifications(cdp, sessionId3);
    const row3 = await readPushRow(cdp, sessionId3);
    console.log(
      `push-row-state-machine: leg3 (unsupported) observed text=${JSON.stringify(row3.text)} buttons=${JSON.stringify(row3.buttons)}`,
    );
    if (!row3.found) {
      violations.push(
        "push-row-state-machine: leg3 (unsupported) - the push row was never found",
      );
    } else {
      if (!row3.text.includes("Not supported in this browser.")) {
        violations.push(
          `push-row-state-machine: leg3 (unsupported) expected row text to contain "Not supported in this browser.", got ${JSON.stringify(row3.text)}`,
        );
      }
      if (row3.buttons.length !== 0) {
        violations.push(
          `push-row-state-machine: leg3 (unsupported) expected zero buttons, got ${JSON.stringify(row3.buttons)}`,
        );
      }
    }
  } finally {
    if (cdp) cdp.close();
    await stopServer(chromeChild);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(server);
    cleanupSandboxHome(home);
  }
}

/** `--break push-row-state-machine`: mutates `SettingsScreen.tsx`'s enabled-state comparison
 * (`hasSubscription === true` -> `hasSubscription === false`), rebuilds via `resetBuildCache()`,
 * and requires leg 2's violation by name. Restores the captured bytes in a `finally`
 * unconditionally, so a thrown check error still leaves the source untouched. */
async function runBreakPushRowStateMachine() {
  assertBuilt();
  const settingsPath = join(
    REPO_ROOT,
    "src/web/features/settings/SettingsScreen.tsx",
  );
  const TARGET = "hasSubscription === true";
  const REPLACEMENT = "hasSubscription === false";
  const original = readFileSync(settingsPath, "utf8");
  const occurrences = original.split(TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel109: refusing to run --break push-row-state-machine, expected ${JSON.stringify(TARGET)} ` +
        `to occur exactly once in ${settingsPath}, measured ${occurrences}. A miscounted anchor ` +
        `would mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  try {
    writeFileSync(settingsPath, original.replace(TARGET, REPLACEMENT));
    resetBuildCache();

    const tripViolations = [];
    await checkPushRowStateMachine(tripViolations);
    console.log(
      `\n--break push-row-state-machine TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) => v.includes("leg2 (enabled)"));
  } finally {
    writeFileSync(settingsPath, original);
    resetBuildCache();
  }

  const restoreViolations = [];
  await checkPushRowStateMachine(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break push-row-state-machine RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// denied-state-no-button: the blocked state is an explicit status row with no
// actionable control, never a button that does nothing (the requirement's
// dead-button ban).
// ---------------------------------------------------------------------------

const PUSH_ROW_DENIED_STATUS =
  "Blocked - enable notifications for this site in your browser settings.";

async function checkDeniedStateNoButton(violations) {
  assertBuilt();
  const home = makeSandboxHome("denied-state");
  let server;
  let chromeChild;
  let cdp;
  try {
    server = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);
    chromeChild = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const sessionId = await seedPage(cdp, { permission: "denied" });
    await openSettingsNotifications(cdp, sessionId);

    const permission = await evalValue(
      cdp,
      sessionId,
      `("Notification" in window) ? Notification.permission : "unsupported"`,
    );
    console.log(
      `denied-state-no-button: observed Notification.permission=${JSON.stringify(permission)}`,
    );
    if (permission !== "denied") {
      violations.push(
        `denied-state-no-button: positive control failed, expected Notification.permission ` +
          `exactly "denied", got ${JSON.stringify(permission)}. The CDP permission seed may have ` +
          `silently failed, which would make every later assertion in this check vacuous.`,
      );
    }

    const row = await readPushRow(cdp, sessionId);
    console.log(
      `denied-state-no-button: observed statusText=${JSON.stringify(row.statusText)} ` +
        `statusColor=${JSON.stringify(row.statusColor)} buttons=${JSON.stringify(row.buttons)}`,
    );
    if (!row.found) {
      violations.push("denied-state-no-button: the push row was never found");
      return;
    }
    if (row.statusText !== PUSH_ROW_DENIED_STATUS) {
      violations.push(
        `denied-state-no-button: expected statusText exactly ${JSON.stringify(PUSH_ROW_DENIED_STATUS)}, got ${JSON.stringify(row.statusText)}`,
      );
    }
    if (row.statusColor !== "var(--status-down)") {
      violations.push(
        `denied-state-no-button: expected statusColor exactly "var(--status-down)", got ${JSON.stringify(row.statusColor)}`,
      );
    }
    if (row.buttons.length !== 0) {
      violations.push(
        `denied-state-no-button: expected zero buttons in the push row while permission is denied, got ${JSON.stringify(row.buttons)}`,
      );
    }
    if (row.alertText !== null) {
      violations.push(
        `denied-state-no-button: expected alertText null, got ${JSON.stringify(row.alertText)}`,
      );
    }
  } finally {
    if (cdp) cdp.close();
    await stopServer(chromeChild);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(server);
    cleanupSandboxHome(home);
  }
}

/** `--break denied-state-no-button`: mutates the push hook's `permission === "denied"`
 * comparison to a value that can never occur, rebuilds via `resetBuildCache()`, and requires BOTH
 * the missing blocked copy violation and the button-present violation, since dropping the blocked
 * branch is precisely what makes the row fall through to the enable button. Restores the captured
 * bytes in a `finally` unconditionally. */
async function runBreakDeniedStateNoButton() {
  assertBuilt();
  const settingsPath = join(
    REPO_ROOT,
    "src/web/features/settings/SettingsScreen.tsx",
  );
  const TARGET = 'permission === "denied"';
  const REPLACEMENT = 'permission === "never-denied"';
  const original = readFileSync(settingsPath, "utf8");
  const occurrences = original.split(TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel109: refusing to run --break denied-state-no-button, expected ${JSON.stringify(TARGET)} ` +
        `to occur exactly once in ${settingsPath}, measured ${occurrences}. The adjacent desktop ` +
        `permission hook compares a differently named variable; a miscounted anchor would mutate ` +
        `the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  try {
    writeFileSync(settingsPath, original.replace(TARGET, REPLACEMENT));
    resetBuildCache();

    const tripViolations = [];
    await checkDeniedStateNoButton(tripViolations);
    console.log(
      `\n--break denied-state-no-button TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    const missingBlockedCopy = tripViolations.some((v) =>
      v.includes("expected statusText exactly"),
    );
    const buttonPresent = tripViolations.some((v) =>
      v.includes("expected zero buttons"),
    );
    tripFired = missingBlockedCopy && buttonPresent;
  } finally {
    writeFileSync(settingsPath, original);
    resetBuildCache();
  }

  const restoreViolations = [];
  await checkDeniedStateNoButton(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break denied-state-no-button RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// push-prompt-on-click-only (Plan 05): proves PUSH-01's negative half. Three
// legs, all against real wrapped browser push APIs: a fresh visitor's load
// calls nothing, a real dispatched click reaches register then subscribe and
// never requestPermission, and a stale "on" marker with a non-granted
// permission still calls nothing on load.
// ---------------------------------------------------------------------------

/** Installed via `Page.addScriptToEvaluateOnNewDocument` on every target this check opens.
 * WRAPS (never replaces) the three browser push APIs whose call site is the entire PUSH-01
 * negative claim: capture the original, push a label onto `window.__pushCalls`, then delegate to
 * the original. A stub that swallowed the call instead of delegating would make every leg of this
 * check vacuous, since the app's own subscribe flow would silently stop working underneath it. */
const PUSH_CALL_RECORDER_INIT_SCRIPT = `
(() => {
  window.__pushCalls = [];
  const origRequestPermission = Notification.requestPermission.bind(Notification);
  Notification.requestPermission = function (...args) {
    window.__pushCalls.push("requestPermission");
    return origRequestPermission(...args);
  };
  const origRegister = ServiceWorkerContainer.prototype.register;
  ServiceWorkerContainer.prototype.register = function (...args) {
    window.__pushCalls.push("register");
    return origRegister.apply(this, args);
  };
  const origSubscribe = PushManager.prototype.subscribe;
  PushManager.prototype.subscribe = function (...args) {
    window.__pushCalls.push("subscribe");
    return origSubscribe.apply(this, args);
  };
})();
`;

/** Leg C's init script: the call recorder above, plus writing the exact "previously enabled"
 * marker `enablePush` itself writes (`dsp.push` = `"on"`), before any app script runs, so the app
 * mounts believing push was already on while the seeded permission is `"prompt"`, not `"granted"`,
 * the drift case where a marker-only load guard would wrongly re-subscribe. */
const PUSH_STALE_MARKER_INIT_SCRIPT = `
${PUSH_CALL_RECORDER_INIT_SCRIPT}
localStorage.setItem("dsp.push", "on");
`;

const PUSH_CALL_SETTLE_MS = 750;
const PUSH_CALL_POLL_TIMEOUT_MS = 15_000;

async function checkPushPromptOnClickOnly(violations) {
  assertBuilt();
  const home = makeSandboxHome("prompt-click");
  let server;
  let chromeChild;
  let cdp;
  try {
    server = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);
    chromeChild = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();
    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;

    // Leg A: fresh visitor, no marker, permission "prompt" -> nothing calls a push API.
    const sessionId = await seedPage(cdp, {
      permission: "prompt",
      initScript: PUSH_CALL_RECORDER_INIT_SCRIPT,
    });
    const shellReadyA = await pollUntilTruthy(
      cdp,
      sessionId,
      `!!document.querySelector('[aria-label="Sync filters"]')`,
      SETTINGS_NAV_TIMEOUT_MS,
    );
    if (!shellReadyA) {
      violations.push(
        "push-prompt-on-click-only: legA - the app shell never rendered",
      );
      return;
    }
    await sleep(PUSH_CALL_SETTLE_MS);
    await openSettingsNotifications(cdp, sessionId);
    const rowA = await readPushRow(cdp, sessionId);
    const callsA = await evalValue(cdp, sessionId, `window.__pushCalls`);
    const registrationsA = await evalAsyncValue(
      cdp,
      sessionId,
      `navigator.serviceWorker.getRegistrations().then((regs) => regs.length)`,
    );
    const permissionA = await evalValue(
      cdp,
      sessionId,
      `Notification.permission`,
    );
    console.log(
      `push-prompt-on-click-only: legA observed calls=${JSON.stringify(callsA)} ` +
        `registrations=${registrationsA} permission=${JSON.stringify(permissionA)} ` +
        `buttons=${JSON.stringify(rowA.buttons)}`,
    );
    if (
      !Array.isArray(callsA) ||
      callsA.includes("register") ||
      callsA.includes("subscribe")
    ) {
      violations.push(
        `push-prompt-on-click-only: legA expected no "register" or "subscribe" call recorded on a ` +
          `fresh load, got ${JSON.stringify(callsA)}`,
      );
    }
    if (registrationsA !== 0) {
      violations.push(
        `push-prompt-on-click-only: legA expected zero service worker registrations, got ${registrationsA}`,
      );
    }
    if (permissionA !== "default") {
      violations.push(
        `push-prompt-on-click-only: legA expected Notification.permission exactly "default", got ${JSON.stringify(permissionA)}`,
      );
    }
    if (
      !rowA.found ||
      JSON.stringify(rowA.buttons) !==
        JSON.stringify(["Enable push notifications"])
    ) {
      violations.push(
        `push-prompt-on-click-only: legA (positive control) expected the row's buttons exactly ` +
          `["Enable push notifications"], got ${rowA.found ? JSON.stringify(rowA.buttons) : "(row not found)"}`,
      );
    }

    // Leg B: the real click, same page/session as leg A. The grant is applied only now, after
    // leg A already observed Notification.permission === "default", so the ordering claim rests
    // on an observation taken before the grant, never on the grant itself.
    //
    // requestPermission's COUNT (not its mere presence) is what legB compares before vs. after
    // the click: this app's pre-existing, unrelated useTransitionNotifications hook (ATTN-01, a
    // desktop-notification feature from v0.2 phase 08) also calls Notification.requestPermission
    // once, unconditionally, on every mount, independent of push and out of this plan's scope to
    // change. A blanket "never recorded" ban would false-positive against that legitimate call on
    // every single leg; comparing the count immediately before the click to the count after still
    // proves the actual claim this leg exists for, that the click-driven subscribe path itself
    // never triggers an ADDITIONAL requestPermission call of its own.
    const requestPermissionCountBeforeClick = (
      Array.isArray(callsA) ? callsA : []
    ).filter((c) => c === "requestPermission").length;
    await grantNotifications(cdp, origin);
    const enableRect = await findButtonRect(
      cdp,
      sessionId,
      "Enable push notifications",
    );
    if (!enableRect) {
      violations.push(
        "push-prompt-on-click-only: legB - the Enable push notifications button was not found before dispatching the click",
      );
    } else {
      await dispatchRealClick(cdp, sessionId, enableRect);
      const deadline = Date.now() + PUSH_CALL_POLL_TIMEOUT_MS;
      let callsB = null;
      while (Date.now() < deadline) {
        callsB = await evalValue(cdp, sessionId, `window.__pushCalls`);
        if (callsB.includes("register") && callsB.includes("subscribe")) break;
        await sleep(POLL_INTERVAL_MS);
      }
      console.log(
        `push-prompt-on-click-only: legB observed calls=${JSON.stringify(callsB)} ` +
          `(requestPermission count before click: ${requestPermissionCountBeforeClick})`,
      );
      if (
        !Array.isArray(callsB) ||
        !callsB.includes("register") ||
        !callsB.includes("subscribe")
      ) {
        violations.push(
          `push-prompt-on-click-only: legB expected window.__pushCalls to contain both "register" ` +
            `and "subscribe" within ${PUSH_CALL_POLL_TIMEOUT_MS}ms of the click, got ${JSON.stringify(callsB)}`,
        );
      } else {
        if (callsB.indexOf("register") > callsB.indexOf("subscribe")) {
          violations.push(
            `push-prompt-on-click-only: legB expected "register" to be recorded before "subscribe", got ${JSON.stringify(callsB)}`,
          );
        }
        const requestPermissionCountAfterClick = callsB.filter(
          (c) => c === "requestPermission",
        ).length;
        if (
          requestPermissionCountAfterClick !== requestPermissionCountBeforeClick
        ) {
          violations.push(
            `push-prompt-on-click-only: legB expected the click-driven subscribe path to add zero ` +
              `NEW "requestPermission" calls (before: ${requestPermissionCountBeforeClick}, after: ` +
              `${requestPermissionCountAfterClick}), got ${JSON.stringify(callsB)}`,
          );
        }
      }
    }

    // Leg C: fresh target, stale "on" marker, permission still "prompt" -> the drift case.
    const sessionIdC = await seedPage(cdp, {
      permission: "prompt",
      initScript: PUSH_STALE_MARKER_INIT_SCRIPT,
    });
    const shellReadyC = await pollUntilTruthy(
      cdp,
      sessionIdC,
      `!!document.querySelector('[aria-label="Sync filters"]')`,
      SETTINGS_NAV_TIMEOUT_MS,
    );
    if (!shellReadyC) {
      violations.push(
        "push-prompt-on-click-only: legC - the app shell never rendered",
      );
      return;
    }
    await sleep(PUSH_CALL_SETTLE_MS);
    const callsC = await evalValue(cdp, sessionIdC, `window.__pushCalls`);
    console.log(
      `push-prompt-on-click-only: legC observed calls=${JSON.stringify(callsC)}`,
    );
    if (
      !Array.isArray(callsC) ||
      callsC.includes("register") ||
      callsC.includes("subscribe")
    ) {
      violations.push(
        `push-prompt-on-click-only: legC expected no "register" or "subscribe" call recorded for a ` +
          `stale marker with non-granted permission, got ${JSON.stringify(callsC)}`,
      );
    }
  } finally {
    if (cdp) cdp.close();
    await stopServer(chromeChild);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(server);
    cleanupSandboxHome(home);
  }
}

/** `--break push-prompt-on-click-only`: mutates `push.ts`'s load-time refresh guard clause
 * (`Notification.permission !== "granted"` -> `false`), rebuilds via `resetBuildCache()`, and
 * requires leg C's violation by name (calls recorded on a load with a stale marker but no live
 * permission). Restores the captured bytes in a `finally` unconditionally. */
async function runBreakPushPromptOnClickOnly() {
  assertBuilt();
  const pushTsPath = join(REPO_ROOT, "src/web/lib/push.ts");
  const TARGET = 'Notification.permission !== "granted"';
  const REPLACEMENT = "false";
  const original = readFileSync(pushTsPath, "utf8");
  const occurrences = original.split(TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel109: refusing to run --break push-prompt-on-click-only, expected ${JSON.stringify(TARGET)} ` +
        `to occur exactly once in ${pushTsPath}, measured ${occurrences}. A miscounted anchor would ` +
        `mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  try {
    writeFileSync(pushTsPath, original.replace(TARGET, REPLACEMENT));
    resetBuildCache();

    const tripViolations = [];
    await checkPushPromptOnClickOnly(tripViolations);
    console.log(
      `\n--break push-prompt-on-click-only TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) => v.includes("legC"));
  } finally {
    writeFileSync(pushTsPath, original);
    resetBuildCache();
  }

  const restoreViolations = [];
  await checkPushPromptOnClickOnly(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break push-prompt-on-click-only RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// subscribe-round-trip (Plan 05): proves PUSH-01's positive half end to end
// against real storage. Enabling writes exactly one push_subscriptions row,
// a reload preserves that same row, and disabling removes it.
//
// Two sanctioned designs (109-RESEARCH.md Pitfall 3), keyed off the
// `fcm-egress` probe's recorded ASSUMPTION EVIDENCE verdict above:
//   - Design R ("reachable", LIVE here): no page-world stub at all. Every leg
//     drives a real click against a real headless Chrome that reaches the
//     real push service, matching this sandbox's measured verdict (8/13
//     reachable, 5/13 transient timeout, zero hard rejections).
//     `attemptSubscribeEnable` tolerates one retry with a 40 second
//     per-attempt timeout to absorb that measured ~38% transient timeout
//     rate rather than treating one slow round trip as a structural block.
//   - Design B ("blocked", NOT live): would override only
//     `PushManager.prototype.subscribe` and `.getSubscription` to resolve a
//     synthetic subscription, leaving the real public-key fetch, the real
//     POST /api/push/subscribe carrying the real `toJSON()` output, the real
//     row write, the real render branch and the real unsubscribe route call
//     untouched, since only the browser-to-push-service hop is unreachable.
//     The true end-to-end hop would then be carried by the human
//     verification checkpoint in plan 109-06 instead of being silently
//     claimed as automated here.
// ---------------------------------------------------------------------------

const SUBSCRIBE_ATTEMPT_TIMEOUT_MS = 40_000;
const SUBSCRIBE_MAX_ATTEMPTS = 2;
const SUBSCRIBE_RELOAD_TIMEOUT_MS = 15_000;
const SUBSCRIBE_DISABLE_TIMEOUT_MS = 15_000;

/** Independent read of the sandbox `board.db`'s `push_subscriptions` table, never trusting the
 * UI's own claim that a subscribe or unsubscribe succeeded. */
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

/** Dispatches a real click on the currently rendered "Enable push notifications" button, if one
 * is present (absent means a previous attempt's promise is still in flight, so this call keeps
 * polling instead of clicking again), then polls the rendered row for either the "enabled"
 * outcome or the error alert `enablePush`'s failure path renders, bounded by `timeoutMs`. */
async function attemptSubscribeEnable(cdp, sessionId, timeoutMs) {
  const rect = await findButtonRect(
    cdp,
    sessionId,
    "Enable push notifications",
  );
  if (rect) {
    await dispatchRealClick(cdp, sessionId, rect);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await readPushRow(cdp, sessionId);
    if (
      row.found &&
      JSON.stringify(row.buttons) ===
        JSON.stringify(["Disable push notifications"])
    ) {
      return { outcome: "enabled", row };
    }
    if (row.found && row.alertText) {
      return { outcome: "error", row };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { outcome: "timeout", row: null };
}

async function checkSubscribeRoundTrip(violations) {
  assertBuilt();
  const home = makeSandboxHome("subscribe-rt");
  let server;
  let chromeChild;
  let cdp;
  try {
    server = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);
    chromeChild = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const dbPath = join(home, ".dispatch", "board.db");
    const sessionId = await seedPage(cdp, { permission: "granted" });
    await openSettingsNotifications(cdp, sessionId);

    let enabledResult = null;
    for (let attempt = 1; attempt <= SUBSCRIBE_MAX_ATTEMPTS; attempt++) {
      const result = await attemptSubscribeEnable(
        cdp,
        sessionId,
        SUBSCRIBE_ATTEMPT_TIMEOUT_MS,
      );
      console.log(
        `subscribe-round-trip: enable attempt ${attempt}/${SUBSCRIBE_MAX_ATTEMPTS} outcome=${result.outcome}`,
      );
      if (result.outcome === "enabled") {
        enabledResult = result;
        break;
      }
    }
    if (!enabledResult) {
      violations.push(
        `subscribe-round-trip: enable UI never reached the ["Disable push notifications"] row ` +
          `state after ${SUBSCRIBE_MAX_ATTEMPTS} attempt(s), each bounded at ${SUBSCRIBE_ATTEMPT_TIMEOUT_MS}ms`,
      );
    } else {
      console.log(
        `subscribe-round-trip: enable step observed statusText=${JSON.stringify(enabledResult.row.statusText)}`,
      );
      if (
        enabledResult.row.statusText == null ||
        !enabledResult.row.statusText.startsWith("Push enabled -")
      ) {
        violations.push(
          `subscribe-round-trip: expected statusText to start "Push enabled -", got ${JSON.stringify(enabledResult.row.statusText)}`,
        );
      }
    }

    let rows = readPushDbRows(dbPath);
    console.log(
      `subscribe-round-trip: after enable, push_subscriptions rows=${rows.length}` +
        (rows[0] ? ` endpoint=${rows[0].endpoint}` : ""),
    );
    if (rows.length !== 1) {
      violations.push(
        `subscribe-round-trip: expected exactly 1 push_subscriptions row after enable, got ${rows.length}`,
      );
      return;
    }
    const enabledRow = rows[0];
    if (
      typeof enabledRow.endpoint !== "string" ||
      !enabledRow.endpoint.startsWith("https://")
    ) {
      violations.push(
        `subscribe-round-trip: expected endpoint to start "https://", got ${JSON.stringify(enabledRow.endpoint)}`,
      );
    }
    if (typeof enabledRow.p256dh !== "string" || enabledRow.p256dh === "") {
      violations.push(
        `subscribe-round-trip: expected non-empty p256dh, got ${JSON.stringify(enabledRow.p256dh)}`,
      );
    }
    if (typeof enabledRow.auth !== "string" || enabledRow.auth === "") {
      violations.push(
        `subscribe-round-trip: expected non-empty auth, got ${JSON.stringify(enabledRow.auth)}`,
      );
    }
    if (typeof enabledRow.origin !== "string" || enabledRow.origin === "") {
      violations.push(
        `subscribe-round-trip: expected non-empty origin, got ${JSON.stringify(enabledRow.origin)}`,
      );
    }
    const enabledEndpoint = enabledRow.endpoint;

    // Reload leg: a FRESH target, same origin/browser profile so the marker persists, permission
    // still granted, Settings never opened. Covers refreshPushSubscription's positive half: the
    // upsert must preserve the same row, never create a second one or lose the first.
    const sessionIdReload = await seedPage(cdp, { permission: "granted" });
    const shellReadyReload = await pollUntilTruthy(
      cdp,
      sessionIdReload,
      `!!document.querySelector('[aria-label="Sync filters"]')`,
      SETTINGS_NAV_TIMEOUT_MS,
    );
    if (!shellReadyReload) {
      violations.push(
        "subscribe-round-trip: reload leg - the app shell never rendered",
      );
      return;
    }
    await sleep(PUSH_CALL_SETTLE_MS);
    rows = await pollPushDbRows(
      dbPath,
      (r) => r.length === 1 && r[0].endpoint === enabledEndpoint,
      SUBSCRIBE_RELOAD_TIMEOUT_MS,
    );
    console.log(
      `subscribe-round-trip: after reload, push_subscriptions rows=${rows.length}` +
        (rows[0] ? ` endpoint=${rows[0].endpoint}` : ""),
    );
    if (rows.length !== 1) {
      violations.push(
        `subscribe-round-trip: expected exactly 1 row after reload, got ${rows.length}`,
      );
    } else if (rows[0].endpoint !== enabledEndpoint) {
      violations.push(
        `subscribe-round-trip: expected reload to preserve endpoint ${JSON.stringify(enabledEndpoint)}, got ${JSON.stringify(rows[0].endpoint)}`,
      );
    }

    // Disable leg: same reload target, open Settings, real click on Disable.
    await openSettingsNotifications(cdp, sessionIdReload);
    const disableRect = await findButtonRect(
      cdp,
      sessionIdReload,
      "Disable push notifications",
    );
    if (!disableRect) {
      violations.push(
        "subscribe-round-trip: disable leg - the Disable push notifications button was not found",
      );
      return;
    }
    await dispatchRealClick(cdp, sessionIdReload, disableRect);
    const disableDeadline = Date.now() + SUBSCRIBE_DISABLE_TIMEOUT_MS;
    let disabledRow = null;
    while (Date.now() < disableDeadline) {
      const row = await readPushRow(cdp, sessionIdReload);
      if (
        row.found &&
        JSON.stringify(row.buttons) ===
          JSON.stringify(["Enable push notifications"])
      ) {
        disabledRow = row;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!disabledRow) {
      violations.push(
        `subscribe-round-trip: disable leg - row never returned to ["Enable push notifications"] within ${SUBSCRIBE_DISABLE_TIMEOUT_MS}ms`,
      );
      return;
    }
    rows = readPushDbRows(dbPath);
    if (rows.length !== 0) {
      violations.push(
        `subscribe-round-trip: expected zero push_subscriptions rows after disable, got ${rows.length}`,
      );
    }
    const permissionAfterDisable = await evalValue(
      cdp,
      sessionIdReload,
      `Notification.permission`,
    );
    if (permissionAfterDisable !== "granted") {
      violations.push(
        `subscribe-round-trip: expected Notification.permission to remain "granted" after disable, got ${JSON.stringify(permissionAfterDisable)}`,
      );
    }
    console.log(
      `subscribe-round-trip: after disable, rows=${rows.length} permission=${JSON.stringify(permissionAfterDisable)}`,
    );
  } finally {
    if (cdp) cdp.close();
    await stopServer(chromeChild);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(server);
    cleanupSandboxHome(home);
  }
}

/** `--break subscribe-round-trip`: captures `push.ts` and redirects the subscribe POST literal
 * `enablePush` uses to a sentinel path that 404s. The anchor includes `enablePush`'s
 * `const res = ` assignment deliberately: the bare literal `"/api/push/subscribe"` occurs TWICE
 * in this file (`enablePush` and `refreshPushSubscription` both call it, since Plan 03 added the
 * second call site after Plan 02's verify asserted the literal unique), and only `enablePush`'s
 * occurrence carries this assignment prefix. Rebuilds via `resetBuildCache()` and requires the
 * missing-row violation by name. Restores the captured bytes in a `finally` unconditionally. */
async function runBreakSubscribeRoundTrip() {
  assertBuilt();
  const pushTsPath = join(REPO_ROOT, "src/web/lib/push.ts");
  const TARGET = 'const res = await fetch("/api/push/subscribe", {';
  const REPLACEMENT =
    'const res = await fetch("/api/push/subscribe-panel-109-sentinel", {';
  const original = readFileSync(pushTsPath, "utf8");
  const occurrences = original.split(TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel109: refusing to run --break subscribe-round-trip, expected ${JSON.stringify(TARGET)} ` +
        `to occur exactly once in ${pushTsPath}, measured ${occurrences}. A miscounted anchor would ` +
        `mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  try {
    writeFileSync(pushTsPath, original.replace(TARGET, REPLACEMENT));
    resetBuildCache();

    const tripViolations = [];
    await checkSubscribeRoundTrip(tripViolations);
    console.log(
      `\n--break subscribe-round-trip TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("expected exactly 1 push_subscriptions row after enable"),
    );
  } finally {
    writeFileSync(pushTsPath, original);
    resetBuildCache();
  }

  const restoreViolations = [];
  await checkSubscribeRoundTrip(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break subscribe-round-trip RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// ios-guidance-branch (Plan 06): proves the `ios-needs-install` branch renders
// on every device shape that reaches it - a real iPhone UA, AND the iPadOS
// desktop-UA masquerade a plain regex silently misses - and that the same
// device in standalone mode takes the normal enable-control branch instead.
// ---------------------------------------------------------------------------

const IOS_GUIDANCE_LABEL = "Add to your Home Screen to enable push";
const IOS_GUIDANCE_STEPS = [
  "1. Tap the Share icon in Safari's toolbar.",
  '2. Tap "Add to Home Screen".',
  "3. Open Dispatch from your Home Screen.",
  "4. Enable push notifications from Settings there.",
];
const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD_MASQUERADE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/** Installed via `Page.addScriptToEvaluateOnNewDocument` for leg 3: defines the iOS-Safari-only
 * `navigator.standalone` property `usePushSubscription`'s own `standalone` boolean ORs against.
 * @remarks `Emulation.setEmulatedMedia({ features: [{ name: "display-mode", value: "standalone"
 * }] })`, the CDP mechanism named in this plan's interfaces, was tried first and rejected: it
 * accepts the call without error but leaves `matchMedia("(display-mode: standalone)").matches`
 * unchanged on this Chrome build (`prefers-color-scheme` DOES apply through the identical
 * endpoint, isolating the gap to `display-mode` specifically). Stubbing the real iOS API this
 * exact branch also reads is a faithful substitute, not a weaker one. */
const NAVIGATOR_STANDALONE_INIT_SCRIPT = `
(() => {
  Object.defineProperty(navigator, "standalone", {
    value: true,
    configurable: true,
  });
})();
`;

/** Shared assertion set for leg 1 (real iPhone) and leg 2 (iPad masquerade): the guidance label
 * and four numbered steps render byte exact, zero buttons render (there is nothing to click on a
 * device that cannot subscribe), and neither `register` nor `subscribe` was recorded, proving the
 * branch is reached without ever touching a push call that could not succeed on this device
 * anyway.
 * @remarks Deliberately does not assert `requestPermission` absent: the pre-existing, unrelated
 * `useTransitionNotifications` hook (ATTN-01, v0.2 phase 08) calls
 * `Notification.requestPermission()` once, unconditionally, on every mount for desktop
 * notifications, matching the same scoping `push-prompt-on-click-only` (Plan 05) already
 * established for this exact recorder. */
function assertIosGuidanceLeg(violations, legName, row, pushCalls) {
  if (!row.found) {
    violations.push(
      `ios-guidance-branch: ${legName} - the push row was never found`,
    );
    return;
  }
  if (row.labelText !== IOS_GUIDANCE_LABEL) {
    violations.push(
      `ios-guidance-branch: ${legName} expected labelText exactly ${JSON.stringify(IOS_GUIDANCE_LABEL)}, got ${JSON.stringify(row.labelText)}`,
    );
  }
  if (JSON.stringify(row.listItems) !== JSON.stringify(IOS_GUIDANCE_STEPS)) {
    violations.push(
      `ios-guidance-branch: ${legName} expected listItems exactly ${JSON.stringify(IOS_GUIDANCE_STEPS)}, got ${JSON.stringify(row.listItems)}`,
    );
  }
  if (row.buttons.length !== 0) {
    violations.push(
      `ios-guidance-branch: ${legName} expected zero buttons, got ${JSON.stringify(row.buttons)}`,
    );
  }
  const pushApiCalls = Array.isArray(pushCalls)
    ? pushCalls.filter((c) => c === "register" || c === "subscribe")
    : pushCalls;
  if (!Array.isArray(pushCalls) || pushApiCalls.length !== 0) {
    violations.push(
      `ios-guidance-branch: ${legName} expected no "register" or "subscribe" call recorded, got ${JSON.stringify(pushCalls)}`,
    );
  }
}

async function checkIosGuidanceBranch(violations) {
  assertBuilt();
  const home = makeSandboxHome("ios-guidance");
  let server;
  let chromeChild;
  let cdp;
  try {
    server = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);
    chromeChild = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    // Leg 1: a real iPhone outside standalone mode.
    const sessionId1 = await seedPage(cdp, {
      permission: "prompt",
      initScript: PUSH_CALL_RECORDER_INIT_SCRIPT,
      userAgent: IPHONE_USER_AGENT,
      platform: "iPhone",
    });
    await openSettingsNotifications(cdp, sessionId1);
    const row1 = await readPushRow(cdp, sessionId1);
    const calls1 = await evalValue(cdp, sessionId1, `window.__pushCalls`);
    console.log(
      `ios-guidance-branch: leg1 (iPhone) labelText=${JSON.stringify(row1.labelText)} ` +
        `listItems=${JSON.stringify(row1.listItems)} buttons=${JSON.stringify(row1.buttons)} ` +
        `pushCalls=${JSON.stringify(calls1)}`,
    );
    assertIosGuidanceLeg(violations, "leg1 (iPhone)", row1, calls1);

    // Leg 2: the iPadOS default desktop-UA masquerade, distinguished only by
    // navigator.platform === "MacIntel" plus multi-touch capability.
    const sessionId2 = await seedPage(cdp, {
      permission: "prompt",
      initScript: PUSH_CALL_RECORDER_INIT_SCRIPT,
      userAgent: IPAD_MASQUERADE_USER_AGENT,
      platform: "MacIntel",
      touchEmulation: true,
    });
    const platform2 = await evalValue(cdp, sessionId2, `navigator.platform`);
    const maxTouchPoints2 = await evalValue(
      cdp,
      sessionId2,
      `navigator.maxTouchPoints`,
    );
    console.log(
      `ios-guidance-branch: leg2 (iPad masquerade) emulation control navigator.platform=${JSON.stringify(platform2)} ` +
        `navigator.maxTouchPoints=${maxTouchPoints2}`,
    );
    if (platform2 !== "MacIntel") {
      violations.push(
        `ios-guidance-branch: leg2 (iPad masquerade) emulation control failed, expected ` +
          `navigator.platform exactly "MacIntel", got ${JSON.stringify(platform2)}`,
      );
    }
    if (!(maxTouchPoints2 > 1)) {
      violations.push(
        `ios-guidance-branch: leg2 (iPad masquerade) emulation control failed, expected ` +
          `navigator.maxTouchPoints > 1, got ${maxTouchPoints2}`,
      );
    }
    await openSettingsNotifications(cdp, sessionId2);
    const row2 = await readPushRow(cdp, sessionId2);
    const calls2 = await evalValue(cdp, sessionId2, `window.__pushCalls`);
    console.log(
      `ios-guidance-branch: leg2 (iPad masquerade) labelText=${JSON.stringify(row2.labelText)} ` +
        `listItems=${JSON.stringify(row2.listItems)} buttons=${JSON.stringify(row2.buttons)} ` +
        `pushCalls=${JSON.stringify(calls2)}`,
    );
    assertIosGuidanceLeg(violations, "leg2 (iPad masquerade)", row2, calls2);

    // Leg 3: the same iPhone shape, but installed (navigator.standalone true) -
    // proving the guidance is a branch, not a permanent dead end.
    const sessionId3 = await seedPage(cdp, {
      permission: "prompt",
      userAgent: IPHONE_USER_AGENT,
      platform: "iPhone",
      initScript: NAVIGATOR_STANDALONE_INIT_SCRIPT,
    });
    await openSettingsNotifications(cdp, sessionId3);
    const row3 = await readPushRow(cdp, sessionId3);
    console.log(
      `ios-guidance-branch: leg3 (installed standalone) labelText=${JSON.stringify(row3.labelText)} ` +
        `buttons=${JSON.stringify(row3.buttons)}`,
    );
    if (!row3.found) {
      violations.push(
        "ios-guidance-branch: leg3 (installed standalone) - the push row was never found",
      );
    } else {
      if (row3.labelText !== "Push notifications (this device)") {
        violations.push(
          `ios-guidance-branch: leg3 (installed standalone) expected labelText exactly ` +
            `"Push notifications (this device)", got ${JSON.stringify(row3.labelText)}`,
        );
      }
      if (
        JSON.stringify(row3.buttons) !==
        JSON.stringify(["Enable push notifications"])
      ) {
        violations.push(
          `ios-guidance-branch: leg3 (installed standalone) expected buttons exactly ` +
            `["Enable push notifications"], got ${JSON.stringify(row3.buttons)}`,
        );
      }
    }
  } finally {
    if (cdp) cdp.close();
    await stopServer(chromeChild);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(server);
    cleanupSandboxHome(home);
  }
}

/** `--break ios-guidance-branch`: neuters `isIOSDevice` to unconditionally `return false`,
 * rebuilds via `resetBuildCache()`, and requires BOTH leg 1 (real iPhone UA) and leg 2 (iPad
 * masquerade) to report the missing-guidance violation by name - an under-detecting device check
 * is exactly what makes an iOS user see a toggle that cannot work. Restores the captured bytes in
 * a `finally` unconditionally. */
async function runBreakIosGuidanceBranch() {
  assertBuilt();
  const pushTsPath = join(REPO_ROOT, "src/web/lib/push.ts");
  const TARGET = `export function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}`;
  const REPLACEMENT = `export function isIOSDevice(): boolean {
  return false;
}`;
  const original = readFileSync(pushTsPath, "utf8");
  const occurrences = original.split(TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel109: refusing to run --break ios-guidance-branch, expected the isIOSDevice function ` +
        `body to occur exactly once in ${pushTsPath}, measured ${occurrences}. A miscounted anchor ` +
        `would mutate the wrong spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  try {
    writeFileSync(pushTsPath, original.replace(TARGET, REPLACEMENT));
    resetBuildCache();

    const tripViolations = [];
    await checkIosGuidanceBranch(tripViolations);
    console.log(
      `\n--break ios-guidance-branch TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    const leg1Tripped = tripViolations.some(
      (v) => v.includes("leg1 (iPhone)") && v.includes("expected labelText"),
    );
    const leg2Tripped = tripViolations.some(
      (v) =>
        v.includes("leg2 (iPad masquerade)") &&
        v.includes("expected labelText"),
    );
    tripFired = leg1Tripped && leg2Tripped;
  } finally {
    writeFileSync(pushTsPath, original);
    resetBuildCache();
  }

  const restoreViolations = [];
  await checkIosGuidanceBranch(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break ios-guidance-branch RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// CHECKS / BREAKS registries. Every later plan in this phase appends here.
// ---------------------------------------------------------------------------

const CHECKS = {
  "pwa-manifest-assets": (violations) => checkPwaManifestAssets(violations),
  "push-row-state-machine": (violations) =>
    checkPushRowStateMachine(violations),
  "denied-state-no-button": (violations) =>
    checkDeniedStateNoButton(violations),
  "push-prompt-on-click-only": (violations) =>
    checkPushPromptOnClickOnly(violations),
  "subscribe-round-trip": (violations) => checkSubscribeRoundTrip(violations),
  "ios-guidance-branch": (violations) => checkIosGuidanceBranch(violations),
};

const BREAKS = {
  "pwa-manifest-assets": runBreakPwaManifestAssets,
  "push-row-state-machine": runBreakPushRowStateMachine,
  "denied-state-no-button": runBreakDeniedStateNoButton,
  "push-prompt-on-click-only": runBreakPushPromptOnClickOnly,
  "subscribe-round-trip": runBreakSubscribeRoundTrip,
  "ios-guidance-branch": runBreakIosGuidanceBranch,
};

// ---------------------------------------------------------------------------
// fcm-egress probe: measures the ENVIRONMENT, not the code, whether a real
// push service subscribe round trip is reachable from this sandbox. Never
// registered in CHECKS: a measurement that can legitimately report "blocked"
// would make the suite's exit code meaningless.
// ---------------------------------------------------------------------------

/** Runs inside the sandboxed page via `evalAsyncValue`. Registers `/sw.js`, awaits
 * `navigator.serviceWorker.ready`, fetches the real VAPID public key, converts it with the same
 * padding and character swap `push.ts` uses, then races `pushManager.subscribe()` against a 30
 * second timeout. The resulting subscription is unsubscribed before this resolves, so the probe
 * leaves no live registration behind. */
const FCM_EGRESS_PAGE_EXPRESSION = `
(async () => {
  const TIMEOUT_MS = 30000;
  const withTimeout = (p) =>
    Promise.race([
      p,
      new Promise((_, reject) => {
        setTimeout(() => {
          const err = new Error("subscribe timed out");
          err.name = "TimeoutError";
          reject(err);
        }, TIMEOUT_MS);
      }),
    ]);
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const { publicKey } = await fetch("/api/push/public-key").then((r) =>
      r.json(),
    );
    const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
    const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const bytes = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
    const subscription = await withTimeout(
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      }),
    );
    const endpointHost = new URL(subscription.endpoint).host;
    await subscription.unsubscribe();
    return {
      outcome: "subscribed",
      endpointHost,
      errorName: null,
      errorMessage: null,
    };
  } catch (err) {
    return {
      outcome: err && err.name === "TimeoutError" ? "timeout" : "rejected",
      endpointHost: null,
      errorName: err && err.name ? err.name : null,
      errorMessage: err && err.message ? err.message : String(err),
    };
  }
})()
`;

async function runProbeFcmEgress() {
  assertBuilt();
  const home = makeSandboxHome("fcm-egress");
  let server;
  let chromeChild;
  let cdp;
  try {
    server = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    chromeChild = launchChrome();
    await waitForCdpUp();
    cdp = await connectCDP();

    const origin = `http://127.0.0.1:${SANDBOX_PORT}`;
    await grantNotifications(cdp, origin);

    const { sessionId } = await openPage(cdp, { url: `${origin}/` });
    const result = await evalAsyncValue(
      cdp,
      sessionId,
      FCM_EGRESS_PAGE_EXPRESSION,
    );

    if (result.outcome === "subscribed") {
      console.log(
        `probe fcm-egress: VERDICT=reachable outcome=subscribed endpointHost=${result.endpointHost}`,
      );
    } else {
      console.log(
        `probe fcm-egress: VERDICT=blocked outcome=${result.outcome} detail=${result.errorName}: ${result.errorMessage}`,
      );
    }
    return result;
  } finally {
    if (cdp) cdp.close();
    await stopServer(chromeChild);
    rmSync(chromeUserDataDir(), { recursive: true, force: true });
    await stopServer(server);
    cleanupSandboxHome(home);
  }
}

const PROBES = {
  "fcm-egress": runProbeFcmEgress,
};

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
      "panel-109: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
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
  console.error(`panel-109 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
