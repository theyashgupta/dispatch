/**
 * Phase 108 instrument script scaffold (PUSH-09, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92 through
 * panel-104. `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply here,
 * but prettier still formats this file.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-104.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on the user's live service at :4700, before this script boots any server or
 * spawns any real process, and there is no override flag. It runs FIRST in `main()`, before any
 * sandbox directory is created.
 *
 * SCOPE, this phase's checks are lighter than panel-100/104's UI-driving harnesses: Plan 01's
 * `sw-no-fetch-handler` needs no server at all (it only reads static files), and later plans in
 * this phase need only the HTTP+sqlite legs of the sandbox/boot helper set below, never headless
 * Chrome or CDP. The helper set is ported from `panel-100.mjs` anyway, so every later plan in this
 * phase shares one boot/teardown vocabulary rather than each re-deriving its own.
 *
 * Ports, unique across every existing harness (verified against every `panel-9x.mjs`,
 * `panel-100.mjs` (47876), `panel-104.mjs`'s own sandbox constants): sandbox server 47880, Plan
 * 02's own `npx vite` dev-server instance 47881. Port 4700 is the user's live service and is
 * forbidden as a sandbox port.
 *
 * Usage:
 *   node scripts/panel-108.mjs                every registered check, exits non-zero on any
 *                                                violation. Refuses to exit 0 if CHECKS is empty,
 *                                                so an accidentally emptied map can never read as
 *                                                a vacuous pass.
 *   node scripts/panel-108.mjs --check <name>  one named check only. Unknown name exits non-zero
 *                                                and lists every registered name.
 *   node scripts/panel-108.mjs --break <name>  that check's OWN break: mutates the real artifact
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
 *   - `sw-no-fetch-handler` proven able to fail (Plan 01): appending
 *     `self.addEventListener("fetch", (event) => event.respondWith(fetch(event.request)));` to
 *     `src/web/public/sw.js` produced
 *     `sw-no-fetch-handler: src/web/public/sw.js:20 matches a fetch handler pattern: ...`.
 *   - `sw-no-cache` proven able to fail (Plan 02): renaming the built `NO_CACHE_BASENAMES` set's
 *     `"sw.js"` entry to `"panel-108-break-sentinel.js"` in `dist/server/bootstrap/index.js`
 *     produced `sw-no-cache /sw.js: expected cache-control exactly "no-cache", got "public,
 *     max-age=31536000, immutable"` against a real booted sandbox production server.
 *   - `sw-dev-no-cache` proven able to fail (Plan 02), and Assumption A1 from 108-RESEARCH.md
 *     closed with data: a clean run against the repo's own `npx vite --host 127.0.0.1` measured
 *     `cache-control="no-cache" etag="W/\"627-1787749450875\"" last-modified="Wed, 26 Aug 2026
 *     13:04:10 GMT"` for `/sw.js`, confirming Vite's dev server applies no long-lived cache
 *     directive. Renaming `src/web/public/sw.js` out of the way produced `sw-dev-no-cache /sw.js:
 *     response body does not contain "addEventListener"` plus a corroborating SPA-fallback-HTML
 *     violation, since Vite's dev server falls back to serving `index.html` (status 200) rather
 *     than 404ing a missing `publicDir` file with a recognized extension.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants, sandbox/boot helper set. Ported from panel-100.mjs, renamed for
// this phase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

const SANDBOX_PORT = 47880;
const SANDBOX_PREFIX = "dispatch-panel-108-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

const FAKE_LINEAR_API_KEY = "panel-108-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-108-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-108-LIVE"))
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
// sw-no-fetch-handler: reads src/web/public/sw.js and, if built, dist/web/sw.js,
// strips comments before matching (the file's own prose mentions "fetch"), and
// reports a violation for any fetch handler or any missing required listener.
// ---------------------------------------------------------------------------

const REQUIRED_LISTENERS = ["install", "activate", "push", "notificationclick"];
const FETCH_HANDLER_PATTERN = /addEventListener\(\s*["']fetch["']|\bonfetch\b/;

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function checkFileForFetchHandler(filePath, violations) {
  if (!existsSync(filePath)) {
    violations.push(
      `sw-no-fetch-handler: expected ${filePath} to exist, it is missing`,
    );
    return;
  }
  const stripped = stripComments(readFileSync(filePath, "utf8"));
  stripped.split("\n").forEach((line, idx) => {
    if (FETCH_HANDLER_PATTERN.test(line)) {
      violations.push(
        `sw-no-fetch-handler: ${filePath}:${idx + 1} matches a fetch handler pattern: ${line.trim()}`,
      );
    }
  });
  for (const ev of REQUIRED_LISTENERS) {
    const re = new RegExp(`addEventListener\\(\\s*["']${ev}["']`);
    if (!re.test(stripped)) {
      violations.push(
        `sw-no-fetch-handler: ${filePath} is missing a required "${ev}" listener`,
      );
    }
  }
}

function checkSwNoFetchHandler(violations) {
  const srcSw = join(REPO_ROOT, "src", "web", "public", "sw.js");
  const distSw = join(REPO_ROOT, "dist", "web", "sw.js");
  checkFileForFetchHandler(srcSw, violations);
  if (existsSync(distSw)) {
    checkFileForFetchHandler(distSw, violations);
  }
}

/** `--break sw-no-fetch-handler`: appends a genuine fetch pass-through handler to the real
 * `src/web/public/sw.js`, runs the SAME check function the real run uses, requires it to report
 * the violation by name (TRIP leg), restores the captured bytes unconditionally in a `finally`,
 * then re-runs the same check and requires a clean pass (RESTORE leg). */
