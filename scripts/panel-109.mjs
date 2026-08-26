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
// CHECKS / BREAKS registries. Every later plan in this phase appends here.
// ---------------------------------------------------------------------------

const CHECKS = {
  "pwa-manifest-assets": (violations) => checkPwaManifestAssets(violations),
};

const BREAKS = {
  "pwa-manifest-assets": runBreakPwaManifestAssets,
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
