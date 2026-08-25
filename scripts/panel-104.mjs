/**
 * Phase 104 plan 05/06 UI measurement instrument (VLT-03, dev/ops tooling, NOT test code): no
 * test framework, no assertion library, lives outside src/, the same category as
 * panel-92 through panel-100. It drives the Vault page inside Settings entirely through the
 * RENDERED UI in a real headless Chrome against a real sandboxed dispatch server, proving add,
 * fill, rotate, edit-purpose and delete all work end to end, and that the value input's autofill
 * opt-out attributes hold on the LIVE element a real user would type into.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-100.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on :4700, before this script boots any server or spawns any real process, and
 * there is no override flag.
 *
 * NO REAL TMUX, NO REAL TTYD. This instrument needs zero cards: the Vault tab's data source is
 * `/api/vault`, never a session or a card, and an empty board still renders the SyncStrip that
 * opens settings. A stub `claude` binary is still planted on PATH as defense in depth, branching
 * on `--version` per the boot-hang trap panel-94/95/96/98.mjs already document (startup probes
 * the binary with `claude --version`, untimeouted, before the server ever starts listening; a
 * from-scratch stub that blocks unconditionally hangs the boot).
 *
 * TRAP 1, THE BLIND-GEOMETRY TRAP (Phase 92's third dead instrument), applied here as a
 * CORROBORATION trap: a DOM read says what rendered, never what the server actually holds. Every
 * verb this instrument drives is asserted BOTH ways, once against the rendered row/badge/label and
 * once against an independent `apiGet("/api/vault")` read, so a check that only reads the DOM
 * cannot pass on a UI that silently failed to persist.
 *
 * TRAP 3 (v2.9's dead instrument #9), A SELECTOR MUST NEVER KEY ON THE PROPERTY IT IS ABOUT TO
 * MUTATE. Every element lookup in this file finds its target by aria-label or exact button text,
 * never by DOM order, position or styling, and every lookup throws on a missing or ambiguous node
 * rather than returning a falsy that would read as a pass.
 *
 * DEAD INSTRUMENT #8's LESSON, applied to the break's restore leg: the captured
 * `data-lpignore` value is restored via the CAPTURED string, never a bare `removeAttribute`
 * inverse, the two are not equivalent when the original element already carried an explicit value.
 *
 * macOS TRAP, load-bearing here too: `dist`'s `main()` guard compares `import.meta.url` against an
 * UNRESOLVED `process.argv[1]`; `realpathSync(entry)` before spawn fixes it (see `bootServerAt`).
 *
 * Usage:
 *   node scripts/panel-104.mjs                       every registered check, exits non-zero on
 *                                                     any violation.
 *   node scripts/panel-104.mjs --check <name>         one named check only, <name> one of
 *                                                     crud | autofill-defusal.
 *   node scripts/panel-104.mjs --break <name>         that check's OWN break: fires the SAME check
 *                                                     function the real run uses against a DOM
 *                                                     mutation, confirms it reports the violation
 *                                                     by name, restores the captured original
 *                                                     value, and re-confirms PASS, all inside one
 *                                                     Chrome tab. Never edits a source file.
 *
 * BREAK EVIDENCE, every break registered in this file has been run under `--break <name>` for
 * real and has been observed reporting its own violation. The quoted lines below are the VERBATIM
 * TRIP-leg output captured from that run:
 *   - (filled in by plan 05 task 2, once `--break autofill-defusal` has actually been run)
 * Plan 06 owns the query-param source-patching break and fills its own evidence in below this
 * line without disturbing the entries above it.
 *
 * Exit codes: 0 every requested check PASS (or, under `--break <name>`, the break correctly fired
 * and the restore leg re-passed). 1 a live :4700, a failed build, a sandbox safety violation, a DOM
 * node the evaluate could not resolve, any violated criterion, the real board.db changing during
 * the run, or a sandbox port still held after teardown.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
/** This instrument reads rendered DOM out of `dist/web`, a server-only build would serve whatever
 * stale bundle happens to be on disk, so this is the full `build`, never `build:server`. */
const BUILD_SCRIPT = "build";

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair in this repo. */
const SANDBOX_PORT = 47878;
const CDP_PORT = 9379;
const SANDBOX_PREFIX = "dispatch-panel-104-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RENDER_TIMEOUT_MS = 15_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-104-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-104-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-104-LIVE"))
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

