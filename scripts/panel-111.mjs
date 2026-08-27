/**
 * Phase 111 instrument script scaffold (MDV-02, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92 through
 * panel-110. `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply here,
 * but prettier still formats this file.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-110.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on the user's live service at :4700, before this script boots any server or
 * spawns any real process, and there is no override flag. It runs FIRST in `main()`, before any
 * sandbox directory is created.
 *
 * SCOPE, Plan 01 claims this phase's instrument script, its port claim, and its registry shape
 * with one break-proven check (`serve-in-root`) that boots a real sandbox server and makes a REAL
 * HTTP request against the real `viewer.route.ts` route. This is a pure HTTP harness, no Chrome,
 * no CDP, no tmux, no push-crypto, no sqlite fixture seeding, the backend-only nature of this
 * phase's checks makes those unnecessary. Later plans in this phase add the boundary-rejection
 * checks (traversal, symlink escape, absolute-outside, extension, stale-worktree-root, size-cap,
 * auth-gate parity) on top of this same scaffold.
 *
 * Ports, unique against every existing `panel-*.mjs` and other `scripts/*.mjs` harness (verified
 * by grepping every `SANDBOX_PORT =` assignment in `scripts/*.mjs`: claims run 47820-47884 plus
 * `panel-110.mjs`'s own CDP 9381 and stub-push 47884): sandbox server 47885. No CDP port needed.
 *
 * Usage:
 *   node scripts/panel-111.mjs                every registered check, exits non-zero on any
 *                                                violation. Refuses to exit 0 if CHECKS is empty,
 *                                                so an accidentally emptied map can never read as
 *                                                a vacuous pass.
 *   node scripts/panel-111.mjs --check <name>  one named check only. Unknown name exits non-zero
 *                                                and lists every registered name.
 *   node scripts/panel-111.mjs --break <name>  that check's OWN break: mutates the real artifact
 *                                                the check reads, confirms the SAME check function
 *                                                the real run uses reports the violation by name
 *                                                (TRIP leg), restores the captured original
 *                                                unconditionally in a `finally`, and re-confirms a
 *                                                clean pass (RESTORE leg). Never edits a source
 *                                                file without capturing and restoring its bytes.
 *   node scripts/panel-111.mjs --probe <name>  a non-assertion measurement run. Never registered
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
 * BREAK EVIDENCE, appended to by every plan in this phase that registers a check. The quoted
 * lines below are the VERBATIM TRIP-leg output captured from a real `--break` run:
 *   - `serve-in-root` proven able to fail (Plan 01): replacing the sole `"no-store"` literal in
 *     `src/server/routes/viewer.route.ts` with `"no-cache"`, rebuilding, and re-running the same
 *     check against a real booted sandbox server and a real in-root `.md` fixture produced,
 *     verbatim:
 *     `serve-in-root: expected cache-control header to equal "no-store", observed "no-cache"`
 *     The RESTORE leg re-ran clean after the captured bytes were restored, and
 *     `git diff --quiet` on `viewer.route.ts` confirmed a byte-identical restore.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants, sandbox/boot helper set. Ported from panel-110.mjs, renamed for
// this phase.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

const SANDBOX_PORT = 47885;
const SANDBOX_PREFIX = "dispatch-panel-111-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

const FAKE_LINEAR_API_KEY = "panel-111-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-111-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-111-LIVE"))
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
      "panel-111: removed dist/ (it may hold break-mutated output); run `npm run build`",
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
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, log: () => acc };
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
// serve-in-root: an in-root .md round-trips with exact bytes and locked headers,
// the missing-root case fails closed, and a dotfile-in-root .md is servable.
// ---------------------------------------------------------------------------

/**
 * Leg A (fail-closed, runs FIRST, before `workspaces/` exists): a request for a `.md` under the
 * sandbox's configured `workspaceRoot` must 404, proving the route degrades safely when the
 * allowed-roots accessor's only usable root cannot be realpath'd yet. Leg B (positive control):
 * once `workspaces/` exists with a real `doc.md`, the same URL must 200 with the exact bytes and
 * both locked headers. Leg C (dotfile): a `.md` inside a dot-directory under the boundary is
 * servable, proving there is no hidden-dir denylist.
 */