async function runBreakSwNoFetchHandler() {
  const relPath = join("src", "web", "public", "sw.js");
  const absPath = join(REPO_ROOT, relPath);

  const preflightStatus = execFileSync(
    "git",
    ["status", "--porcelain", relPath],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (preflightStatus.trim() !== "") {
    throw new Error(
      `panel108: refusing to run --break sw-no-fetch-handler, ${relPath} is not clean before the ` +
        `break (git status --porcelain reports):\n${preflightStatus}`,
    );
  }

  const original = readFileSync(absPath, "utf8");
  let tripFired = false;
  try {
    const patched =
      original +
      '\nself.addEventListener("fetch", (event) => event.respondWith(fetch(event.request)));\n';
    writeFileSync(absPath, patched);

    const tripViolations = [];
    checkSwNoFetchHandler(tripViolations);
    console.log(
      `\n--break sw-no-fetch-handler TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some(
      (v) => v.indexOf("matches a fetch handler pattern") !== -1,
    );
  } finally {
    writeFileSync(absPath, original);
  }

  const restoreStatus = execFileSync(
    "git",
    ["status", "--porcelain", relPath],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (restoreStatus.trim() !== "") {
    console.error(
      `PANEL-108-RESTORE-FAILED: ${relPath} is not clean after restoring the captured original:\n${restoreStatus}`,
    );
  }

  const restoreViolations = [];
  checkSwNoFetchHandler(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break sw-no-fetch-handler RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// Shared response-shape helpers for sw-no-cache and sw-dev-no-cache: both
// checks fetch /sw.js from a real running server and must reject an
// SPA-fallback HTML page returned with status 200 as readable-as-passing.
// ---------------------------------------------------------------------------

function assertStatus200(label, status, violations) {
  if (status !== 200) {
    violations.push(`${label}: expected status 200, got ${status}`);
  }
}

function assertLooksLikeServiceWorkerBody(label, body, violations) {
  if (!body.includes("addEventListener")) {
    violations.push(
      `${label}: response body does not contain "addEventListener"`,
    );
  }
  if (body.toLowerCase().includes("<!doctype html")) {
    violations.push(
      `${label}: response body looks like the SPA fallback HTML page (contains "<!doctype html")`,
    );
  }
}

/** Production strictness: cache-control must be present and exactly "no-cache". */
function assertExactNoCache(label, cacheControlValue, violations) {
  if (cacheControlValue == null) {
    violations.push(`${label}: expected a cache-control header, got none`);
    return;
  }
  if (cacheControlValue !== "no-cache") {
    violations.push(
      `${label}: expected cache-control exactly "no-cache", got ${JSON.stringify(cacheControlValue)}`,
    );
  }
}

/** Dev-mode looseness: cache-control, if present at all, must not carry a long-lived directive. */
function assertNoLongLivedCache(label, cacheControlValue, violations) {
  if (cacheControlValue == null) return;
  if (/immutable/i.test(cacheControlValue)) {
    violations.push(
      `${label}: cache-control ${JSON.stringify(cacheControlValue)} contains "immutable"`,
    );
  }
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControlValue);
  if (maxAgeMatch && Number(maxAgeMatch[1]) > 0) {
    violations.push(
      `${label}: cache-control ${JSON.stringify(cacheControlValue)} carries max-age=${maxAgeMatch[1]} > 0`,
    );
  }
}

// ---------------------------------------------------------------------------
// sw-no-cache: boots a real sandbox production server (NODE_ENV=production,
// the only mode with the setHeaders callback) and asserts /sw.js and
// /index.html are both served Cache-Control: no-cache.
// ---------------------------------------------------------------------------

async function checkSwNoCache(violations) {
  assertBuilt();
  const home = makeSandboxHome("swcache");
  let child;
  try {
    child = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    const swRes = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/sw.js`);
    const swBody = await swRes.text();
    const swCacheControl = swRes.headers.get("cache-control");
    console.log(
      `sw-no-cache: observed cache-control for /sw.js = ${JSON.stringify(swCacheControl)}`,
    );
    assertStatus200("sw-no-cache /sw.js", swRes.status, violations);
    assertExactNoCache("sw-no-cache /sw.js", swCacheControl, violations);
    assertNoLongLivedCache("sw-no-cache /sw.js", swCacheControl, violations);
    assertLooksLikeServiceWorkerBody("sw-no-cache /sw.js", swBody, violations);

    const idxRes = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/index.html`);
    await idxRes.body?.cancel().catch(() => {});
    const idxCacheControl = idxRes.headers.get("cache-control");
    console.log(
      `sw-no-cache: observed cache-control for /index.html = ${JSON.stringify(idxCacheControl)}`,
    );
    assertStatus200("sw-no-cache /index.html", idxRes.status, violations);
    assertExactNoCache("sw-no-cache /index.html", idxCacheControl, violations);
  } finally {
    await stopServer(child);
    cleanupSandboxHome(home);
  }
}

/** `--break sw-no-cache`: mutates the BUILT artifact (`dist/server/bootstrap/index.js`), not the
 * source, since editing dist needs no rebuild and any subsequent `npm run build` regenerates it
 * regardless. `assertBuilt()` runs FIRST, before the mutation, so it caches `headBuild` and the
 * SAME check function's own internal `assertBuilt()` call skips rebuilding the tree out from
 * under the mutated dist file. */
async function runBreakSwNoCache() {
  assertBuilt();

  const TARGET = '"sw.js"';
  const REPLACEMENT = '"panel-108-break-sentinel.js"';
  const original = readFileSync(DIST_ENTRY, "utf8");
  const occurrences = original.split(TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel108: refusing to run --break sw-no-cache, expected ${TARGET} to occur exactly once ` +
        `in ${DIST_ENTRY}, measured ${occurrences}. A miscounted anchor would mutate the wrong ` +
        `spot and report a false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  try {
    writeFileSync(DIST_ENTRY, original.replace(TARGET, REPLACEMENT));

    const tripViolations = [];
    await checkSwNoCache(tripViolations);
    console.log(
      `\n--break sw-no-cache TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes('expected cache-control exactly "no-cache"'),
    );
  } finally {
    writeFileSync(DIST_ENTRY, original);
  }

  const restoreViolations = [];
  await checkSwNoCache(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break sw-no-cache RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// sw-dev-no-cache: `/sw.js` is served by Vite's OWN dev server under
// `npm run dev` (vite.config.ts's proxy only matches ^/api/ and ^/sessions/),
// never proxied to Express, so the production setHeaders callback never runs
// for it in dev. This settles 108-RESEARCH.md Assumption A1 with measured
// header values rather than an assumption.
// ---------------------------------------------------------------------------

const VITE_DEV_PORT = 47881;
const VITE_STARTUP_TIMEOUT_MS = 30_000;

async function waitForPortOpen(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      await res.body?.cancel().catch(() => {});
      return;
    } catch {
      // vite not listening yet, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `vite dev server on :${port} did not accept a connection within ${timeoutMs}ms`,
  );
}

async function checkSwDevNoCache(violations) {
  let child;
  const outputChunks = [];
  try {
    child = spawn(
      "npx",
      [
        "vite",
        "--port",
        String(VITE_DEV_PORT),
        "--strictPort",
        // Vite's own default bind is IPv6 loopback (::1) only; every other
        // fetch in this script targets 127.0.0.1, so force IPv4 explicitly
        // rather than special-casing this one check's host.
        "--host",
        "127.0.0.1",
      ],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout?.on("data", (d) => outputChunks.push(d));
    child.stderr?.on("data", (d) => outputChunks.push(d));

    await waitForPortOpen(VITE_DEV_PORT, VITE_STARTUP_TIMEOUT_MS);

    const res = await fetch(`http://127.0.0.1:${VITE_DEV_PORT}/sw.js`);
    const body = await res.text();
    const cacheControl = res.headers.get("cache-control");
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    console.log(
      `sw-dev-no-cache: observed cache-control=${JSON.stringify(cacheControl)} ` +
        `etag=${JSON.stringify(etag)} last-modified=${JSON.stringify(lastModified)}`,
    );
    assertStatus200("sw-dev-no-cache /sw.js", res.status, violations);
    assertLooksLikeServiceWorkerBody(
      "sw-dev-no-cache /sw.js",
      body,
      violations,
    );
    assertNoLongLivedCache("sw-dev-no-cache /sw.js", cacheControl, violations);
  } catch (err) {
    violations.push(
      `sw-dev-no-cache: run failed: ${err instanceof Error ? err.message : String(err)}\n` +
        Buffer.concat(outputChunks).toString("utf8"),
    );
  } finally {
    await stopServer(child);
  }
}

/** `--break sw-dev-no-cache`: renames the real `src/web/public/sw.js` out of the way so Vite's
 * dev server can no longer serve it, runs the SAME check function, requires it to report the
 * non-200 / missing-service-worker violation by name, then renames the file back unconditionally
 * in a `finally` and re-runs the same check requiring a clean pass. */
async function runBreakSwDevNoCache() {
  const relPath = join("src", "web", "public", "sw.js");
  const absPath = join(REPO_ROOT, relPath);
  const backupPath = `${absPath}.panel108bak`;

  const preflightStatus = execFileSync(
    "git",
    ["status", "--porcelain", relPath],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (preflightStatus.trim() !== "") {
    throw new Error(
      `panel108: refusing to run --break sw-dev-no-cache, ${relPath} is not clean before the ` +
        `break (git status --porcelain reports):\n${preflightStatus}`,
    );
  }

  let tripFired = false;
  try {
    renameSync(absPath, backupPath);

    const tripViolations = [];
    await checkSwDevNoCache(tripViolations);
    console.log(
      `\n--break sw-dev-no-cache TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some(
      (v) =>
        v.includes("expected status 200") ||
        v.includes("addEventListener") ||
        v.includes("SPA fallback"),
    );
  } finally {
    if (existsSync(backupPath)) {
      renameSync(backupPath, absPath);
    }
  }

  const restoreStatus = execFileSync(
    "git",
    ["status", "--porcelain", relPath],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (restoreStatus.trim() !== "") {
    console.error(
      `PANEL-108-RESTORE-FAILED: ${relPath} is not clean after restoring the captured ` +
        `original:\n${restoreStatus}`,
    );
  }

  const restoreViolations = [];
  await checkSwDevNoCache(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break sw-dev-no-cache RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// CHECKS / BREAKS registries. Every later plan in this phase appends here.
// ---------------------------------------------------------------------------

const CHECKS = {
  "sw-no-fetch-handler": (violations) => checkSwNoFetchHandler(violations),
  "sw-no-cache": (violations) => checkSwNoCache(violations),
  "sw-dev-no-cache": (violations) => checkSwDevNoCache(violations),
};

const BREAKS = {
  "sw-no-fetch-handler": runBreakSwNoFetchHandler,
  "sw-no-cache": runBreakSwNoCache,
  "sw-dev-no-cache": runBreakSwDevNoCache,
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
  if (Object.keys(CHECKS).length === 0) {
    console.error(
      "panel-108: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
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
  console.error(`panel-108 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