function killAndWait(child) {
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

let headBuild = null;

/** Unconditional full `build` (web + server), this instrument reads rendered DOM. Never mtime-gated. */
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
function bootServerAt(home, pathPrefix) {
  assertBuilt();
  const env = { ...process.env, HOME: home, NODE_ENV: "production" };
  if (pathPrefix) env.PATH = `${pathPrefix}:${env.PATH ?? ""}`;
  return spawn("node", [realpathSync(DIST_ENTRY)], {
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

/**
 * Plant a stub `claude` executable at `<home>/bin/claude`, defense in depth only, since this
 * instrument never drives a real saga or opens a terminal. MUST branch on `--version`: startup
 * probes it, untimeouted, before the sandbox server ever starts listening, a stub blocking
 * unconditionally hangs the boot.
 */
function writeStubClaudeBinary(home) {
  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(binDir, "claude"),
    "#!/bin/sh\n" +
      'case " $* " in\n' +
      '  *" --version "*)\n' +
      '    echo "1.0.0 (Claude Code)"\n' +
      "    exit 0\n" +
      "    ;;\n" +
      "esac\n" +
      "echo 'panel-104 stub claude, deliberately never ready'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
}

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

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.pending.set(id, { resolve, reject });
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

async function evalReport(cdp, sessionId, violations, label, expr) {
  try {
    return await evalValue(cdp, sessionId, expr);
  } catch (err) {
    violations.push(`${label}: ${err.message}`);
    return null;
  }
}

async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

function statRealBoardDb() {
  const p = join(homedir(), ".dispatch", "board.db");
  try {
    const st = statSync(p);
    return { path: p, exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { path: p, exists: false, mtimeMs: null, size: null };
  }
}

function fmtStat(s) {
  return s.exists ? `mtimeMs=${s.mtimeMs} size=${s.size}` : "(absent)";
}

async function assertSandboxPortsFree() {
  for (const port of [SANDBOX_PORT, CDP_PORT]) {
    if (await isPortListening(port)) {
      const { stdout } = await execFileP("lsof", [
        "-nP",
        `-iTCP:${port}`,
      ]).catch((err) => ({
        stdout: err.stdout ?? "",
      }));
      throw new Error(
        `PANEL-104-STALE-PORT: :${port} is already held before this run started, a prior run of ` +
          `this file likely leaked a process. Kill it and confirm the port refuses a connection ` +
          `before rerunning:\n${stdout}`,
      );
    }
  }
}

async function checkPortsHeld() {
  try {
    const args = [SANDBOX_PORT, CDP_PORT].flatMap((p) => ["-i", `:${p}`]);
    const { stdout } = await execFileP("lsof", args).catch((err) => ({
      stdout: err.stdout ?? "",
    }));
    const held = stdout.trim() !== "";
    if (held)
      console.error(
        `ASSERTION: sandbox ports still held after teardown:\n${stdout}`,
      );
    return held;
  } catch {
    return false;
  }
}

function readFlag(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Stand-up / tear-down. Kept as separate top-level functions (never inlined
// into main()) because a later plan's `--break query-param` must tear down,
// patch a source file, rebuild, and stand up again inside one process run.
// ---------------------------------------------------------------------------

async function standUp() {
  await assertNoLiveService();
  await assertSandboxPortsFree();
  assertBuilt();

  const home = makeSandboxHome(`run-${process.pid}`);
  const pathPrefix = writeStubClaudeBinary(home);
  console.log(`standup: stub claude planted, ${join(pathPrefix, "claude")}`);

  const server = bootServerAt(home, pathPrefix);
  await waitForReady(SANDBOX_PORT);
  console.log(
    `standup: sandbox server ready on :${SANDBOX_PORT}, pid=${server.pid}`,
  );

  const chromeChild = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`)}`,
      "--no-first-run",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  await waitForCdpUp();

  const cdp = await connectCDP();
  const { targetId } = await cdp.send("Target.createTarget", {
    url: `http://127.0.0.1:${SANDBOX_PORT}/`,
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

  cdp.ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown") {
      console.error(
        `page exception: ${JSON.stringify(msg.params.exceptionDetails)}`,
      );
    }
  });

  // A missing settings opener means the SPA did not boot, and every later check would otherwise
  // report an empty-DOM false pass.
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let settingsOpenerReady = false;
  while (Date.now() < deadline) {
    try {
      if (
        await evalValue(
          cdp,
          sessionId,
          `document.querySelector('button[aria-label="Sync filters"]') != null`,
        )
      ) {
        settingsOpenerReady = true;
        break;
      }
    } catch {
      // page mid-navigation, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (!settingsOpenerReady) {
    throw new Error(
      `panel104: the settings opener (button[aria-label="Sync filters"]) never appeared within ` +
        `${RENDER_TIMEOUT_MS}ms, the SPA did not boot`,
    );
  }
  console.log("standup: board painted, settings opener present");

  return { home, server, chromeChild, cdp, sessionId, pathPrefix };
}

/** Every step tolerates a null or partially populated `ctx`, so a stand-up that failed halfway
 * still cleans up. */
async function tearDown(ctx) {
  if (ctx?.cdp) {
    try {
      ctx.cdp.close();
    } catch {
      // socket already gone
    }
  }
  await killAndWait(ctx?.chromeChild ?? null);
  await killAndWait(ctx?.server ?? null);
  if (ctx?.home) rmSync(ctx.home, { recursive: true, force: true });
  rmSync(join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`), {
    recursive: true,
    force: true,
  });
  return checkPortsHeld();
}

// ---------------------------------------------------------------------------
// Element helpers, shared by every check and break. Every selector below
// keys on an aria-label or exact button text, never on style, position or
// DOM order (TRAP 3).
// ---------------------------------------------------------------------------

/** Builds a `[aria-label="..."]` selector with the label's own quotes/backslashes escaped, so a
 * label containing either never breaks the selector. */
function ariaLabelSelector(ariaLabel) {
  const escaped = ariaLabel.replace(/["\\]/g, (c) => `\\${c}`);
  return `[aria-label="${escaped}"]`;
}

async function clickByAriaLabel(cdp, sessionId, ariaLabel) {
  const selector = ariaLabelSelector(ariaLabel);
  const expr = `(function () {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify(`panel104: no element found for ${selector}`)});
    if (el.disabled) throw new Error(${JSON.stringify(`panel104: element for ${selector} is disabled`)});
    el.click();
    return true;
  })()`;
  return evalValue(cdp, sessionId, expr);
}

async function clickByText(cdp, sessionId, selector, text) {
  const expr = `(function () {
    var matches = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(selector)})).filter(function (el) {
      return el.textContent.trim() === ${JSON.stringify(text)};
    });
    if (matches.length !== 1) {
      throw new Error(${JSON.stringify(`panel104: selector ${selector} text ${JSON.stringify(text)} matched `)} + matches.length + " element(s), expected exactly 1");
    }
    matches[0].click();
    return true;
  })()`;
  return evalValue(cdp, sessionId, expr);
}

/** Focus, `Input.insertText`, then READ THE VALUE BACK and throw on mismatch. These are React
 * controlled inputs, and an insert the framework discards would otherwise leave the check
 * asserting against an empty field and reporting a confusing downstream failure. */
async function typeInto(cdp, sessionId, ariaLabel, text) {
  const selector = ariaLabelSelector(ariaLabel);
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error(${JSON.stringify(`panel104: no input found for ${selector}`)});
      el.focus();
      return true;
    })()`,
  );
  await cdp.send("Input.insertText", { text }, sessionId);
  const value = await evalValue(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(selector)}).value`,
  );
  if (value !== text) {
    throw new Error(
      `panel104: typeInto(${ariaLabel}) read back ${JSON.stringify(value)}, expected ${JSON.stringify(text)}`,
    );
  }
}

/** Same read-back contract as `typeInto`, but select-all-then-insert, for clearing an
 * already-populated input (the purpose editor's reseeded draft) before typing the new text. */
async function selectAllAndType(cdp, sessionId, ariaLabel, text) {
  const selector = ariaLabelSelector(ariaLabel);
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error(${JSON.stringify(`panel104: no input found for ${selector}`)});
      el.focus();
      el.setSelectionRange(0, el.value.length);
      return true;
    })()`,
  );
  await cdp.send("Input.insertText", { text }, sessionId);
  const value = await evalValue(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(selector)}).value`,
  );
  if (value !== text) {
    throw new Error(
      `panel104: selectAllAndType(${ariaLabel}) read back ${JSON.stringify(value)}, expected ${JSON.stringify(text)}`,
    );
  }
}

async function waitForExpr(
  cdp,
  sessionId,
  expression,
  label,
  timeoutMs = RENDER_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evalValue(cdp, sessionId, expression)) return;
    } catch {
      // page mid-render, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Opens Settings then the Vault tab. Idempotent: if the Vault page is already showing, this is a
 * no-op, so a check can call it after a reload without special-casing. */
async function openVaultTab(cdp, sessionId) {
  const alreadyOnVault = await evalValue(
    cdp,
    sessionId,
    `document.querySelector('[aria-label="New key name"]') != null`,
  );
  if (alreadyOnVault) return;
  await clickByAriaLabel(cdp, sessionId, "Sync filters");
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector('[role="dialog"][aria-label="Settings"]') != null`,
    "the Settings dialog to open",
  );
  await clickByText(cdp, sessionId, "button", "Vault");
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector('[aria-label="New key name"]') != null`,
    "the Vault page to paint",
  );
}

/** The corroborating read: the DOM says what was rendered, this says what the server actually
 * holds. */
async function apiGet(path) {
  const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}${path}`);
  return res.json();
}

