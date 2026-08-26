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
 *   node scripts/panel-109.mjs --probe <name>  a later plan's non-assertion measurement run
 *                                                (e.g. an egress verdict). Not implemented by
 *                                                Plan 01; the flag surface is declared now so it
 *                                                stays stable across every plan in this phase.
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
 * ASSUMPTION EVIDENCE, empty by design. A later plan in this phase fills this section with the
 * measured push service egress verdict.
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

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

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
      "panel-109: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
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
  console.error(`panel-109 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