async function checkServeInRoot(violations) {
  assertBuilt();
  const home = makeSandboxHome("serve-in-root");
  let boot;
  try {
    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    const workspaces = join(home, "workspaces");
    const docPath = join(workspaces, "doc.md");
    const url = `http://127.0.0.1:${SANDBOX_PORT}/api/viewer/file?path=${encodeURIComponent(docPath)}`;

    // Leg A: fail-closed, requested BEFORE the workspaces directory is created.
    const beforeRes = await fetch(url);
    const beforeBody = await beforeRes.json().catch(() => null);
    if (beforeRes.status !== 404) {
      violations.push(
        `serve-in-root: expected 404 before the workspaces dir exists, observed ${beforeRes.status}`,
      );
    }
    if (beforeBody?.error !== "not-found") {
      violations.push(
        `serve-in-root: expected body { error: "not-found" } before the workspaces dir exists, ` +
          `observed ${JSON.stringify(beforeBody)}`,
      );
    }

    // Leg B: positive control, the workspaces dir and a legit in-root .md now exist.
    mkdirSync(workspaces, { recursive: true });
    const sentinel = `panel-111-sentinel-${process.pid}`;
    const docBytes = `# Doc\n\nHello ${sentinel}.\n\n- one\n- two\n`;
    writeFileSync(docPath, docBytes, "utf8");

    const afterRes = await fetch(url);
    const afterBody = await afterRes.text();
    if (afterRes.status !== 200) {
      violations.push(
        `serve-in-root: expected 200 for an in-root .md, observed ${afterRes.status}`,
      );
    }
    if (afterBody !== docBytes) {
      violations.push(
        `serve-in-root: expected exact bytes for the in-root .md (length ${docBytes.length}), ` +
          `observed length ${afterBody.length}`,
      );
    }
    const contentType = afterRes.headers.get("content-type");
    if (
      typeof contentType !== "string" ||
      !contentType.includes("text/markdown") ||
      !contentType.includes("charset=utf-8")
    ) {
      violations.push(
        `serve-in-root: expected content-type to include "text/markdown" and "charset=utf-8", ` +
          `observed ${JSON.stringify(contentType)}`,
      );
    }
    const cacheControl = afterRes.headers.get("cache-control");
    if (cacheControl !== "no-store") {
      violations.push(
        `serve-in-root: expected cache-control header to equal "no-store", observed ${JSON.stringify(cacheControl)}`,
      );
    }

    // Leg C: dotfile, locked decision has no hidden-dir denylist.
    const dotDir = join(workspaces, ".claude");
    mkdirSync(dotDir, { recursive: true });
    const dotPath = join(dotDir, "notes.md");
    const dotBytes = `# Notes\n\nDotfile-in-root sentinel ${sentinel}.\n`;
    writeFileSync(dotPath, dotBytes, "utf8");
    const dotUrl = `http://127.0.0.1:${SANDBOX_PORT}/api/viewer/file?path=${encodeURIComponent(dotPath)}`;
    const dotRes = await fetch(dotUrl);
    const dotBody = await dotRes.text();
    if (dotRes.status !== 200) {
      violations.push(
        `serve-in-root: expected 200 for a .claude/notes.md fixture inside the boundary, ` +
          `observed ${dotRes.status}`,
      );
    }
    if (dotBody !== dotBytes) {
      violations.push(
        `serve-in-root: expected exact bytes for the .claude/notes.md fixture, observed a mismatch`,
      );
    }
  } finally {
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const VIEWER_ROUTE_PATH = join(REPO_ROOT, "src/server/routes/viewer.route.ts");
const NO_STORE_BREAK_TARGET = "no-store";
const NO_STORE_BREAK_REPLACEMENT = "no-cache";

/** `--break serve-in-root`: mutates `viewer.route.ts`'s sole `"no-store"` literal to `"no-cache"`,
 * rebuilds via `resetBuildCache()`, and requires the SAME check function to report the
 * cache-control violation (trip leg). Restores the captured bytes unconditionally in a `finally`,
 * rebuilds, and requires a clean pass (restore leg). */
async function runBreakServeInRoot() {
  assertBuilt();
  const original = readFileSync(VIEWER_ROUTE_PATH, "utf8");
  const occurrences = original.split(NO_STORE_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel111: refusing to run --break serve-in-root, expected ` +
        `${JSON.stringify(NO_STORE_BREAK_TARGET)} to occur exactly once in ${VIEWER_ROUTE_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_ROUTE_PATH, original);
  try {
    writeFileSync(
      VIEWER_ROUTE_PATH,
      original.replace(NO_STORE_BREAK_TARGET, NO_STORE_BREAK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkServeInRoot(tripViolations);
    console.log(
      `\n--break serve-in-root TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes('expected cache-control header to equal "no-store"'),
    );
  } finally {
    writeFileSync(VIEWER_ROUTE_PATH, original);
    resetBuildCache();
    unregisterRestore(VIEWER_ROUTE_PATH);
  }

  const restoreViolations = [];
  await checkServeInRoot(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break serve-in-root RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// boundary-rejections: traversal (plain + encoded), absolute-outside,
// sibling-prefix, symlink-escape, and the resolved-path extension gate all
// 404 (or 400 for the request-string extension leg) against REAL requests.
// ---------------------------------------------------------------------------

/**
 * Every rejection leg fired as a real HTTP request against a live server. The positive control
 * (an in-root `doc.md`) MUST pass first: a dead boundary would make every 404 below vacuous.
 * Each fixture body carries a unique marker string so a leaked byte is unambiguous.
 */
async function checkBoundaryRejections(violations) {
  assertBuilt();
  const home = makeSandboxHome("boundary-rejections");
  let boot;
  try {
    const workspaces = join(home, "workspaces");
    const outside = join(home, "outside");
    const sibling = join(home, "workspaces-sibling");
    mkdirSync(workspaces, { recursive: true });
    mkdirSync(outside, { recursive: true });
    mkdirSync(sibling, { recursive: true });

    const sentinel = `panel-111-sentinel-${process.pid}`;
    const docMarker = `DOC-MARKER-${sentinel}`;
    const secretMarker = `SECRET-MARKER-${sentinel}`;
    const absMarker = `ABS-MARKER-${sentinel}`;
    const leakMarker = `LEAK-MARKER-${sentinel}`;
    const noteMarker = `NOTE-MARKER-${sentinel}`;

    const docBytes = `# Doc\n\n${docMarker}\n`;
    const secretBytes = `# Secret\n\n${secretMarker}\n`;
    const absBytes = `# Abs\n\n${absMarker}\n`;
    const leakBytes = `# Leak\n\n${leakMarker}\n`;
    const noteBytes = `plain text, not markdown: ${noteMarker}\n`;

    const docPath = join(workspaces, "doc.md");
    const secretPath = join(outside, "secret.md");
    const absPath = join(outside, "abs.md");
    const leakPath = join(sibling, "leak.md");
    const notePath = join(workspaces, "note.txt");
    const linkPath = join(workspaces, "link.md");
    const aliasPath = join(workspaces, "alias.md");

    writeFileSync(docPath, docBytes, "utf8");
    writeFileSync(secretPath, secretBytes, "utf8");
    writeFileSync(absPath, absBytes, "utf8");
    writeFileSync(leakPath, leakBytes, "utf8");
    writeFileSync(notePath, noteBytes, "utf8");
    symlinkSync(secretPath, linkPath);
    symlinkSync(notePath, aliasPath);

    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    const base = `http://127.0.0.1:${SANDBOX_PORT}/api/viewer/file`;

    // Positive control FIRST, per panel convention: a dead boundary passes every rejection
    // leg below vacuously.
    const controlRes = await fetch(
      `${base}?path=${encodeURIComponent(docPath)}`,
    );
    const controlBody = await controlRes.text();
    if (controlRes.status !== 200 || controlBody !== docBytes) {
      violations.push(
        `boundary-rejections: positive control failed, expected 200 with exact doc.md bytes, ` +
          `observed status ${controlRes.status}`,
      );
      return;
    }

    // Leg: traversal, plain (unencoded) form.
    const traversalPath = `${workspaces}/../outside/secret.md`;
    const traversalPlainRes = await fetch(`${base}?path=${traversalPath}`);
    const traversalPlainBody = await traversalPlainRes.text();
    if (traversalPlainRes.status !== 404) {
      violations.push(
        `boundary-rejections: traversal (plain) expected 404, observed ${traversalPlainRes.status}`,
      );
    }
    if (traversalPlainBody.includes(secretMarker)) {
      violations.push(
        `boundary-rejections: traversal (plain) leaked secret.md bytes`,
      );
    }

    // Leg: traversal, encodeURIComponent form of the same path.
    const traversalEncodedRes = await fetch(
      `${base}?path=${encodeURIComponent(traversalPath)}`,
    );
    const traversalEncodedBody = await traversalEncodedRes.text();
    if (traversalEncodedRes.status !== 404) {
      violations.push(
        `boundary-rejections: traversal (encoded) expected 404, observed ${traversalEncodedRes.status}`,
      );
    }
    if (traversalEncodedBody.includes(secretMarker)) {
      violations.push(
        `boundary-rejections: traversal (encoded) leaked secret.md bytes`,
      );
    }

    // Leg: absolute-outside.
    const absRes = await fetch(`${base}?path=${encodeURIComponent(absPath)}`);
    const absBody = await absRes.text();
    if (absRes.status !== 404) {
      violations.push(
        `boundary-rejections: absolute-outside expected 404, observed ${absRes.status}`,
      );
    }
    if (absBody.includes(absMarker)) {
      violations.push(
        `boundary-rejections: absolute-outside leaked abs.md bytes`,
      );
    }

    // Leg: sibling-prefix, proves the `+ path.sep` disjunct rejects a directory whose name
    // merely starts with the root string.
    const siblingRes = await fetch(
      `${base}?path=${encodeURIComponent(leakPath)}`,
    );
    const siblingBody = await siblingRes.text();
    if (siblingRes.status !== 404) {
      violations.push(
        `boundary-rejections: sibling-prefix expected 404, observed ${siblingRes.status}`,
      );
    }
    if (siblingBody.includes(leakMarker)) {
      violations.push(
        `boundary-rejections: sibling-prefix leaked contents (the resolved sibling path passed containment)`,
      );
    }

    // Leg: symlink-escape, proves realpath follows the link before the prefix compare.
    const linkRes = await fetch(`${base}?path=${encodeURIComponent(linkPath)}`);
    const linkBody = await linkRes.text();
    if (linkRes.status !== 404) {
      violations.push(
        `boundary-rejections: symlink-escape expected 404, observed ${linkRes.status}`,
      );
    }
    if (linkBody.includes(secretMarker)) {
      violations.push(
        `boundary-rejections: symlink-escape leaked secret.md bytes`,
      );
    }

    // Leg: resolved non-.md, request-string extension gate (step 2, no fs touch).
    const noteRes = await fetch(`${base}?path=${encodeURIComponent(notePath)}`);
    if (noteRes.status !== 400) {
      violations.push(
        `boundary-rejections: request-string extension gate expected 400 for note.txt, observed ${noteRes.status}`,
      );
    }

    // Leg: resolved non-.md via an in-root alias symlink (step 6, the RESOLVED-path gate).
    const aliasRes = await fetch(
      `${base}?path=${encodeURIComponent(aliasPath)}`,
    );
    const aliasBody = await aliasRes.text();
    if (aliasRes.status !== 404) {
      violations.push(
        `boundary-rejections: resolved-path extension gate expected 404 for alias.md -> note.txt, observed ${aliasRes.status}`,
      );
    }
    if (aliasBody.includes(noteMarker)) {
      violations.push(
        `boundary-rejections: resolved-path extension gate leaked note.txt bytes via alias.md`,
      );
    }
  } finally {
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const CONTAINMENT_SEP_TARGET = "rootReal + path.sep";
const CONTAINMENT_SEP_REPLACEMENT = "rootReal";

/** `--break boundary-rejections`: weakens the containment disjunct so a path whose REAL path
 * merely string-prefixes the resolved root passes containment. Keys the trip on the
 * sibling-prefix leak, the only leg this exact mutation opens (symlink-escape, traversal, and
 * absolute-outside still resolve strictly outside the prefix and stay 404). */
async function runBreakBoundaryRejections() {
  assertBuilt();
  const original = readFileSync(VIEWER_ROUTE_PATH, "utf8");
  const occurrences = original.split(CONTAINMENT_SEP_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel111: refusing to run --break boundary-rejections, expected ` +
        `${JSON.stringify(CONTAINMENT_SEP_TARGET)} to occur exactly once in ${VIEWER_ROUTE_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_ROUTE_PATH, original);
  try {
    writeFileSync(
      VIEWER_ROUTE_PATH,
      original.replace(CONTAINMENT_SEP_TARGET, CONTAINMENT_SEP_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkBoundaryRejections(tripViolations);
    console.log(
      `\n--break boundary-rejections TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("sibling-prefix leaked contents"),
    );
  } finally {
    writeFileSync(VIEWER_ROUTE_PATH, original);
    resetBuildCache();
    unregisterRestore(VIEWER_ROUTE_PATH);
  }

  const restoreViolations = [];
  await checkBoundaryRejections(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break boundary-rejections RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

// ---------------------------------------------------------------------------
// size-cap: an in-root .md strictly over 2 MB gets 413, a real under-cap file
// still gets 200 (proves the 413 is not vacuous).
// ---------------------------------------------------------------------------

const OVERSIZED_BYTES = 2 * 1024 * 1024 + 64;

/**
 * Under-cap control first (proves the server serves), then the oversized leg: a real file
 * strictly greater than 2 MB must 413 with `{ error: "too-large" }` and never the file bytes.
 */
async function checkSizeCap(violations) {
  assertBuilt();
  const home = makeSandboxHome("size-cap");
  let boot;
  try {
    const workspaces = join(home, "workspaces");
    mkdirSync(workspaces, { recursive: true });

    const sentinel = `panel-111-sentinel-${process.pid}`;
    const smallBytes = `# Small\n\nSIZE-CAP-SMALL-${sentinel}\n`;
    const smallPath = join(workspaces, "small.md");
    writeFileSync(smallPath, smallBytes, "utf8");

    const bigPath = join(workspaces, "big.md");
    writeFileSync(bigPath, Buffer.alloc(OVERSIZED_BYTES, "a"));

    boot = bootServerAt(home);
    await waitForReady(SANDBOX_PORT);

    const base = `http://127.0.0.1:${SANDBOX_PORT}/api/viewer/file`;

    const smallRes = await fetch(
      `${base}?path=${encodeURIComponent(smallPath)}`,
    );
    const smallBody = await smallRes.text();
    if (smallRes.status !== 200 || smallBody !== smallBytes) {
      violations.push(
        `size-cap: under-cap control failed, expected 200 with exact small.md bytes, ` +
          `observed status ${smallRes.status}`,
      );
    }

    const bigRes = await fetch(`${base}?path=${encodeURIComponent(bigPath)}`);
    const bigBody = await bigRes.json().catch(() => null);
    if (bigRes.status !== 413) {
      violations.push(
        `size-cap: expected 413 for the oversized file, observed ${bigRes.status}`,
      );
    }
    if (bigBody?.error !== "too-large") {
      violations.push(
        `size-cap: expected body { error: "too-large" } for the oversized file, observed ${JSON.stringify(bigBody)}`,
      );
    }
  } finally {
    await stopServer(boot?.child);
    cleanupSandboxHome(home);
  }
}

const SIZE_CAP_BREAK_TARGET = "2 * 1024 * 1024";
const SIZE_CAP_BREAK_REPLACEMENT = "1024 * 1024 * 1024 * 1024";

/** `--break size-cap`: replaces the sole `2 * 1024 * 1024` literal (the `MAX_BYTES` definition)
 * with a value the oversized fixture can never exceed, and requires the SAME check to report the
 * big.md-not-413 violation. */
async function runBreakSizeCap() {
  assertBuilt();
  const original = readFileSync(VIEWER_ROUTE_PATH, "utf8");
  const occurrences = original.split(SIZE_CAP_BREAK_TARGET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `panel111: refusing to run --break size-cap, expected ` +
        `${JSON.stringify(SIZE_CAP_BREAK_TARGET)} to occur exactly once in ${VIEWER_ROUTE_PATH}, ` +
        `measured ${occurrences}. A miscounted anchor would mutate the wrong spot and report a ` +
        `false "the check cannot fail".`,
    );
  }

  let tripFired = false;
  registerRestore(VIEWER_ROUTE_PATH, original);
  try {
    writeFileSync(
      VIEWER_ROUTE_PATH,
      original.replace(SIZE_CAP_BREAK_TARGET, SIZE_CAP_BREAK_REPLACEMENT),
    );
    resetBuildCache();

    const tripViolations = [];
    await checkSizeCap(tripViolations);
    console.log(
      `\n--break size-cap TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );
    tripFired = tripViolations.some((v) =>
      v.includes("expected 413 for the oversized file"),
    );
  } finally {
    writeFileSync(VIEWER_ROUTE_PATH, original);
    resetBuildCache();
    unregisterRestore(VIEWER_ROUTE_PATH);
  }

  const restoreViolations = [];
  await checkSizeCap(restoreViolations);
  const restoreClean = restoreViolations.length === 0;
  console.log(
    `--break size-cap RESTORE leg: ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return { tripFired, restoreClean };
}

const CHECKS = {
  "serve-in-root": (violations) => checkServeInRoot(violations),
  "boundary-rejections": (violations) => checkBoundaryRejections(violations),
  "size-cap": (violations) => checkSizeCap(violations),
};

const BREAKS = {
  "serve-in-root": runBreakServeInRoot,
  "boundary-rejections": runBreakBoundaryRejections,
  "size-cap": runBreakSizeCap,
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
      "panel-111: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
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
  console.error(`panel-111 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