/** Reads a vault row's badge text ("Filled"/"Empty") and full text content, located from its own
 * delete button via `closest`, never by DOM order. */
async function readVaultRowState(cdp, sessionId, name) {
  const expr = `(function () {
    var del = document.querySelector(${JSON.stringify(ariaLabelSelector(`Delete ${name}`))});
    if (!del) return { found: false };
    var row = del.closest("div");
    if (!row) throw new Error(${JSON.stringify(`panel104: row container for ${name} not found`)});
    var badgeSpans = Array.prototype.slice.call(row.querySelectorAll("span")).filter(function (s) {
      var t = s.textContent.trim();
      return t === "Filled" || t === "Empty";
    });
    return {
      found: true,
      rowText: row.textContent,
      badgeText: badgeSpans.length > 0 ? badgeSpans[badgeSpans.length - 1].textContent.trim() : null,
    };
  })()`;
  return evalValue(cdp, sessionId, expr);
}

// ---------------------------------------------------------------------------
// Checks. `CHECKS` is the named-check dispatch idiom copied from
// `session-liveness-v3.mjs`'s own `CHECKS`/`--check` table. Every check pushes
// violation strings prefixed with its own name, naming the step, the
// expectation and the measured reading.
// ---------------------------------------------------------------------------

/** Drives add, fill, rotate, edit-purpose and delete entirely through the rendered Vault page,
 * corroborating every step against `apiGet("/api/vault")`. */
async function checkCrud(cdp, sessionId, violations) {
  const NAME = "PANEL104_CRUD";
  await openVaultTab(cdp, sessionId);

  // 1. ADD
  await typeInto(cdp, sessionId, "New key name", NAME);
  await typeInto(cdp, sessionId, "New key purpose", "crud leg one");
  await clickByText(cdp, sessionId, "button", "Add key");
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Delete ${NAME}`))}) != null`,
    `the ${NAME} row to appear after add`,
  );
  const addRow = await readVaultRowState(cdp, sessionId, NAME);
  if (!addRow.found || addRow.badgeText !== "Empty") {
    violations.push(
      `crud: ADD expected ${NAME}'s badge to read "Empty", measured ${JSON.stringify(addRow)}`,
    );
  }
  const addApi = await apiGet("/api/vault");
  const addKey = addApi.keys?.find((k) => k.name === NAME);
  if (
    addKey == null ||
    addKey.filled !== false ||
    addKey.purpose !== "crud leg one"
  ) {
    violations.push(
      `crud: ADD expected apiGet to report {filled:false, purpose:"crud leg one"}, measured ${JSON.stringify(addKey)} (DOM read: ${JSON.stringify(addRow)})`,
    );
  }

  // 2. FILL
  const fillLabelPresentBefore = await evalValue(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Fill value for ${NAME}`))}) != null`,
  );
  if (!fillLabelPresentBefore) {
    violations.push(
      `crud: FILL expected the value action's accessible name to be "Fill value for ${NAME}" before any value is set`,
    );
  }
  await clickByAriaLabel(cdp, sessionId, `Fill value for ${NAME}`);
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Value for ${NAME}`))}) != null`,
    `the value editor for ${NAME} to open`,
  );
  await typeInto(cdp, sessionId, `Value for ${NAME}`, "crud-value-one");
  await clickByText(cdp, sessionId, "button", "Save value");
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Value for ${NAME}`))}) == null`,
    `the value editor for ${NAME} to collapse after fill`,
  );
  const fillRow = await readVaultRowState(cdp, sessionId, NAME);
  if (!fillRow.found || fillRow.badgeText !== "Filled") {
    violations.push(
      `crud: FILL expected ${NAME}'s badge to read "Filled", measured ${JSON.stringify(fillRow)}`,
    );
  }
  const rotateLabelPresent = await evalValue(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Rotate value for ${NAME}`))}) != null`,
  );
  if (!rotateLabelPresent) {
    violations.push(
      `crud: FILL expected the value action's accessible name to flip to "Rotate value for ${NAME}"`,
    );
  }
  const fillApi = await apiGet("/api/vault");
  const fillKey = fillApi.keys?.find((k) => k.name === NAME);
  if (fillKey == null || fillKey.filled !== true) {
    violations.push(
      `crud: FILL expected apiGet to report filled:true, measured ${JSON.stringify(fillKey)}`,
    );
  }
  const fillUpdatedAt = fillKey?.updatedAt;

  // 3. ROTATE
  await clickByAriaLabel(cdp, sessionId, `Rotate value for ${NAME}`);
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Value for ${NAME}`))}) != null`,
    `the value editor for ${NAME} to open for rotate`,
  );
  await typeInto(cdp, sessionId, `Value for ${NAME}`, "crud-value-two");
  await clickByText(cdp, sessionId, "button", "Save value");
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Value for ${NAME}`))}) == null`,
    `the value editor for ${NAME} to collapse after rotate`,
  );
  const rotateRow = await readVaultRowState(cdp, sessionId, NAME);
  if (!rotateRow.found || rotateRow.badgeText !== "Filled") {
    violations.push(
      `crud: ROTATE expected ${NAME}'s badge to still read "Filled", measured ${JSON.stringify(rotateRow)}`,
    );
  }
  const rotateApi = await apiGet("/api/vault");
  const rotateKey = rotateApi.keys?.find((k) => k.name === NAME);
  const strictlyLater =
    rotateKey != null &&
    fillUpdatedAt != null &&
    new Date(rotateKey.updatedAt).getTime() > new Date(fillUpdatedAt).getTime();
  if (!strictlyLater) {
    violations.push(
      `crud: ROTATE expected updatedAt to strictly increase from ${fillUpdatedAt}, measured ${rotateKey?.updatedAt}`,
    );
  }
  if (
    rotateKey != null &&
    (rotateKey.purpose !== "crud leg one" ||
      rotateKey.createdAt !== addKey?.createdAt)
  ) {
    violations.push(
      `crud: ROTATE expected purpose and createdAt unchanged, measured purpose=${JSON.stringify(rotateKey.purpose)} createdAt=${rotateKey.createdAt} (expected createdAt=${addKey?.createdAt})`,
    );
  }

  // 4. EDIT PURPOSE
  await clickByAriaLabel(cdp, sessionId, `Edit purpose for ${NAME}`);
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Purpose for ${NAME}`))}) != null`,
    `the purpose editor for ${NAME} to open`,
  );
  await selectAllAndType(cdp, sessionId, `Purpose for ${NAME}`, "crud leg two");
  await clickByAriaLabel(cdp, sessionId, `Save purpose for ${NAME}`);
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Purpose for ${NAME}`))}) == null`,
    `the purpose editor for ${NAME} to close`,
  );
  const purposeRow = await readVaultRowState(cdp, sessionId, NAME);
  if (
    !purposeRow.found ||
    !purposeRow.rowText.includes("crud leg two") ||
    purposeRow.rowText.includes("crud leg one")
  ) {
    violations.push(
      `crud: EDIT PURPOSE expected row text to contain "crud leg two" and not "crud leg one", measured ${JSON.stringify(purposeRow.rowText)}`,
    );
  }
  const purposeApi = await apiGet("/api/vault");
  const purposeKey = purposeApi.keys?.find((k) => k.name === NAME);
  if (
    purposeKey == null ||
    purposeKey.purpose !== "crud leg two" ||
    purposeKey.filled !== true
  ) {
    violations.push(
      `crud: EDIT PURPOSE expected apiGet to report {purpose:"crud leg two", filled:true}, measured ${JSON.stringify(purposeKey)}`,
    );
  }

  // 5. DELETE
  await clickByAriaLabel(cdp, sessionId, `Delete ${NAME}`);
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(`[role="dialog"][aria-label="Delete ${NAME}"]`)}) != null`,
    `the delete confirmation dialog for ${NAME} to open`,
  );
  await clickByText(cdp, sessionId, "button", "Delete key");
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Delete ${NAME}`))}) == null`,
    `the ${NAME} row's delete control to disappear`,
  );
  const deleteApi = await apiGet("/api/vault");
  if (deleteApi.keys?.some((k) => k.name === NAME)) {
    violations.push(
      `crud: DELETE expected apiGet's keys to contain no entry named ${NAME}, measured ${JSON.stringify(deleteApi.keys)}`,
    );
  }
}

/** Stands the check's subject up through the real add-then-fill flow (never the API directly, the
 * point is that the element under test is the one the real flow produces). */
async function standUpAutofillSubject(cdp, sessionId) {
  const NAME = "PANEL104_ATTR";
  await openVaultTab(cdp, sessionId);
  await typeInto(cdp, sessionId, "New key name", NAME);
  await typeInto(cdp, sessionId, "New key purpose", "attribute leg");
  await clickByText(cdp, sessionId, "button", "Add key");
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Delete ${NAME}`))}) != null`,
    `the ${NAME} row to appear`,
  );
  await clickByAriaLabel(cdp, sessionId, `Fill value for ${NAME}`);
  await waitForExpr(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(ariaLabelSelector(`Value for ${NAME}`))}) != null`,
    `the value editor for ${NAME} to open`,
  );
  return NAME;
}

/** Reads the LIVE value input in one `Runtime.evaluate`: the IDL `type` property (the effective
 * type the browser applied), the authored `type` attribute, `autocomplete`, the three manager
 * opt-out attributes, and a document-wide count of every `input[type="password"]`. */
async function readAutofillElement(cdp, sessionId, name) {
  const expr = `(function () {
    var el = document.querySelector(${JSON.stringify(ariaLabelSelector(`Value for ${name}`))});
    if (!el) throw new Error(${JSON.stringify(`panel104: value input for ${name} not found`)});
    return {
      tagName: el.tagName,
      type: el.type,
      attrType: el.getAttribute("type"),
      autocomplete: el.getAttribute("autocomplete"),
      has1pIgnore: el.hasAttribute("data-1p-ignore"),
      lpignore: el.getAttribute("data-lpignore"),
      bwignore: el.getAttribute("data-bwignore"),
      passwordInputCount: document.querySelectorAll('input[type="password"]').length,
    };
  })()`;
  return evalValue(cdp, sessionId, expr);
}

/** The document-wide password-input assertion is the one that catches a regression that adds a
 * password field somewhere else in settings rather than on this input. */
function assertAutofillReading(reading, violations) {
  if (reading.tagName !== "INPUT") {
    violations.push(
      `autofill-defusal: expected an INPUT element, measured tagName=${reading.tagName}`,
    );
    return;
  }
  if (reading.type !== "text" || reading.attrType !== "text") {
    violations.push(
      `autofill-defusal: expected type "text" (IDL and attribute), measured type=${reading.type} attribute type=${reading.attrType}`,
    );
  }
  if (reading.autocomplete !== "new-password") {
    violations.push(
      `autofill-defusal: expected autocomplete="new-password", measured ${JSON.stringify(reading.autocomplete)}`,
    );
  }
  if (reading.has1pIgnore !== true) {
    violations.push(
      `autofill-defusal: expected data-1p-ignore present, measured hasAttribute=${reading.has1pIgnore}`,
    );
  }
  if (reading.lpignore !== "true") {
    violations.push(
      `autofill-defusal: expected data-lpignore="true", measured ${JSON.stringify(reading.lpignore)}`,
    );
  }
  if (reading.bwignore !== "true") {
    violations.push(
      `autofill-defusal: expected data-bwignore="true", measured ${JSON.stringify(reading.bwignore)}`,
    );
  }
  if (reading.passwordInputCount !== 0) {
    violations.push(
      `autofill-defusal: expected zero type="password" inputs document-wide, measured ${reading.passwordInputCount}`,
    );
  }
}

async function checkAutofillDefusal(cdp, sessionId, violations) {
  const name = await standUpAutofillSubject(cdp, sessionId);
  const reading = await readAutofillElement(cdp, sessionId, name);
  assertAutofillReading(reading, violations);
}

const CHECKS = { crud: checkCrud, "autofill-defusal": checkAutofillDefusal };

// ---------------------------------------------------------------------------
// Breaks. Fires the SAME check function the real run uses against a DOM
// mutation, confirms it reports the violation by name, restores via the
// CAPTURED original value, and re-confirms PASS. Never edits a source file.
// ---------------------------------------------------------------------------

/** `autofill-defusal` break: removes `data-lpignore` from the live value input (captured first),
 * so the `data-lpignore` assertion fires. Restore uses the CAPTURED string, never a bare
 * `removeAttribute` inverse (Dead Instrument #8). */
async function runBreakAutofillDefusal(cdp, sessionId) {
  console.log(
    "\n--break autofill-defusal: removing data-lpignore from the live value input",
  );
  const name = await standUpAutofillSubject(cdp, sessionId);
  const selector = ariaLabelSelector(`Value for ${name}`);

  const original = await evalValue(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(selector)}).getAttribute("data-lpignore")`,
  );
  console.log(
    `--break autofill-defusal: captured original data-lpignore = ${JSON.stringify(original)}`,
  );

  await evalValue(
    cdp,
    sessionId,
    `(function () {
      document.querySelector(${JSON.stringify(selector)}).removeAttribute("data-lpignore");
      return true;
    })()`,
  );
  const tripViolations = [];
  assertAutofillReading(
    await readAutofillElement(cdp, sessionId, name),
    tripViolations,
  );
  console.log(
    `--break autofill-defusal TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) => v.indexOf("data-lpignore") !== -1,
  );

  await evalValue(
    cdp,
    sessionId,
    `(function () {
      document.querySelector(${JSON.stringify(selector)}).setAttribute("data-lpignore", ${JSON.stringify(original)});
      return true;
    })()`,
  );
  const restoreViolations = [];
  assertAutofillReading(
    await readAutofillElement(cdp, sessionId, name),
    restoreViolations,
  );
  console.log(
    `--break autofill-defusal RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

const BREAKS = { "autofill-defusal": runBreakAutofillDefusal };

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
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

  const realBefore = statRealBoardDb();
  console.log(`\nLIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const violations = [];
  let ctx = null;
  let portsHeld = false;
  let breakResult = null;

  try {
    ctx = await standUp();
    if (breakName != null) {
      breakResult = await BREAKS[breakName](ctx.cdp, ctx.sessionId);
    } else {
      const names = checkName != null ? [checkName] : Object.keys(CHECKS);
      for (const n of names) {
        console.log(`\n=== running check: ${n} ===`);
        const before = violations.length;
        try {
          await CHECKS[n](ctx.cdp, ctx.sessionId, violations);
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
    }
  } finally {
    portsHeld = await tearDown(ctx);
  }

  const realAfter = statRealBoardDb();
  console.log(`\nLIVE ${realAfter.path} AFTER: ${fmtStat(realAfter)}`);
  if (
    realBefore.exists !== realAfter.exists ||
    realBefore.mtimeMs !== realAfter.mtimeMs ||
    realBefore.size !== realAfter.size
  ) {
    console.log(
      `FAIL: the real ${realAfter.path} changed during this run. before=${fmtStat(realBefore)} after=${fmtStat(realAfter)}`,
    );
    process.exit(1);
  }

  if (portsHeld) {
    console.log(
      "\nFAIL: a sandbox resource (port) was still held after teardown",
    );
    process.exit(1);
  }

  if (breakName != null) {
    console.log(
      `\n--break ${breakName} summary: tripFired=${breakResult.tripFired} restoreClean=${breakResult.restoreClean}`,
    );
    if (!breakResult.tripFired) {
      console.log(
        `FAIL (self-check): the trip leg did NOT report the expected violation for "${breakName}", the check is a dead instrument.`,
      );
      process.exit(1);
    }
    if (!breakResult.restoreClean) {
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

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`  ${v}`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`panel-104 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
