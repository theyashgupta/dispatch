/**
 * Mobile terminal touch/scroll diagnosis instrument (Phase 101, TERM-04, dev/ops tooling, NOT test
 * code): lives outside src/, imports no test framework, asserts nothing via an assertion library,
 * the same category as check-invariants.mjs, session-liveness-v3.mjs and panel-100.mjs.
 *
 * Plan 101-01 built the FOUNDATION: a real-tmux/real-ttyd fixture whose pane carries production's
 * alternate_on=1/mouse_any_flag=1 mouse-report state, plus three self-proofs that must hold before
 * any round-trip or latency number means anything: the emulated coarse pointer really flipped, the
 * emulated touch stream really engaged the real kinetic scroller, and a flick really produced INPUT
 * frames on the real ttyd WebSocket.
 *
 * Plan 101-02 (this plan) turns the proven-live gesture into numbers: `--check round-trips` (five
 * separately attributable per-flick costs: INPUT frames, OUTPUT frames, settle latency, LoAF
 * blockingDuration, dropped frames) and `--check flick-distance` (the summed dispatched wheel
 * deltaY one canonical flick produces, the v2.7.2-class geometry calibration this repo has never had
 * a runnable check for). Deliberately two separate measurement surfaces with two separate
 * comparators (THRESHOLD for the jittery latency numbers, ZERO-TOLERANCE for geometry): a fix that
 * batches round trips is supposed to reduce the first and leave the second byte-identical.
 * DIAGNOSIS-ONLY, no src/ file is touched by this plan.
 *
 * SAFETY IS THIS FILE'S FIRST-ORDER CONCERN, same posture as session-liveness-v3.mjs and
 * panel-100.mjs: assertNoLiveService() fails closed against the user's real :4700 service before any
 * process is spawned, every sandbox path is asserted under os.tmpdir() with a
 * dispatch-mobile-term-101- basename, the real ~/.dispatch/board.db is stat'd before and after every
 * run and a mismatch is a loud non-zero exit, and every spawned process (server, ttyd, tmux, Chrome)
 * is torn down in a finally whose own success is verified, never assumed.
 *
 * Usage:
 *   node scripts/mobile-term-101.mjs --check standup      the fixture standup/teardown proof, no CDP
 *   node scripts/mobile-term-101.mjs --check activation   the three activation self-proofs (coarse
 *                                                          pointer, kinetic engagement, wire traffic)
 *   node scripts/mobile-term-101.mjs --check round-trips  five numbers per flick, median + spread
 *                                                          over 5 runs, --json <path> supported
 *   node scripts/mobile-term-101.mjs --check flick-distance  summed wheel deltaY per canonical
 *                                                             flick, --json/--compare supported
 *   node scripts/mobile-term-101.mjs --break viewport-fixture     trips assertPaneModes's own "1 1"
 *                                                                  precondition
 *   node scripts/mobile-term-101.mjs --break no-touch-emulation   trips proof A
 *   node scripts/mobile-term-101.mjs --break sub-slop-flick       trips proof B, proof A stays green
 *   node scripts/mobile-term-101.mjs --break wrong-page           trips proof C, names the wrong URL
 *   node scripts/mobile-term-101.mjs --break loaf-blind      round-trips runs blind to LoAF
 *   node scripts/mobile-term-101.mjs --break dead-listener   round-trips against dead listeners
 *   node scripts/mobile-term-101.mjs --break drop-wheel-ticks  flick-distance vs. a live 1-in-5
 *                                                                dropped-wheel-tick page mutation
 *   node scripts/mobile-term-101.mjs --check tunnel        a real Quick Tunnel, real remote-auth
 *                                                           handshake, the three TERM-06 clauses
 *   node scripts/mobile-term-101.mjs --check round-trips --tunnel     loopback vs tunnel round
 *                                                                      trips, same 5-run measurement
 *   node scripts/mobile-term-101.mjs --check flick-distance --tunnel --json <path>   the tunnel-path
 *                                                                                     geometry baseline
 *   node scripts/mobile-term-101.mjs --break skip-auth      tunnel URL with no ?code=, proves the
 *                                                            check can tell the code-entry page apart
 *   node scripts/mobile-term-101.mjs --break wrong-code     tunnel URL with a wrong passphrase
 *   node scripts/mobile-term-101.mjs --check pty-shim        drives the REAL installed shim
 *                                                             directly: whole/split marker strip,
 *                                                             byte-exact passthrough
 *   node scripts/mobile-term-101.mjs --break shim-markers-emptied   MARKERS tuple emptied on a
 *                                                                    copy of the installed shim
 *
 * Plan 101-03 adds the tunnel leg above: a real Cloudflare Quick Tunnel brought up through the
 * real product route, a real `?code=` auth handshake, TERM-06's three clauses proven over it, and
 * a `--tunnel` modifier on the round-trips/flick-distance legs so loopback and tunnel numbers
 * exist side by side. Still DIAGNOSIS-ONLY: no `src/` file is touched.
 *
 * Plan 101.1-01 (this plan) verifies the ARCHITECTURE that shipped after diagnosis: the
 * `--check pty-shim` leg above, plus `--check local-scroll` and `--check seed` (both added by
 * later tasks in this same plan). This is the first plan in this file that IS allowed to read
 * `src/` production modules directly (`pty-shim-setup.js`'s `installPtyShim` export), never to
 * copy their bodies.
 *
 * Exit codes: 0 all checks PASS. 1 a safety-envelope refusal, a setup/build error, a check
 * violation, a teardown-verification failure, or the live board.db changing.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
/** Full build (web + server): task 2's activation check reads real rendered DOM through CDP, a
 * server-only build would serve a stale bundle at /sessions/:id/terminal/. */
const BUILD_SCRIPT = "build";

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair (census: highest prior pair is
 * panel-100.mjs's 47876/9377). Neither number below equals any of them. */
const SANDBOX_PORT = 47877;
const CDP_PORT = 9378;
const SANDBOX_PREFIX = "dispatch-mobile-term-101-";

const DISPATCH_DIR_NAME = ".dispatch";
const FAKE_LINEAR_API_KEY = "mobile-term-101-harness-fake-key-never-real";

/** Retained fingerprint key adoptAndSweep looks for, matching production's own spawnTtyd argv
 * (ttyd.ts) and session-liveness-v3.mjs's own constant of the same name and value. */
const TTYD_REVISION_RETAINED_KEY = "DISPATCH_TTYD_REVISION_6";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const PORT_PARSE_TIMEOUT_MS = 10_000;
const LISTEN_POLL_TIMEOUT_MS = 10_000;
const PANE_MODES_TIMEOUT_MS = 3_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readFlag(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Secret redaction (101-03, T-101-08): the tunnel leg's URL and passphrase are a
// live, unauthenticated-until-gated public ingress. `console.log`/`console.error`
// are patched ONCE here, at module scope, so every later log call in this file
// (including an uncaught error's own stack/message, printed by main()'s generic
// catch) is scrubbed automatically, never per-call-site. Deliberately never
// cleared mid-process: this is a one-shot CLI that exits right after `main()`,
// and an early clear is worse than a no-op, a prior version of this file
// cleared it in a `finally` block, which wiped the registry BEFORE main()'s own
// outer catch printed the violation message, leaking the real host. `liveSecrets`
// simply accumulates across however many tunnels this one process brings up.
// ---------------------------------------------------------------------------

let liveSecrets = [];

function registerTunnelSecret(value, redacted) {
  if (typeof value === "string" && value.length > 0) {
    liveSecrets.push({ value, redacted });
  }
}

function redactString(str) {
  let out = str;
  for (const { value, redacted } of liveSecrets) {
    out = out.split(value).join(redacted);
  }
  return out;
}

const _origConsoleLog = console.log.bind(console);
const _origConsoleError = console.error.bind(console);
console.log = (...args) =>
  _origConsoleLog(
    ...args.map((a) => (typeof a === "string" ? redactString(a) : a)),
  );
console.error = (...args) =>
  _origConsoleError(
    ...args.map((a) => (typeof a === "string" ? redactString(a) : a)),
  );

/** Registers the live tunnel URL (both the full origin and the bare hostname, since either can
 * appear standalone in a CDP/Node error message) and passphrase for redaction. Call the instant
 * `enableTunnelViaLoopback` resolves, before any log or error can observe them unredacted. */
function registerTunnelSecrets(state) {
  registerTunnelSecret(state.url, "https://***.trycloudflare.com");
  try {
    registerTunnelSecret(new URL(state.url).hostname, "***.trycloudflare.com");
  } catch {}
  registerTunnelSecret(state.code, "<redacted-passphrase>");
}

// ---------------------------------------------------------------------------
// Safety envelope, reused verbatim in shape from panel-100.mjs /
// session-liveness-v3.mjs.
// ---------------------------------------------------------------------------

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "MOBILE-TERM-101-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("MOBILE-TERM-101-LIVE"))
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
  const dispatchDir = join(home, DISPATCH_DIR_NAME);
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

/** True while pid still answers a signal-0 existence probe (ESRCH means it is gone). */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

let headBuild = null;

/** Unconditional full `build` (web + server), never mtime-gated, matching panel-100.mjs's own
 * assertBuilt precedent for a harness that reads rendered DOM through CDP. */
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
function bootServer(home, opts = {}) {
  assertBuilt();
  const env = { ...process.env, HOME: home, NODE_ENV: "production" };
  if (opts.pathPrefix) env.PATH = `${opts.pathPrefix}:${env.PATH ?? ""}`;
  if (opts.telemetry) env.DISPATCH_TERM_TELEMETRY = "1";
  const child = spawn("node", [realpathSync(DIST_ENTRY)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logLines = [];
  const capture = (buf) => {
    for (const line of buf.toString().split("\n")) {
      if (line.length > 0) logLines.push(line);
    }
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  return { child, logLines };
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

/** Minimal raw-CDP-over-WebSocket client (Node global WebSocket/fetch, zero new npm dependency).
 * Reused verbatim in shape from panel-100.mjs. Not called by the standup check itself (task 1);
 * task 2's activation check is what drives Chrome through this. */
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

  /** `timeoutMs` is a defensive bound against a genuinely lost response, not a normal-path
   * concern, same rationale as panel-100.mjs's own CDP.send. */
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

async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

async function waitForPortListening(port, timeoutMs = LISTEN_POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `port ${port} never reported LISTENING via lsof within ${timeoutMs}ms`,
  );
}

/** `tmux list-sessions -F '#{session_name}'`, tolerant of a dead/absent tmux server (empty list). */
async function tmuxListSessionNames() {
  try {
    const { stdout } = await execFileP("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
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
      ]).catch((err) => ({ stdout: err.stdout ?? "" }));
      throw new Error(
        `MOBILE-TERM-101-STALE-PORT: :${port} is already held before this run started, a prior run ` +
          `of this file likely leaked a process. Kill it and confirm the port refuses a connection ` +
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

// ---------------------------------------------------------------------------
// Fixture primitives specific to this phase: a production-shaped mouse-report
// pane, real ttyd against it, and one card plus one session record.
// ---------------------------------------------------------------------------

/**
 * A dedicated fixture binary for this phase, NOT a copy of writeStubClaudeBinary
 * (session-liveness-v3.mjs), which never enters the alternate screen and never enables mouse
 * tracking, so scrollMode() would resolve "viewport" and this whole phase would measure the wrong
 * branch. Answers a --version/--help probe (the boot-time checkHooksCapability probe,
 * session-liveness-v3.mjs's own recorded boot-hang trap) by printing a version line and exiting 0.
 * On a bare invocation it emits the alternate-screen plus any-motion mouse-report escape sequence
 * and then blocks forever.
 */
function writeMouseReportFixtureBinary(home) {
  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(binDir, "claude"),
    "#!/bin/sh\n" +
      'case " $* " in\n' +
      '  *" --version "*|*" --help "*)\n' +
      '    echo "1.0.0 (Claude Code)"\n' +
      "    exit 0\n" +
      "    ;;\n" +
      "esac\n" +
      "printf '\\033[?1049h\\033[?1003h\\033[?1006h'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
}

/**
 * writeStubClaudeBinary's exact sleep-loop body (session-liveness-v3.mjs:1325-1343), planted ONLY
 * by the viewport-fixture break leg to prove assertPaneModes's "1 1" precondition can actually
 * fail. Never used by the standup or activation checks themselves.
 */
function writeViewportFixtureBinary(home) {
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
      "echo 'bypass permissions on (shift+tab to cycle)'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
}

/** Same shape as session-liveness-v3.mjs's tmuxNewSession, but the pane command is the fixture
 * binary itself (so its escape sequences actually reach the pane's pty) instead of a bare sleep
 * loop. */
async function tmuxNewFixtureSession(name, cwd, binPath) {
  await execFileP("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    cwd,
    binPath,
  ]);
}

/**
 * Precondition, not a soft check: polls (short-lived pty startup can lag a few ms behind
 * `new-session -d` returning) until `tmux display-message -p -t "=<name>:" '#{alternate_on}
 * #{mouse_any_flag}'` reads exactly "1 1", or throws with the measured string. The trailing colon
 * on the `=` exact-match target is required, this machine's tmux reports "can't find pane" without
 * it even against a live session.
 */
async function assertPaneModes(tmuxName, timeoutMs = PANE_MODES_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let measured = "";
  while (Date.now() < deadline) {
    const { stdout } = await execFileP("tmux", [
      "display-message",
      "-p",
      "-t",
      `=${tmuxName}:`,
      "#{alternate_on} #{mouse_any_flag}",
    ]);
    measured = stdout.trim();
    if (measured === "1 1") return measured;
    await sleep(100);
  }
  throw new Error(
    `alternate_on/mouse_any_flag expected "1 1", measured "${measured}"`,
  );
}

/** Real ttyd against `session`, keyed by `sessionId` (never the card id, PROXY-01), carrying
 * production's exact argv shape including the retained fingerprint key adoptAndSweep needs to
 * re-adopt it. Reused verbatim in shape from session-liveness-v3.mjs's own spawnTtyd. */
function spawnTtyd(session, sessionId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ttyd",
      [
        "-W",
        "-i",
        "127.0.0.1",
        "-p",
        "0",
        "-b",
        `/sessions/${sessionId}/terminal`,
        "-t",
        "disableLeaveAlert=true",
        "-t",
        `${TTYD_REVISION_RETAINED_KEY}=1`,
        "tmux",
        "-u",
        "attach",
        "-t",
        `=${session}`,
      ],
      { detached: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    let buf = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `ttyd port not reported within ${PORT_PARSE_TIMEOUT_MS}ms for ${session}`,
        ),
      );
    }, PORT_PARSE_TIMEOUT_MS);
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/Listening on port:\s*(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stderr?.off("data", onData);
        child.unref();
        resolve({ child, port: Number(m[1]) });
      }
    };
    child.stderr?.on("data", onData);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`ttyd exited early (code ${code}) for ${session}: ${buf}`),
      );
    });
  });
}

/** Insert one card row directly via node:sqlite, the migration-diff-v3.mjs/session-liveness-v3.mjs
 * seeding idiom, and pin meta.schemaVersion so boot runs no entity migration over this hand-built
 * sessions[]/activeSessionId shape. */
function seedFixtureCard(home, card) {
  const dbPath = join(home, DISPATCH_DIR_NAME, "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    ).run(card.id, JSON.stringify(card));
    const metaRow = db.prepare("SELECT data FROM meta WHERE id = 0").get();
    const meta = metaRow ? JSON.parse(metaRow.data) : {};
    meta.schemaVersion = 1;
    db.prepare(
      `INSERT INTO meta (id, data) VALUES (0, @data)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    ).run({ data: JSON.stringify(meta) });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

/**
 * Stand up one production-shaped fixture: warmup boot then kill first (its own reconcileSessions()
 * sweep would otherwise eat a ttyd spawned before the warmup, the Phase 91 trap), plant the fixture
 * binary, a real tmux pane running it, assertPaneModes as a precondition, a real ttyd against that
 * pane, one card plus one session record seeded via node:sqlite, then the real boot, whose own
 * reconcileSessions() adopts the already-running ttyd by argv fingerprint. `opts.useViewportFixture`
 * plants writeViewportFixtureBinary instead, for the viewport-fixture break leg only.
 * `opts.telemetry` forwards to the REAL boot only, never to the warmup boot it immediately kills,
 * matching `bootServer`'s own opt-in shape.
 */
async function standUpFixture(opts = {}) {
  const home = makeSandboxHome(`run-${process.pid}`);
  const tmuxName = `${SANDBOX_PREFIX}pane-${process.pid}`;
  const cardId = randomUUID();
  const sessionId = randomUUID();
  const hookToken = randomBytes(32).toString("hex");
  const handle = {
    home,
    tmuxName,
    cardId,
    sessionId,
    server: null,
    ttyd: null,
    pathPrefix: null,
  };

  try {
    const warmup = bootServer(home);
    await waitForReady(SANDBOX_PORT);
    await killAndWait(warmup.child);

    handle.pathPrefix = opts.useViewportFixture
      ? writeViewportFixtureBinary(home)
      : writeMouseReportFixtureBinary(home);
    console.log(
      `standup: fixture binary planted, ${join(handle.pathPrefix, "claude")}`,
    );

    await tmuxNewFixtureSession(
      tmuxName,
      home,
      join(handle.pathPrefix, "claude"),
    );
    const live = await tmuxListSessionNames();
    if (!live.includes(tmuxName)) {
      throw new Error(
        `standup: tmux session ${tmuxName} did not come up, live=${JSON.stringify(live)}`,
      );
    }
    console.log(`standup: tmux session live, ${tmuxName}`);

    const measured = await assertPaneModes(tmuxName);
    console.log(`standup: pane modes ${measured}`);

    handle.ttyd = await spawnTtyd(tmuxName, sessionId);
    await waitForPortListening(handle.ttyd.port);
    console.log(`standup: ttyd LISTENING on :${handle.ttyd.port}`);

    const now = new Date().toISOString();
    const workspacePath = join(home, "workspaces", "mobile-term-101");
    const sessionRecord = {
      id: sessionId,
      createdAt: now,
      updatedAt: now,
      tmuxSession: tmuxName,
      ttydPort: handle.ttyd.port,
      hookToken,
      workspacePath,
    };
    const card = {
      id: cardId,
      issueId: `${cardId}-issue`,
      identifier: "MTM-1",
      title: "mobile-term-101 harness fixture card",
      description: null,
      priority: 3,
      column: "in_progress",
      updatedAt: now,
      sessions: [sessionRecord],
      activeSessionId: sessionId,
      tmuxSession: sessionRecord.tmuxSession,
      ttydPort: sessionRecord.ttydPort,
      hookToken: sessionRecord.hookToken,
      workspacePath: sessionRecord.workspacePath,
    };
    seedFixtureCard(home, card);
    console.log("standup: one card, one session record seeded via node:sqlite");

    handle.server = bootServer(home, {
      pathPrefix: handle.pathPrefix,
      telemetry: opts.telemetry,
    });
    await waitForReady(SANDBOX_PORT);
    console.log(
      `standup: sandbox server ready on :${SANDBOX_PORT}, pid=${handle.server.child.pid}`,
    );

    return handle;
  } catch (err) {
    await tearDownFixture(handle).catch(() => {});
    throw err;
  }
}

/** Kill server, ttyd and tmux session explicitly, then verify each is gone, never silently
 * swallowed, a leaked sandbox resource is a reported violation. */
async function tearDownFixture(handle) {
  const problems = [];

  await killAndWait(handle.server?.child);
  if (handle.server?.child && pidAlive(handle.server.child.pid)) {
    problems.push(
      `server pid ${handle.server.child.pid} still alive after kill`,
    );
  }

  if (handle.ttyd?.child) {
    try {
      process.kill(handle.ttyd.child.pid, "SIGTERM");
    } catch {
      // already gone
    }
    const gone = await waitForPidGone(handle.ttyd.child.pid, KILL_TIMEOUT_MS);
    if (!gone) {
      try {
        process.kill(handle.ttyd.child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  if (handle.ttyd && (await isPortListening(handle.ttyd.port))) {
    problems.push(`ttyd port ${handle.ttyd.port} still LISTENING after kill`);
  }

  await execFileP("tmux", ["kill-session", "-t", `=${handle.tmuxName}:`]).catch(
    () => {},
  );
  const liveAfter = await tmuxListSessionNames();
  if (liveAfter.includes(handle.tmuxName)) {
    problems.push(
      `tmux session ${handle.tmuxName} still listed after kill-session`,
    );
  }

  if (handle.home) rmSync(handle.home, { recursive: true, force: true });

  if (problems.length > 0) {
    throw new Error(`tearDownFixture: ${problems.join("; ")}`);
  }
}

/** The telemetry adapter derives its sink from `os.homedir()`, which the sandboxed server sees as
 * `handle.home` (bootServer overrides `env.HOME`), so this is the one honest path to read a
 * fixture run's own sink from, never a guess at the real user's `~/.dispatch`. */
function telemetryPath(handle) {
  return join(handle.home, ".dispatch", "terminal-telemetry.jsonl");
}

/** Parses every non-empty line as one telemetry record, `[]` when the file is absent so callers
 * never have to special-case "flag was off" against "flag was on but produced nothing yet". */
function readTelemetryRecords(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// --check pty-shim / --break shim-markers-emptied (101.1-01, task 1): drives the REAL installed
// shim directly, no server/tmux/ttyd/Chrome. Never a copy of the shim body, see
// pty-shim-setup.ts's PTY_SHIM_SCRIPT: this section installs the real file via the real
// installPtyShim() export and pipes real child processes through it.
// ---------------------------------------------------------------------------

/** Trailing marker every shim-case script writes last, so `driveShimCase` knows the case's own
 * output is complete without racing the pty's own buffering. Never emitted by production. */
const SHIM_SENTINEL = "MTMSHIMEND";
/** The 7-byte marker PREFIX shared by both `ESC[?2026h`/`ESC[?2026l`, matching
 * pty-shim-setup.ts's own `PREFIX` constant and this task's acceptance criteria's grep pattern
 * verbatim. Counting occurrences of this alone is sufficient: a surviving full 8-byte marker
 * trivially contains it too. */
const SHIM_MARKER_PREFIX_HEX = "1b5b3f32303236";
const MARKER_OPEN = "\x1b[?2026h";
const MARKER_PREFIX = "\x1b[?2026";
const MARKER_CLOSE = "\x1b[?2026l";
const SHIM_CASE_TIMEOUT_MS = 5_000;

const WHOLE_PAYLOAD = "WHOLE-PAYLOAD-0123456789-ABCDEFGHIJKLMNOP";
const SPLIT_PAYLOAD = "SPLIT-PAYLOAD-9876543210-ZYXWVUTSRQPONML";
/** Deliberately contains a non-2026 DECSET sharing `ESC[?2026`'s first six bytes
 * (`ESC[?2027h`), a literal `?2026` with no escape introducer, an unrelated SGR sequence, and
 * the multi-byte UTF-8 `⏺`, all of which must survive the shim untouched: that is the only way
 * this shim could otherwise silently corrupt a real session. */
const PASSTHROUGH_PAYLOAD = "\x1b[?2027hSTART\x1b[31mCOLOR?2026DECOYEND⏺";

/** One shell script per case, run via `sh -c` as the shim's OWN wrapped child so its escape
 * bytes reach the pty exactly as a real pane would emit them. `split` writes the 7-byte PREFIX
 * alone, sleeps past one full select() cycle, then completes the marker in a second write, which
 * exercises the `pending` holdback path pty-shim-setup.ts's PTY_SHIM_SCRIPT implements for a
 * marker split across two reads. */
const SHIM_CASES = {
  whole: {
    payload: WHOLE_PAYLOAD,
    script: () =>
      `printf '${MARKER_OPEN}${WHOLE_PAYLOAD}${MARKER_CLOSE}${SHIM_SENTINEL}'`,
  },
  split: {
    payload: SPLIT_PAYLOAD,
    script: () =>
      `printf '${MARKER_PREFIX}'; sleep 0.2; printf 'h${SPLIT_PAYLOAD}${MARKER_CLOSE}${SHIM_SENTINEL}'`,
  },
  passthrough: {
    payload: PASSTHROUGH_PAYLOAD,
    script: () => `printf '${PASSTHROUGH_PAYLOAD}${SHIM_SENTINEL}'`,
  },
};

function countMarkerOccurrences(buf) {
  const hex = buf.toString("hex");
  let count = 0;
  let idx = hex.indexOf(SHIM_MARKER_PREFIX_HEX);
  while (idx !== -1) {
    count++;
    idx = hex.indexOf(
      SHIM_MARKER_PREFIX_HEX,
      idx + SHIM_MARKER_PREFIX_HEX.length,
    );
  }
  return count;
}

/** Byte-exact compare reporting the first differing offset plus a short hex window around it,
 * never a bare "mismatch": an unactionable message at 3am is as good as none. */
function bytesEqualDetail(actual, expected) {
  const len = Math.min(actual.length, expected.length);
  for (let i = 0; i < len; i++) {
    if (actual[i] !== expected[i]) {
      return {
        equal: false,
        offset: i,
        actualWindow: actual.slice(Math.max(0, i - 8), i + 8).toString("hex"),
        expectedWindow: expected
          .slice(Math.max(0, i - 8), i + 8)
          .toString("hex"),
      };
    }
  }
  if (actual.length !== expected.length) {
    return {
      equal: false,
      offset: len,
      actualWindow: actual.slice(Math.max(0, len - 8)).toString("hex"),
      expectedWindow: expected.slice(Math.max(0, len - 8)).toString("hex"),
    };
  }
  return { equal: true };
}

/** Runs the real installer against a sandbox `HOME`, via the compiled `dist/` module, never a
 * copy of `PTY_SHIM_SCRIPT` pasted into this harness. */
async function installShimForCheck(home) {
  const distFile = realpathSync(
    join(REPO_ROOT, "dist", "server", "bootstrap", "pty-shim-setup.js"),
  );
  const fileUrl = pathToFileURL(distFile).href;
  await execFileP(
    "node",
    [
      "-e",
      `import(${JSON.stringify(fileUrl)}).then((m) => m.installPtyShim())`,
    ],
    { env: { ...process.env, HOME: home } },
  );
}

/** Spawns `<shimPath> sh -c <script>` with stdin left open, never closed: the shim `select()`s
 * on fd 0 and breaks its loop on EOF, so a closed/`/dev/null` stdin would race the child's own
 * output and truncate the very stream this case measures. Collects stdout until the trailing
 * `SHIM_SENTINEL` appears, then kills the child and verifies it is gone. */
async function driveShimCase(shimPath, caseName, script) {
  const child = spawn(shimPath, ["sh", "-c", script], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = Buffer.alloc(0);
  let stderrText = "";
  child.stdout.on("data", (d) => {
    out = Buffer.concat([out, d]);
  });
  child.stderr.on("data", (d) => {
    stderrText += d.toString();
  });
  const deadline = Date.now() + SHIM_CASE_TIMEOUT_MS;
  while (!out.includes(SHIM_SENTINEL)) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(
        `pty-shim[${caseName}]: sentinel "${SHIM_SENTINEL}" not observed within ${SHIM_CASE_TIMEOUT_MS}ms; stderr=${stderrText}`,
      );
    }
    await sleep(20);
  }
  await sleep(50);
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {
    // already gone
  }
  const gone = await waitForPidGone(child.pid, KILL_TIMEOUT_MS);
  if (!gone) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // already gone
    }
    if (pidAlive(child.pid)) {
      throw new Error(
        `pty-shim[${caseName}]: shim child pid ${child.pid} still alive after SIGKILL`,
      );
    }
  }
  return out;
}

/** The one product-correctness assertion for a shim case, unconditionally: zero marker byte
 * sequences reach stdout, and the sentinel-stripped remainder is byte-identical to PAYLOAD.
 * Shared verbatim by `--check pty-shim` (run against the real installed shim) and `--break
 * shim-markers-emptied` (run against a patched copy), so the break proves something about the
 * exact assertion the check runs, never a re-implementation. */
async function runShimCase(violations, shimPath, caseName) {
  const { payload, script } = SHIM_CASES[caseName];
  const out = await driveShimCase(shimPath, caseName, script());
  const markerCount = countMarkerOccurrences(out);
  if (markerCount !== 0) {
    violations.push(
      `pty-shim[${caseName}]: expected 0 marker byte sequences (${SHIM_MARKER_PREFIX_HEX}) in output, found ${markerCount}`,
    );
  } else {
    console.log(
      `pty-shim[${caseName}]: marker byte sequences (${SHIM_MARKER_PREFIX_HEX}) found 0`,
    );
  }
  const expected = Buffer.concat([
    Buffer.from(payload, "utf8"),
    Buffer.from(SHIM_SENTINEL, "utf8"),
  ]);
  const cmp = bytesEqualDetail(out, expected);
  if (!cmp.equal) {
    violations.push(
      `pty-shim[${caseName}]: byte mismatch at offset ${cmp.offset}, actual=${cmp.actualWindow} expected=${cmp.expectedWindow}`,
    );
  } else {
    console.log(
      `pty-shim[${caseName}]: payload byte-identical after strip (${expected.length} bytes)`,
    );
  }
}

async function checkPtyShim(violations) {
  const home = makeSandboxHome("pty-shim");
  try {
    await installShimForCheck(home);
    const shimPath = join(home, DISPATCH_DIR_NAME, "pty-shim.py");
    if (!existsSync(shimPath)) {
      violations.push(
        `pty-shim: expected ${shimPath} to exist after installPtyShim(), python3 was unavailable ` +
          `(installPtyShim's own run-probe failed and it removes the file on any probe failure)`,
      );
      return;
    }
    const st = statSync(shimPath);
    if ((st.mode & 0o111) === 0) {
      violations.push(
        `pty-shim: ${shimPath} exists but is not executable (mode ${(st.mode & 0o777).toString(8)})`,
      );
      return;
    }
    console.log(`pty-shim: real shim installed at ${shimPath}`);
    for (const caseName of ["whole", "split", "passthrough"]) {
      await runShimCase(violations, shimPath, caseName);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** Patches a COPY of the real installed shim (never the harness's own understanding of it) so
 * its `MARKERS` tuple strips nothing, asserts the patch actually changed the file, then reruns
 * the SAME `runShimCase` assertion the check uses: `whole`/`split` must trip, `passthrough` must
 * stay green, proving the break targets the strip and not the pipe. */
async function breakShimMarkersEmptied(violations) {
  const home = makeSandboxHome("pty-shim-break");
  try {
    await installShimForCheck(home);
    const shimPath = join(home, DISPATCH_DIR_NAME, "pty-shim.py");
    if (!existsSync(shimPath)) {
      violations.push(
        `shim-markers-emptied: prerequisite failed, ${shimPath} missing after installPtyShim()`,
      );
      return;
    }
    const original = readFileSync(shimPath, "utf8");
    const needle = "MARKERS = (b'\\x1b[?2026h', b'\\x1b[?2026l')";
    if (!original.includes(needle)) {
      violations.push(
        `shim-markers-emptied: expected literal "${needle}" in the installed shim, not found, cannot mutate`,
      );
      return;
    }
    const patched = original.replace(needle, "MARKERS = ()");
    if (patched.length === original.length) {
      violations.push(
        `shim-markers-emptied: MARKERS line replacement left the file length unchanged ` +
          `(${original.length} bytes before and after), the mutation is a no-op`,
      );
      return;
    }
    const patchedPath = join(home, "pty-shim-patched.py");
    writeFileSync(patchedPath, patched, { mode: 0o755 });
    console.log(
      `shim-markers-emptied: patched copy ${patchedPath}, ${original.length} -> ${patched.length} bytes`,
    );

    await runShimCase(violations, patchedPath, "whole");
    await runShimCase(violations, patchedPath, "split");
    await runShimCase(violations, patchedPath, "passthrough");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Touch emulation, WS frame decode and the three activation self-proofs.
// ---------------------------------------------------------------------------

/** ttyd's wire protocol is binary-only, every webSocketFrameSent/Received event's payloadData
 * arrives base64-encoded. "0" on a sent frame is INPUT, "0" on a received frame is OUTPUT, "1" sent
 * is RESIZE, "1" received is TITLE (terminal-main.ts:12-13, :240-249). */
function decodeTtydOp(payloadDataBase64) {
  return String.fromCharCode(Buffer.from(payloadDataBase64, "base64")[0]);
}

/** One touchStart, `steps` touchMove events at even dy/steps intervals with a real sleep(cadenceMs)
 * between each, then an immediate touchEnd with an empty touchPoints array. The per-move delta stays
 * constant through the final move on purpose: a flick that decelerates into release correctly fails
 * KINETIC.releaseWindowMs/minVelocity and never runs momentum, which would silently halve what proof
 * C measures. */
async function flick(cdp, sessionId, { x, y, dy, steps, cadenceMs }) {
  await cdp.send(
    "Input.dispatchTouchEvent",
    { type: "touchStart", touchPoints: [{ x, y, id: 0 }] },
    sessionId,
  );
  for (let i = 1; i <= steps; i++) {
    await cdp.send(
      "Input.dispatchTouchEvent",
      {
        type: "touchMove",
        touchPoints: [{ x, y: y + (dy / steps) * i, id: 0 }],
      },
      sessionId,
    );
    await sleep(cadenceMs);
  }
  await cdp.send(
    "Input.dispatchTouchEvent",
    { type: "touchEnd", touchPoints: [] },
    sessionId,
  );
}

/**
 * Harness-injected page script, zero additions to src/, installed AFTER main() has already run so
 * attachKineticScroll's own capture-phase document listener is already registered.
 * @remarks A bubble-phase probe cannot see this signal: attachKineticScroll's touchmove listener
 * calls e.stopPropagation() on document in the CAPTURE phase, the instant slopPx clears, which halts
 * the event before it ever reaches the target and therefore before it ever bubbles back up to a
 * bubble-phase listener on the same node, live-confirmed by this harness's own first run measuring
 * moves:0 despite 25 real INPUT frames landing on the wire. Same-node listeners in the SAME phase
 * still fire in registration order regardless of an earlier one calling stopPropagation() (only
 * stopImmediatePropagation prevents that), so registering this probe capture-phase on document,
 * strictly after production's own listener, observes e.defaultPrevented correctly: production's
 * listener runs first and may set it, this listener runs second on the same node and reads it.
 */
const KINETIC_PROBE_SRC = `
  window.__kineticProbe = { moves: 0, defaultPrevented: false, cancelable: false };
  document.addEventListener(
    "touchmove",
    function (e) {
      window.__kineticProbe.moves += 1;
      window.__kineticProbe.cancelable = e.cancelable;
      if (e.defaultPrevented) window.__kineticProbe.defaultPrevented = true;
    },
    { capture: true, passive: true },
  );
`;

/** Polls document.readyState and document.URL until the page has both reached "complete" and
 * settled on `expectedUrl` exactly, guarding against a stale "complete" read from the about:blank
 * target's own initial document racing a just-issued Page.navigate. */
/**
 * `opts.retryNavUrl`, tunnel-mode callers only: live-confirmed real gotcha, not a hypothetical, a
 * freshly-minted `*.trycloudflare.com` subdomain can be reported `on` by cloudflared's own stderr
 * before Chrome's resolver can reliably route to it, which manifests as the FIRST navigation
 * landing on `chrome-error://chromewebdata/` (`net::ERR_NAME_NOT_RESOLVED`), a transient condition
 * that a fresh re-`Page.navigate` to the same URL clears within a poll cycle or two, live-confirmed
 * against a real tunnel. Loopback callers never pass this, so they keep the original fast-fail
 * behavior (a loopback `chrome-error://` would be a genuine bug, never expected to self-clear).
 */
async function waitForPageComplete(cdp, sessionId, expectedUrl, opts = {}) {
  const {
    timeoutMs = READY_TIMEOUT_MS,
    retryNavUrl = null,
    maxRetries = 8,
  } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let lastUrl = null;
  let retries = 0;
  while (Date.now() < deadline) {
    const state = await evalValue(cdp, sessionId, "document.readyState");
    const url = await evalValue(cdp, sessionId, "document.URL");
    if (state !== lastState || url !== lastUrl) {
      if (process.env.MT101_DEBUG) {
        console.error(`DEBUG waitForPageComplete: state=${state} url=${url}`);
      }
      lastState = state;
      lastUrl = url;
    }
    if (state === "complete" && url === expectedUrl) return url;
    if (
      retryNavUrl &&
      state === "complete" &&
      typeof url === "string" &&
      url.startsWith("chrome-error://") &&
      retries < maxRetries
    ) {
      retries++;
      if (process.env.MT101_DEBUG) {
        console.error(
          `DEBUG waitForPageComplete: retry ${retries}/${maxRetries} re-navigating past chrome-error`,
        );
      }
      await sleep(1000);
      await cdp.send("Page.navigate", { url: retryNavUrl }, sessionId);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `page did not reach readyState "complete" at ${expectedUrl} within ${timeoutMs}ms (last observed state=${lastState} url=${lastUrl})`,
  );
}

/**
 * Stands up the real tmux/ttyd fixture, drives a real headless Chrome through CDP straight to
 * /sessions/<id>/terminal/ (Target.createTarget direct navigation, no iframe boundary, so
 * connect()'s own WebSocket and this Network domain observation share one realm with no
 * Target.setAutoAttach plumbing), applies mobile device/touch emulation, and runs the three
 * activation self-proofs. `opts.skipTouchEmulation`, `opts.subSlopFlick` and `opts.wrongPage` are
 * the three break legs, each disabling exactly one thing the real flow does.
 */
async function runActivationFlow(violations, opts = {}) {
  const handle = await standUpFixture({});
  let chromeChild = null;
  let cdp = null;
  const userDataDir = join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`);
  try {
    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    await waitForCdpUp();
    cdp = await connectCDP();

    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);

    const wsFrames = [];
    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Network.webSocketFrameSent") {
        wsFrames.push({
          dir: "sent",
          payloadData: msg.params.response.payloadData,
        });
      } else if (msg.method === "Network.webSocketFrameReceived") {
        wsFrames.push({
          dir: "recv",
          payloadData: msg.params.response.payloadData,
        });
      }
    });

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
      sessionId,
    );
    if (!opts.skipTouchEmulation) {
      await cdp.send(
        "Emulation.setTouchEmulationEnabled",
        { enabled: true, configuration: "mobile" },
        sessionId,
      );
    }

    const targetUrl = opts.wrongPage
      ? `http://127.0.0.1:${SANDBOX_PORT}/`
      : `http://127.0.0.1:${SANDBOX_PORT}/sessions/${handle.sessionId}/terminal/`;
    await cdp.send("Page.navigate", { url: targetUrl }, sessionId);
    await waitForPageComplete(cdp, sessionId, targetUrl);
    await sleep(2500);

    // Proof A: coarse pointer. Immediately after emulation setup, before the first touch dispatch.
    // RESEARCH Assumption A1, resolved live by this run: if false, main() never called
    // attachKineticScroll and every later number in this phase would measure dead listeners.
    const coarse = await evalValue(
      cdp,
      sessionId,
      "window.matchMedia('(pointer: coarse)').matches",
    );
    if (coarse !== true) {
      violations.push(
        `activation: (pointer: coarse) expected true, measured ${coarse}`,
      );
    } else {
      console.log(`activation: (pointer: coarse) measured ${coarse}`);
    }

    // Proof B's probe must be installed before the flick.
    await cdp.send(
      "Runtime.evaluate",
      { expression: KINETIC_PROBE_SRC, awaitPromise: false },
      sessionId,
    );

    const flickDy = opts.subSlopFlick ? 4 : 300;
    const flickSteps = opts.subSlopFlick ? 4 : 28;
    await flick(cdp, sessionId, {
      x: 195,
      y: 400,
      dy: flickDy,
      steps: flickSteps,
      cadenceMs: 12,
    });
    await sleep(1500);

    // Proof B: kinetic engagement.
    const probe = await evalValue(cdp, sessionId, "window.__kineticProbe");
    if (!probe || probe.defaultPrevented !== true) {
      violations.push(
        `activation: kinetic engagement expected defaultPrevented true, measured ${probe ? probe.defaultPrevented : false}`,
      );
    } else {
      console.log(`activation: kineticProbe measured ${JSON.stringify(probe)}`);
    }

    // Proof C: the flick reached the wire. A zero here with A and B green means scrollMode()
    // returned something other than "report", which the standup check's own "1 1" precondition
    // should already have excluded, so that combination is reported as a fixture fault.
    const sentInput = wsFrames.filter(
      (f) => f.dir === "sent" && decodeTtydOp(f.payloadData) === "0",
    ).length;
    if (sentInput < 1) {
      violations.push(
        `activation: sent INPUT frames expected >= 1, measured ${sentInput} (navigated ${targetUrl})`,
      );
    } else {
      console.log(`activation: sent INPUT frames measured ${sentInput}`);
    }
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    rmSync(userDataDir, { recursive: true, force: true });
    await tearDownFixture(handle);
  }
}

async function checkActivation(violations) {
  await runActivationFlow(violations, {});
}

/** Skips the Emulation.setTouchEmulationEnabled call only. Proof A must fire. */
async function breakNoTouchEmulation(violations) {
  await runActivationFlow(violations, { skipTouchEmulation: true });
}

/** Runs the flick with a total dy of 4px, under KINETIC.slopPx: 8. Proof B must fire while proof A
 * still passes, which is what makes B independent of A. */
async function breakSubSlopFlick(violations) {
  await runActivationFlow(violations, { subSlopFlick: true });
}

/** Navigates to the board root instead of the terminal URL. Proof C must fire, naming the URL
 * actually loaded so a future run cannot mistake "navigated somewhere else" for "product emits no
 * frames". */
async function breakWrongPage(violations) {
  await runActivationFlow(violations, { wrongPage: true });
}

// ---------------------------------------------------------------------------
// Round-trips and flick-distance: turning the proven-live gesture into numbers
// (101-02). One canonical flick, deliberately shared by both checks so a "400px
// flick" means the same thing everywhere in this file's output.
// ---------------------------------------------------------------------------

const CANONICAL_FLICK = { x: 195, y: 600, dy: -400, steps: 25, cadenceMs: 12 };
const RT_RUNS = 5;
const FD_RUNS = 5;
const QUIET_MS = 250;
const SETTLE_POLL_MS = 50;
const SETTLE_MAX_WAIT_MS = 4000;

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeMetric(runs, key) {
  const vals = runs
    .map((r) => r[key])
    .filter((v) => v !== null && v !== undefined);
  if (vals.length === 0) return { median: null, min: null, max: null };
  return {
    median: median(vals),
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

/**
 * Long Animation Frames observer plus a self-rescheduling requestAnimationFrame dropped-frame
 * sampler, installed together right before touch dispatch (RESEARCH's injection pattern,
 * `buffered: true` so an in-flight frame at install time is not missed). `--break loaf-blind`
 * installs `RAF_ONLY_PROBE_SRC` instead, deliberately omitting the PerformanceObserver half so the
 * check can prove it notices a genuinely absent instrument rather than silently reporting
 * maxBlockingMs: 0.
 */
const LOAF_RAF_PROBE_SRC = `
  window.__loafEntries = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__loafEntries.push({
        startTime: e.startTime,
        duration: e.duration,
        blockingDuration: e.blockingDuration,
        renderStart: e.renderStart,
        scripts: e.scripts.map((s) => ({ name: s.name, duration: s.duration })),
      });
    }
  }).observe({ type: "long-animation-frame", buffered: true });
  window.__rafIntervals = [];
  (function tick(prev) {
    requestAnimationFrame(function (now) {
      if (prev !== undefined) window.__rafIntervals.push(now - prev);
      tick(now);
    });
  })(undefined);
`;
const RAF_ONLY_PROBE_SRC = `
  window.__rafIntervals = [];
  (function tick(prev) {
    requestAnimationFrame(function (now) {
      if (prev !== undefined) window.__rafIntervals.push(now - prev);
      tick(now);
    });
  })(undefined);
`;

/**
 * One round-trips run: a fresh page per run (distinct URL each time, avoiding
 * `waitForPageComplete`'s same-URL race, the same trap plan 01 documented for `Page.navigate`), the
 * coarse-pointer and kinetic-engagement proofs re-asserted per run since each fresh page re-runs
 * `main()`, then the five numbers windowed from the touch-dispatch instant to quiescence.
 * @remarks `settleMs` is deliberately NOT wall-clock-since-touchend: it is the gap between the
 * LAST INPUT frame and the LAST OUTPUT frame, so it cannot be conflated with `runMomentum`'s local,
 * network-independent decay (RESEARCH's own Pitfall on this exact naive-measurement trap).
 */
async function measureOneRoundTrip(
  cdp,
  sessionId,
  wsFrames,
  targetUrl,
  runIndex,
  opts,
) {
  const url = `${targetUrl}?rt=${runIndex}`;
  wsFrames.length = 0;
  await cdp.send("Page.navigate", { url }, sessionId);
  await waitForPageComplete(cdp, sessionId, url);
  await sleep(2500);

  const coarse = await evalValue(
    cdp,
    sessionId,
    "window.matchMedia('(pointer: coarse)').matches",
  );

  await cdp.send(
    "Runtime.evaluate",
    { expression: KINETIC_PROBE_SRC, awaitPromise: false },
    sessionId,
  );

  const probeSrc = opts.skipLoaf ? RAF_ONLY_PROBE_SRC : LOAF_RAF_PROBE_SRC;
  await cdp.send(
    "Runtime.evaluate",
    { expression: probeSrc, awaitPromise: false },
    sessionId,
  );

  const touchStartPerfMs = await evalValue(cdp, sessionId, "performance.now()");
  const touchStartWallMs = Date.now();
  await flick(cdp, sessionId, CANONICAL_FLICK);

  const deadline = Date.now() + SETTLE_MAX_WAIT_MS;
  let lastActivityMs = Date.now();
  let prevLen = wsFrames.length;
  while (Date.now() < deadline) {
    await sleep(SETTLE_POLL_MS);
    if (wsFrames.length !== prevLen) {
      prevLen = wsFrames.length;
      lastActivityMs = Date.now();
    }
    if (Date.now() - lastActivityMs >= QUIET_MS) break;
  }

  const kineticProbe = await evalValue(cdp, sessionId, "window.__kineticProbe");

  const inputFrames = wsFrames.filter(
    (f) =>
      f.dir === "sent" &&
      f.wallMs >= touchStartWallMs &&
      decodeTtydOp(f.payloadData) === "0",
  );
  const outputFrames = wsFrames.filter(
    (f) =>
      f.dir === "recv" &&
      f.wallMs >= touchStartWallMs &&
      decodeTtydOp(f.payloadData) === "0",
  );
  const lastInputMs =
    inputFrames.length > 0
      ? Math.max(...inputFrames.map((f) => f.wallMs))
      : null;
  const lastOutputMs =
    outputFrames.length > 0
      ? Math.max(...outputFrames.map((f) => f.wallMs))
      : null;
  const settleMs =
    lastInputMs !== null && lastOutputMs !== null
      ? lastOutputMs - lastInputMs
      : null;

  const loafEntriesRaw = await evalValue(
    cdp,
    sessionId,
    "window.__loafEntries",
  );
  const loafAbsent = loafEntriesRaw === undefined;
  let maxBlockingMs = 0;
  let blockingScript = null;
  if (!loafAbsent) {
    for (const entry of loafEntriesRaw) {
      if (entry.startTime < touchStartPerfMs) continue;
      if (entry.blockingDuration > maxBlockingMs) {
        maxBlockingMs = entry.blockingDuration;
        blockingScript = entry.scripts?.[0]?.name ?? null;
      }
    }
  }

  const rafIntervals =
    (await evalValue(cdp, sessionId, "window.__rafIntervals")) ?? [];
  const droppedFrames = rafIntervals.filter((iv) => iv > 1.5 * 16.7).length;

  return {
    run: runIndex,
    coarse,
    kineticProbe,
    inputFrames: inputFrames.length,
    outputFrames: outputFrames.length,
    settleMs,
    maxBlockingMs,
    blockingScript,
    droppedFrames,
    loafAbsent,
  };
}

/**
 * Stands up the real fixture, opens one CDP target for the whole leg, and runs `opts.runs ??
 * RT_RUNS` fresh-page round-trip measurements against it. `opts.skipTouchEmulation` is the
 * `dead-listener` break's own vehicle, reused from the activation proofs per the plan's own
 * instruction: with touch emulation off, `attachKineticScroll` never attaches, so `inputFrames` is
 * driven to zero and the plausible-floor check below is proven able to fire. `opts.skipLoaf` is the
 * `loaf-blind` break's vehicle. `opts.telemetry` forwards to the REAL boot only (`standUpFixture`'s
 * own contract), the 101-04 vehicle both `--check telemetry-off` and `--break telemetry-flag-ignored`
 * share. `opts.afterRuns`, when given, is awaited with `handle` once every run has completed and
 * BEFORE `tearDownFixture` deletes `handle.home`, the only point at which a caller can still read
 * a file the sandboxed server wrote under that home.
 */
async function runRoundTripsFlow(violations, opts = {}) {
  if (opts.tunnel) await assertCloudflaredOnPath();
  const handle = await standUpFixture({ telemetry: opts.telemetry });
  let chromeChild = null;
  let cdp = null;
  let tunnelEnabled = false;
  const userDataDir = join(
    tmpdir(),
    `${SANDBOX_PREFIX}chrome-rt-${process.pid}`,
  );
  const runs = [];
  try {
    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    await waitForCdpUp();
    cdp = await connectCDP();

    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);

    const wsFrames = [];
    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Network.webSocketFrameSent") {
        wsFrames.push({
          dir: "sent",
          payloadData: msg.params.response.payloadData,
          wallMs: Date.now(),
        });
      } else if (msg.method === "Network.webSocketFrameReceived") {
        wsFrames.push({
          dir: "recv",
          payloadData: msg.params.response.payloadData,
          wallMs: Date.now(),
        });
      }
    });

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
      sessionId,
    );
    if (!opts.skipTouchEmulation) {
      await cdp.send(
        "Emulation.setTouchEmulationEnabled",
        { enabled: true, configuration: "mobile" },
        sessionId,
      );
    }

    let targetUrl;
    if (opts.tunnel) {
      const state = await enableTunnelViaLoopback();
      tunnelEnabled = true;
      registerTunnelSecrets(state);
      console.log(`tunnel: up at ${redactTunnelHost(state.url)}`);
      targetUrl = await authenticateOverTunnel(
        cdp,
        sessionId,
        state,
        `/sessions/${handle.sessionId}/terminal/`,
      );
    } else {
      targetUrl = `http://127.0.0.1:${SANDBOX_PORT}/sessions/${handle.sessionId}/terminal/`;
    }
    const runCount = opts.runs ?? RT_RUNS;

    for (let i = 0; i < runCount; i++) {
      const result = await measureOneRoundTrip(
        cdp,
        sessionId,
        wsFrames,
        targetUrl,
        i,
        opts,
      );
      const expectedCoarse = !opts.skipTouchEmulation;
      if (result.coarse !== expectedCoarse) {
        violations.push(
          `round-trips[run ${i}]: (pointer: coarse) expected ${expectedCoarse}, measured ${result.coarse}`,
        );
      }
      if (!opts.skipTouchEmulation) {
        if (
          !result.kineticProbe ||
          result.kineticProbe.defaultPrevented !== true
        ) {
          violations.push(
            `round-trips[run ${i}]: kinetic engagement expected defaultPrevented true, measured ${result.kineticProbe ? result.kineticProbe.defaultPrevented : false}`,
          );
        }
      }
      runs.push(result);
    }

    if (opts.skipLoaf) {
      const allAbsent = runs.every((r) => r.loafAbsent);
      if (allAbsent) {
        violations.push(
          "round-trips: window.__loafEntries absent, LoAF observer never installed",
        );
      }
    }

    const inputFramesMedian = summarizeMetric(runs, "inputFrames").median;
    if (inputFramesMedian < 10) {
      violations.push(
        `round-trips: inputFrames median ${inputFramesMedian} below the plausible floor for a 400px flick, suspect the fixture, not the product`,
      );
    }

    if (opts.afterRuns) await opts.afterRuns(handle);

    return { runs, inputFramesMedian };
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    rmSync(userDataDir, { recursive: true, force: true });
    if (tunnelEnabled) {
      try {
        await disableTunnelViaLoopback();
      } catch (err) {
        violations.push(err instanceof Error ? err.message : String(err));
      }
    }
    await tearDownFixture(handle);
    if (tunnelEnabled) {
      try {
        await assertNoStrayCloudflared();
      } catch (err) {
        violations.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
}

function printRoundTripsSummary(runs, label = null) {
  const prefix = label ? `round-trips[${label}]` : "round-trips";
  for (const key of [
    "inputFrames",
    "outputFrames",
    "settleMs",
    "maxBlockingMs",
    "droppedFrames",
  ]) {
    const { median: m, min, max } = summarizeMetric(runs, key);
    console.log(
      `${prefix}: ${key} median=${m} min=${min} max=${max} (runs=${runs.length})`,
    );
  }
  console.log(`${prefix}: settle quiet window QUIET_MS=${QUIET_MS}`);
  const topRun = runs.reduce(
    (best, r) => (r.maxBlockingMs > (best?.maxBlockingMs ?? -1) ? r : best),
    null,
  );
  if (topRun?.blockingScript) {
    console.log(
      `${prefix}: top blocking script ${topRun.blockingScript} (run ${topRun.run})`,
    );
  }
}

/** setNoDelay is untested by either leg of this instrument (neither `upgradeForward` leg calls it,
 * `terminal-proxy.ts:117-141`, confirmed by direct read), printed unconditionally so it is never
 * silently folded into "network latency" in the findings, loopback or tunnel. */
function printSetNoDelayOpenVariable() {
  console.log(
    "round-trips: setNoDelay NOT RULED OUT, upgradeForward sets it on neither leg (terminal-proxy.ts:117-141), untested by this instrument",
  );
}

/**
 * `--tunnel` runs the SAME 5-run measurement twice in one invocation, loopback then tunnel, so the
 * comparison line below is never built from a stale/remembered number, every value it prints was
 * just measured in this run. `inputFrames` is a property of the client's tick emission and should
 * be approximately equal on both paths; a material difference means the gesture itself behaved
 * differently and the tunnel `settleMs` is not comparable, so that case is called out explicitly
 * rather than silently printed alongside a normal delta.
 */
async function checkRoundTrips(violations, cliOpts = {}) {
  if (!cliOpts.tunnel) {
    const { runs } = await runRoundTripsFlow(violations, {});
    printRoundTripsSummary(runs);
    printSetNoDelayOpenVariable();
    if (cliOpts.jsonPath) {
      writeFileSync(cliOpts.jsonPath, JSON.stringify({ runs }, null, 2) + "\n");
      console.log(`round-trips: wrote readings to ${cliOpts.jsonPath}`);
    }
    return;
  }

  console.log(
    "round-trips: loopback pass (baseline for the tunnel comparison)",
  );
  const { runs: loopbackRuns } = await runRoundTripsFlow(violations, {});
  printRoundTripsSummary(loopbackRuns, "loopback");

  console.log("round-trips: tunnel pass");
  const { runs: tunnelRuns } = await runRoundTripsFlow(violations, {
    tunnel: true,
  });
  printRoundTripsSummary(tunnelRuns, "tunnel");

  const lbInput = summarizeMetric(loopbackRuns, "inputFrames").median;
  const tnInput = summarizeMetric(tunnelRuns, "inputFrames").median;
  const lbSettle = summarizeMetric(loopbackRuns, "settleMs").median;
  const tnSettle = summarizeMetric(tunnelRuns, "settleMs").median;
  console.log(
    `round-trips: loopback vs tunnel inputFrames ${lbInput} vs ${tnInput}, settleMs ${lbSettle} vs ${tnSettle}`,
  );
  if (lbInput > 0 && Math.abs(tnInput - lbInput) / lbInput > 0.2) {
    console.log(
      `round-trips: inputFrames differs materially between loopback (${lbInput}) and tunnel (${tnInput}), the gesture itself behaved differently on the tunnel path, so tunnel settleMs is NOT directly comparable to loopback settleMs`,
    );
  }
  printSetNoDelayOpenVariable();

  if (cliOpts.jsonPath) {
    writeFileSync(
      cliOpts.jsonPath,
      JSON.stringify({ loopbackRuns, tunnelRuns }, null, 2) + "\n",
    );
    console.log(`round-trips: wrote readings to ${cliOpts.jsonPath}`);
  }
}

/**
 * THRESHOLD comparator for the jittery round-trip/latency legs, never zero-tolerance, unlike
 * `compareFlickReadings`'s geometry check (a separate function, task 2): `bounds.maxInputFrameRatio`
 * bounds `after.inputFramesMedian / before.inputFramesMedian`, `bounds.maxSettleMs` and
 * `bounds.maxBlockingMs` bound the AFTER reading's own median values directly. Reports a violation
 * only when a bound is exceeded, never on exact inequality, round trips, blockingDuration and settle
 * latency all have real run-to-run jitter (RESEARCH's own "median plus spread" instruction).
 */
function compareLatencyReadings(before, after, bounds) {
  const violations = [];
  if (bounds.maxInputFrameRatio !== undefined && before.inputFramesMedian > 0) {
    const ratio = after.inputFramesMedian / before.inputFramesMedian;
    if (ratio > bounds.maxInputFrameRatio) {
      violations.push(
        `round-trips.inputFrameRatio: expected <= ${bounds.maxInputFrameRatio}, got ${ratio.toFixed(3)} (before=${before.inputFramesMedian}, after=${after.inputFramesMedian})`,
      );
    }
  }
  if (
    bounds.maxSettleMs !== undefined &&
    after.settleMsMedian !== null &&
    after.settleMsMedian > bounds.maxSettleMs
  ) {
    violations.push(
      `round-trips.settleMs: expected <= ${bounds.maxSettleMs}, got ${after.settleMsMedian}`,
    );
  }
  if (
    bounds.maxBlockingMs !== undefined &&
    after.maxBlockingMsMedian !== null &&
    after.maxBlockingMsMedian > bounds.maxBlockingMs
  ) {
    violations.push(
      `round-trips.maxBlockingMs: expected <= ${bounds.maxBlockingMs}, got ${after.maxBlockingMsMedian}`,
    );
  }
  return violations;
}

/**
 * The real proof behind `--check telemetry-off`: read the shipped `terminal-proxy.ts` from disk,
 * strip comment lines, and assert `telemetryOn`/`armFlickTelemetry` together appear exactly twice
 * (the import and the one call) with the call itself matching 101-04's exact guarded line. A build
 * in which telemetry could run unguarded fails here regardless of what any timing number says.
 * Shared by `--check telemetry-off` and `--break telemetry-flag-ignored` so a run of either always
 * prints the same structural evidence line, independent of the runtime (file-presence) assertion.
 */
const GUARDED_CALL_LINE =
  "    if (telemetryOn) armFlickTelemetry(clientSocket, upstream);";

function assertGuardedCallSite(violations) {
  const proxySrc = readFileSync(
    join(REPO_ROOT, "src/server/adapters/terminal-proxy.ts"),
    "utf8",
  );
  const refCount = proxySrc
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => /telemetryOn|armFlickTelemetry/.test(line)).length;
  const hasGuardLine = proxySrc.includes(GUARDED_CALL_LINE);
  if (refCount !== 2 || !hasGuardLine) {
    violations.push(
      `telemetry-off: expected exactly one guarded call site (2 references, guard line present), found ${refCount} reference(s), guard line present=${hasGuardLine}`,
    );
    return;
  }
  console.log(
    `telemetry-off: guarded call site matched: ${GUARDED_CALL_LINE.trim()}`,
  );
}

/**
 * Runs the file-presence half of `--check telemetry-off` / `--break telemetry-flag-ignored`: rides
 * `runRoundTripsFlow`'s own `afterRuns` hook so the check happens while `handle.home` still exists,
 * BEFORE `tearDownFixture` deletes it. `sleep`s past `BURST_GAP_MS` (300) plus margin first so an
 * armed recorder's own close timer has definitely fired and flushed before the file is read.
 */
async function assertTelemetryFileAbsence(violations, handle) {
  await sleep(500);
  const p = telemetryPath(handle);
  if (existsSync(p)) {
    const records = readTelemetryRecords(p);
    violations.push(
      `telemetry-off: expected no telemetry file, found ${p} with ${records.length} record(s)`,
    );
    return;
  }
  console.log(`telemetry-off: no telemetry file at ${p}`);
}

/**
 * Pre-telemetry loopback medians transcribed from the dated FINDINGS `## Measured numbers` table,
 * the baseline the timing leg below compares against via `compareLatencyReadings`'s THRESHOLD
 * comparator, never a zero-tolerance one.
 */
const PRE_TELEMETRY_LOOPBACK = {
  inputFramesMedian: 29,
  settleMsMedian: 1,
  maxBlockingMsMedian: 0,
};
const TELEMETRY_OFF_TIMING_BOUNDS = {
  maxInputFrameRatio: 1.5,
  maxSettleMs: 50,
  maxBlockingMs: 20,
};

/**
 * With the flag unset, asserts the guarded call site is the sole reachable path (the proof), that
 * one full canonical flick produces no telemetry file (the runtime half of that same proof), and
 * runs the existing round-trips timing leg as corroboration only, explicitly labelled as such: a
 * loopback `settleMs` of 0-1ms carries no threshold small enough to prove an absence of cost.
 */
async function checkTelemetryOff(violations) {
  assertGuardedCallSite(violations);

  const { runs, inputFramesMedian } = await runRoundTripsFlow(violations, {
    afterRuns: (handle) => assertTelemetryFileAbsence(violations, handle),
  });

  const after = {
    inputFramesMedian,
    settleMsMedian: summarizeMetric(runs, "settleMs").median,
    maxBlockingMsMedian: summarizeMetric(runs, "maxBlockingMs").median,
  };
  console.log(
    `telemetry-off: timing leg bounds maxInputFrameRatio=${TELEMETRY_OFF_TIMING_BOUNDS.maxInputFrameRatio} maxSettleMs=${TELEMETRY_OFF_TIMING_BOUNDS.maxSettleMs} maxBlockingMs=${TELEMETRY_OFF_TIMING_BOUNDS.maxBlockingMs}`,
  );
  for (const v of compareLatencyReadings(
    PRE_TELEMETRY_LOOPBACK,
    after,
    TELEMETRY_OFF_TIMING_BOUNDS,
  )) {
    violations.push(`telemetry-off: ${v}`);
  }
  console.log(
    "telemetry-off: timing leg is corroboration, the guarded-call-site assertion is the proof",
  );
}

/** Same flow as `--check telemetry-off`, but the REAL boot is armed with telemetry ON, so the
 * file-absence assertion must trip while the structural assertion stays green, proving the two are
 * independent and proving the OFF check is a live instrument rather than one that can only pass. */
async function breakTelemetryFlagIgnored(violations) {
  assertGuardedCallSite(violations);
  await runRoundTripsFlow(violations, {
    telemetry: true,
    runs: 1,
    afterRuns: (handle) => assertTelemetryFileAbsence(violations, handle),
  });
}

// ---------------------------------------------------------------------------
// telemetry-on: one real flick through the real proxy, telemetry ON, proving
// both that a flick is recorded and that no string can reach the sink (101-04).
// ---------------------------------------------------------------------------

/** The exact field set {@link TelemetryRecord} may carry, transcribed from the plan's own
 * `<what_it_records_and_what_it_refuses_to_record>` allowlist, never guessed from a live sample. */
const TELEMETRY_ALLOWED_KEYS = [
  "v",
  "conn",
  "seq",
  "tsMs",
  "burstMs",
  "inputFrames",
  "inputBytes",
  "gapsMs",
  "turnaroundMs",
  "settleMs",
  "outputFrames",
  "outputBytes",
  "maxOutGapMs",
  "maxBacklogB",
  "pongRttMs",
  "gapCloseMs",
];
const TELEMETRY_MAX_GAPS = 64;

/** Mirrors `terminal-telemetry.ts`'s own `BURST_GAP_MS`: how long this check waits past the last
 * dispatched frame before trusting a burst has closed and flushed. */
const TELEMETRY_BURST_GAP_MS = 300;
const TELEMETRY_FILE_CAP_BYTES = 2_097_152;
const TELEMETRY_NONCE_PREFIX = "MOBILETERM101-";

/** Recursively walks a parsed record, collecting the path of every leaf value that is neither a
 * number nor `null`, the structural anti-leak invariant: it holds for content this check never
 * thought to look for, unlike a nonce scan alone. */
function collectNonNumericLeaves(value, path, out) {
  if (value === null || typeof value === "number") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectNonNumericLeaves(v, `${path}[${i}]`, out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectNonNumericLeaves(v, `${path}.${k}`, out);
    }
    return;
  }
  out.push(`${path}=${JSON.stringify(value)}`);
}

/**
 * Runs every ON-path assertion against one parsed set of records: at least one record, exactly one
 * flick record (`inputFrames >= 20`), the 16-key allowlist matched exactly on every record, no
 * string value anywhere (structural, not a grep), the nonce absent from the raw file bytes, timing
 * fields populated on the flick record, and the file under its cap. Every assertion runs
 * independently of the others so a break that trips one still prints the passing evidence for the
 * rest.
 */
function assertTelemetryOnRecords(violations, records, nonce, path) {
  console.log(`telemetry-on: ${records.length} record(s) found at ${path}`);
  if (records.length === 0) {
    violations.push(
      "telemetry-on: expected at least one telemetry record, found 0",
    );
  }

  const flickRecords = records.filter((r) => r.inputFrames >= 20);
  if (flickRecords.length !== 1) {
    violations.push(
      `telemetry-on: expected exactly one record with inputFrames >= 20, found ${flickRecords.length}`,
    );
  } else {
    console.log(
      `telemetry-on: flick record ${JSON.stringify(flickRecords[0])}`,
    );
    const r = flickRecords[0];
    if (r.turnaroundMs === null || r.turnaroundMs === undefined) {
      violations.push(
        `telemetry-on: flick record turnaroundMs expected non-null, got ${r.turnaroundMs}`,
      );
    }
    if (r.settleMs === null || r.settleMs === undefined) {
      violations.push(
        `telemetry-on: flick record settleMs expected non-null, got ${r.settleMs}`,
      );
    }
    const expectedGaps = Math.min(r.inputFrames - 1, TELEMETRY_MAX_GAPS);
    if (!Array.isArray(r.gapsMs) || r.gapsMs.length !== expectedGaps) {
      violations.push(
        `telemetry-on: flick record gapsMs.length expected ${expectedGaps}, got ${Array.isArray(r.gapsMs) ? r.gapsMs.length : "missing"}`,
      );
    }
  }

  const expectedKeySig = [...TELEMETRY_ALLOWED_KEYS].sort().join(",");
  const mismatched = records.filter(
    (r) => Object.keys(r).sort().join(",") !== expectedKeySig,
  );
  if (mismatched.length > 0) {
    for (const r of mismatched) {
      violations.push(
        `telemetry-on: record seq=${r.seq} field set does not match the allowlist, got [${Object.keys(r).sort().join(",")}]`,
      );
    }
  } else if (records.length > 0) {
    console.log(
      `telemetry-on: field set matches the allowlist exactly (${TELEMETRY_ALLOWED_KEYS.length} keys)`,
    );
  }

  const stringLeaks = [];
  for (const record of records) {
    collectNonNumericLeaves(record, "record", stringLeaks);
  }
  if (stringLeaks.length > 0) {
    for (const leak of stringLeaks) {
      violations.push(`telemetry-on: string value found at ${leak}`);
    }
  } else {
    console.log(
      `telemetry-on: no string value in any record, ${records.length} record(s) scanned`,
    );
  }

  const rawBytes = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (rawBytes.includes(nonce)) {
    violations.push("telemetry-on: nonce PRESENT in the telemetry file");
  } else {
    console.log("telemetry-on: nonce absent from the telemetry file");
  }

  if (existsSync(path)) {
    const size = statSync(path).size;
    if (size >= TELEMETRY_FILE_CAP_BYTES) {
      violations.push(
        `telemetry-on: file size ${size} at or over the ${TELEMETRY_FILE_CAP_BYTES}-byte cap`,
      );
    }
  }
}

/**
 * Stands up the real fixture with telemetry ON, drives one page session through the real proxy:
 * activation self-proofs first (a flick that never engaged the kinetic scroller would produce an
 * empty file this check must not read as a passing OFF-like result), then a typed nonce (the leak
 * probe, real terminal content crossing the exact socket the recorder observes) and one canonical
 * flick, then reads and asserts the sink BEFORE `tearDownFixture` deletes `handle.home`.
 * `opts.skipFlick` is `--break telemetry-no-flick`'s vehicle: nonce typed, no touch stream
 * dispatched. `opts.plantLeak` is `--break telemetry-leak-planted`'s vehicle: one crafted
 * string-valued line containing the nonce is appended to the sink right before the assertions run.
 */
async function runTelemetryOnFlow(violations, opts = {}) {
  const handle = await standUpFixture({ telemetry: true });
  let chromeChild = null;
  let cdp = null;
  const userDataDir = join(
    tmpdir(),
    `${SANDBOX_PREFIX}chrome-tel-${process.pid}`,
  );
  const nonce = TELEMETRY_NONCE_PREFIX + randomBytes(8).toString("hex");
  try {
    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    await waitForCdpUp();
    cdp = await connectCDP();

    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);

    const wsFrames = [];
    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Network.webSocketFrameSent") {
        wsFrames.push({
          dir: "sent",
          payloadData: msg.params.response.payloadData,
        });
      } else if (msg.method === "Network.webSocketFrameReceived") {
        wsFrames.push({
          dir: "recv",
          payloadData: msg.params.response.payloadData,
        });
      }
    });

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
      sessionId,
    );
    await cdp.send(
      "Emulation.setTouchEmulationEnabled",
      { enabled: true, configuration: "mobile" },
      sessionId,
    );

    const targetUrl = `http://127.0.0.1:${SANDBOX_PORT}/sessions/${handle.sessionId}/terminal/`;
    await cdp.send("Page.navigate", { url: targetUrl }, sessionId);
    await waitForPageComplete(cdp, sessionId, targetUrl);
    await sleep(2500);

    const coarse = await evalValue(
      cdp,
      sessionId,
      "window.matchMedia('(pointer: coarse)').matches",
    );
    if (coarse !== true) {
      violations.push(
        `telemetry-on: (pointer: coarse) expected true, measured ${coarse}`,
      );
    } else {
      console.log(`telemetry-on: (pointer: coarse) measured ${coarse}`);
    }

    await cdp.send(
      "Runtime.evaluate",
      { expression: KINETIC_PROBE_SRC, awaitPromise: false },
      sessionId,
    );

    await typeIntoTerminal(
      cdp,
      sessionId,
      195,
      400,
      nonce,
      TELEMETRY_BURST_GAP_MS + 50,
    );
    await sleep(TELEMETRY_BURST_GAP_MS + 200);

    if (!opts.skipFlick) {
      await flick(cdp, sessionId, CANONICAL_FLICK);
    }
    await sleep(1500 + TELEMETRY_BURST_GAP_MS + 500);

    if (!opts.skipFlick) {
      const probe = await evalValue(cdp, sessionId, "window.__kineticProbe");
      if (!probe || probe.defaultPrevented !== true) {
        violations.push(
          `telemetry-on: kinetic engagement expected defaultPrevented true, measured ${probe ? probe.defaultPrevented : false}`,
        );
      } else {
        console.log(
          `telemetry-on: kineticProbe measured ${JSON.stringify(probe)}`,
        );
      }

      const sentInput = wsFrames.filter(
        (f) => f.dir === "sent" && decodeTtydOp(f.payloadData) === "0",
      ).length;
      if (sentInput < 1) {
        violations.push(
          `telemetry-on: sent INPUT frames expected >= 1, measured ${sentInput}`,
        );
      } else {
        console.log(`telemetry-on: sent INPUT frames measured ${sentInput}`);
      }
    }

    const path = telemetryPath(handle);
    if (opts.plantLeak) {
      appendFileSync(
        path,
        JSON.stringify({
          v: 1,
          conn: 0,
          seq: 0,
          note: `leaked ${nonce}`,
        }) + "\n",
      );
    }

    const records = readTelemetryRecords(path);
    assertTelemetryOnRecords(violations, records, nonce, path);
    console.log(
      "telemetry-on: this fixture echoes at the termios layer and does no real rendering, so its turnaroundMs is a floor and says nothing about Claude Code's own redraw cost",
    );
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    rmSync(userDataDir, { recursive: true, force: true });
    await tearDownFixture(handle);
  }
}

async function checkTelemetryOn(violations) {
  await runTelemetryOnFlow(violations, {});
}

/** Identical flow, telemetry ON, nonce typed, but no touch stream dispatched. The `inputFrames >=
 * 20` assertion must trip while the nonce-absence assertion stays green, proving the ON check is
 * keyed to a real flick and not merely to the file existing. */
async function breakTelemetryNoFlick(violations) {
  await runTelemetryOnFlow(violations, { skipFlick: true });
}

/** Normal ON flow, then one crafted string-valued line planted in the sink before assertions run.
 * Both the no-strings walk and the nonce scan must trip while the flick assertion stays green,
 * proving the leak assertions are independent of the flick assertion. */
async function breakTelemetryLeakPlanted(violations) {
  await runTelemetryOnFlow(violations, { plantLeak: true });
}

// ---------------------------------------------------------------------------
// telemetry-capture (101-05): the OFFLINE validator. Reads a JSONL capture
// already on disk and asserts against it with no server, no tmux, no ttyd, no
// sandbox and no network. Registered in OFFLINE_CHECKS below so it can run at
// the one moment it matters: hours after the phone capture, while the user's
// own service is back up and every other check in this file would refuse to
// start.
// ---------------------------------------------------------------------------

/** How many `inputFrames >= TELEMETRY_CAPTURE_MIN_INPUT_FRAMES` records a capture must carry
 * before this validator will summarise it. Fewer means the ten-second flick did not land; the
 * honest response is to redo it, never to transcribe a thin capture into a findings file. */
const MIN_FLICK_BURSTS = 5;
const TELEMETRY_CAPTURE_MIN_INPUT_FRAMES = 10;

/** Nearest-rank percentile, consistent with this file's own `median()` (also nearest-rank on
 * ties). One number does not earn a stats dependency. */
function percentile(nums, p) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function printCaptureMedian(flickRecords, key) {
  const { median: m, min, max } = summarizeMetric(flickRecords, key);
  console.log(`telemetry-capture: ${key} median=${m} min=${min} max=${max}`);
}

/**
 * Offline: exists, non-empty, every line parses as JSON (first bad line named), every record's key
 * set equals the 16-key allowlist exactly, every value is a number/null/array-of-numbers (the same
 * structural walk `--check telemetry-on` runs, never a second implementation), at least
 * `MIN_FLICK_BURSTS` records clear the input-frame floor, and the file stays under plan 04's byte
 * cap. Then prints, for the qualifying flick records only, the medians plan 06 transcribes: the
 * same spread convention `printRoundTripsSummary` already uses (median/min/max), plus the pooled
 * `gapsMs` median and 95th percentile and how many qualifying records carried a non-null
 * `pongRttMs`.
 */
async function checkTelemetryCapture(violations, cliOpts = {}) {
  console.log("telemetry-capture: offline validator, no sandbox stood up");

  const path = cliOpts.filePath;
  if (!path) {
    violations.push("telemetry-capture: --file <path> is required");
    return;
  }
  if (!existsSync(path)) {
    violations.push(`telemetry-capture: no file at ${path}`);
    return;
  }

  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) {
    violations.push(`telemetry-capture: ${path} is empty, 0 records`);
    return;
  }

  const records = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]));
    } catch (err) {
      violations.push(
        `telemetry-capture: line ${i + 1} of ${path} did not parse as JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }
  console.log(
    `telemetry-capture: ${records.length} record(s) parsed from ${path}`,
  );

  const expectedKeySig = [...TELEMETRY_ALLOWED_KEYS].sort().join(",");
  const mismatched = records.filter(
    (r) => Object.keys(r).sort().join(",") !== expectedKeySig,
  );
  if (mismatched.length > 0) {
    for (const r of mismatched) {
      violations.push(
        `telemetry-capture: record seq=${r.seq} field set does not match the allowlist, got [${Object.keys(r).sort().join(",")}]`,
      );
    }
  } else {
    console.log(
      `telemetry-capture: field set matches the allowlist exactly (${TELEMETRY_ALLOWED_KEYS.length} keys)`,
    );
  }

  const stringLeaks = [];
  for (const record of records) {
    collectNonNumericLeaves(record, "record", stringLeaks);
  }
  if (stringLeaks.length > 0) {
    for (const leak of stringLeaks) {
      violations.push(`telemetry-capture: string value found at ${leak}`);
    }
  } else {
    console.log(
      `telemetry-capture: no string value in any record, ${records.length} record(s) scanned`,
    );
  }

  const size = statSync(path).size;
  if (size >= TELEMETRY_FILE_CAP_BYTES) {
    violations.push(
      `telemetry-capture: file size ${size} at or over the ${TELEMETRY_FILE_CAP_BYTES}-byte cap`,
    );
  }

  const flickRecords = records.filter(
    (r) =>
      typeof r.inputFrames === "number" &&
      r.inputFrames >= TELEMETRY_CAPTURE_MIN_INPUT_FRAMES,
  );
  if (flickRecords.length < MIN_FLICK_BURSTS) {
    violations.push(
      `telemetry-capture: expected at least ${MIN_FLICK_BURSTS} records with inputFrames >= ${TELEMETRY_CAPTURE_MIN_INPUT_FRAMES}, found ${flickRecords.length}`,
    );
    return;
  }
  console.log(
    `telemetry-capture: ${flickRecords.length} qualifying flick record(s) (inputFrames >= ${TELEMETRY_CAPTURE_MIN_INPUT_FRAMES})`,
  );

  for (const key of [
    "inputFrames",
    "turnaroundMs",
    "settleMs",
    "burstMs",
    "maxOutGapMs",
    "maxBacklogB",
  ]) {
    printCaptureMedian(flickRecords, key);
  }

  const pooledGaps = flickRecords.flatMap((r) =>
    Array.isArray(r.gapsMs) ? r.gapsMs : [],
  );
  if (pooledGaps.length > 0) {
    console.log(
      `telemetry-capture: gapsMs median=${median(pooledGaps)} p95=${percentile(pooledGaps, 95)} min=${Math.min(...pooledGaps)} max=${Math.max(...pooledGaps)} (pooled n=${pooledGaps.length})`,
    );
  } else {
    console.log(
      "telemetry-capture: gapsMs pooled n=0, no gap samples across qualifying records",
    );
  }

  const pongCount = flickRecords.filter(
    (r) => r.pongRttMs !== null && r.pongRttMs !== undefined,
  ).length;
  console.log(
    `telemetry-capture: pongRttMs non-null in ${pongCount}/${flickRecords.length} qualifying record(s)`,
  );
}

/** `--break telemetry-capture-blind`: the offline validator's own self-proof, run the same way the
 * real check runs, no live service required. A synthetic file carrying one record with a planted
 * string field and zero qualifying flick bursts must trip both the no-strings assertion and the
 * burst-count assertion, naming the offending key and the counted number respectively. A validator
 * that cannot fail on a bad file is worse than no validator, because plan 06 will transcribe
 * whatever it blesses. */
async function breakTelemetryCaptureBlind(violations) {
  const path = join(
    tmpdir(),
    `dispatch-mobile-term-101-capture-blind-${process.pid}.jsonl`,
  );
  const blindRecord = {
    v: 1,
    conn: 1,
    seq: 0,
    tsMs: Date.now(),
    burstMs: 5,
    inputFrames: 1,
    inputBytes: 3,
    gapsMs: [],
    turnaroundMs: 2,
    settleMs: 1,
    outputFrames: 1,
    outputBytes: 4,
    maxOutGapMs: 1,
    maxBacklogB: 0,
    pongRttMs: null,
    gapCloseMs: 300,
    note: "leaked telemetry-capture-blind string",
  };
  writeFileSync(path, JSON.stringify(blindRecord) + "\n");
  try {
    await checkTelemetryCapture(violations, { filePath: path });
  } finally {
    rmSync(path, { force: true });
  }
}

/** Skips the LoAF PerformanceObserver half of the probe only, the RAF sampler still installs.
 * `window.__loafEntries` must come back `undefined`, not `[]`, proving the check can tell "no
 * observer" apart from "observer installed, main thread never blocked". */
async function breakLoafBlind(violations) {
  await runRoundTripsFlow(violations, { skipLoaf: true, runs: 1 });
}

/** Reuses the activation proofs' own `skipTouchEmulation` vehicle: with touch emulation off,
 * `attachKineticScroll` never attaches, driving `inputFrames` to zero and proving the plausible-
 * floor assertion, the one check in this harness with no break per plan review, can actually fail. */
async function breakDeadListener(violations) {
  await runRoundTripsFlow(violations, { skipTouchEmulation: true, runs: 1 });
}

/**
 * Capture-phase wheel listener on `document`, NOT bubble-phase despite `emitTick`'s `bubbles: true`
 * dispatch (`terminal-main.ts:391-402`). Accumulates the SUM OF ABSOLUTE dispatched `deltaY`, the
 * calibrated quantity, rows of finger travel requested, not the frame count on the wire: a
 * coalescing fix is expected to change the latter while leaving this byte-identical.
 * @remarks Live-confirmed (same class of bug as plan 01's own kinetic-engagement probe): a
 * bubble-phase listener on `document` measures zero ticks on every run despite `attachKineticScroll`
 * genuinely engaging (`(pointer: coarse)` true, drag/momentum both firing). xterm's own internal
 * wheel handling on a descendant of `term.element` calls `stopPropagation()`, halting the event
 * before it ever bubbles back up to `document`. Capture-phase listeners on `document` fire on the
 * way DOWN, before the event reaches that descendant, so they see the dispatch regardless of any
 * later `stopPropagation()` call.
 */
const WHEEL_PROBE_SRC = `
  window.__wheelProbe = { ticks: 0, deltaSum: 0, deltaMode: null };
  document.addEventListener(
    "wheel",
    function (e) {
      if (window.__wheelProbe.deltaMode === null) window.__wheelProbe.deltaMode = e.deltaMode;
      window.__wheelProbe.ticks += 1;
      window.__wheelProbe.deltaSum += Math.abs(e.deltaY);
    },
    { capture: true, passive: true },
  );
`;

/** `--break drop-wheel-ticks`'s own live page mutation: patches `EventTarget.prototype.dispatchEvent`
 * to swallow every 5th `wheel`-typed dispatch, reproducing the v2.7-class ~20% under-scroll as a page
 * mutation with no `src/` edit and no rebuild. */
const DROP_WHEEL_PATCH_SRC = `
  (function () {
    var orig = EventTarget.prototype.dispatchEvent;
    var count = 0;
    EventTarget.prototype.dispatchEvent = function (e) {
      if (e && e.type === "wheel") {
        count += 1;
        if (count % 5 === 0) return true;
      }
      return orig.call(this, e);
    };
  })();
`;

async function measureFlickDeltaOnce(
  cdp,
  sessionId,
  targetUrl,
  runIndex,
  opts,
) {
  const url = `${targetUrl}?fd=${runIndex}`;
  await cdp.send("Page.navigate", { url }, sessionId);
  await waitForPageComplete(cdp, sessionId, url);
  await sleep(2500);

  if (opts.dropWheelTicks) {
    await cdp.send(
      "Runtime.evaluate",
      { expression: DROP_WHEEL_PATCH_SRC, awaitPromise: false },
      sessionId,
    );
  }
  await cdp.send(
    "Runtime.evaluate",
    { expression: WHEEL_PROBE_SRC, awaitPromise: false },
    sessionId,
  );

  await flick(cdp, sessionId, CANONICAL_FLICK);
  await sleep(1500);

  const wheelProbe = await evalValue(cdp, sessionId, "window.__wheelProbe");
  const rowHeightPx = await evalValue(
    cdp,
    sessionId,
    `(function(){
      var el = document.querySelector(".xterm-rows");
      var row = el && el.children[0];
      return row ? row.getBoundingClientRect().height : null;
    })()`,
  );
  return { wheelProbe, rowHeightPx };
}

/**
 * A second CDP target on the SAME fixture/tmux/ttyd, not a second fixture standup: fine pointer, no
 * touch emulation, ROADMAP criterion 3's explicit desktop leg. Proves the desktop path is inert to
 * synthetic touch (no `attachKineticScroll`, since `main()`'s coarse-pointer gate never opens) yet
 * still alive to a real dispatched wheel (xterm's own always-on wheel listener, independent of the
 * mobile kinetic scroller).
 */
async function runDesktopLeg(violations, cdp, handle) {
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
  });
  try {
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);

    const wsFrames = [];
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Network.webSocketFrameSent") {
        wsFrames.push({ payloadData: msg.params.response.payloadData });
      }
    };
    cdp.ws.addEventListener("message", onMessage);

    const targetUrl = `http://127.0.0.1:${SANDBOX_PORT}/sessions/${handle.sessionId}/terminal/`;
    await cdp.send("Page.navigate", { url: targetUrl }, sessionId);
    await waitForPageComplete(cdp, sessionId, targetUrl);
    await sleep(2500);

    const coarse = await evalValue(
      cdp,
      sessionId,
      "window.matchMedia('(pointer: coarse)').matches",
    );
    if (coarse !== false) {
      violations.push(
        `flick-distance: desktop (pointer: coarse) expected false, measured ${coarse}`,
      );
    } else {
      console.log(
        `flick-distance: desktop (pointer: coarse) measured ${coarse}`,
      );
    }

    await cdp.send(
      "Runtime.evaluate",
      { expression: KINETIC_PROBE_SRC, awaitPromise: false },
      sessionId,
    );
    await flick(cdp, sessionId, CANONICAL_FLICK);
    await sleep(500);
    const probe = await evalValue(cdp, sessionId, "window.__kineticProbe");
    const probeReading = probe
      ? { moves: probe.moves, defaultPrevented: probe.defaultPrevented }
      : null;
    // `moves` is NOT proof of attachment: KINETIC_PROBE_SRC's own listener sees every dispatched
    // touchmove regardless of matchMedia, live-confirmed (moves: 25 here even though the mobile
    // kinetic scroller never attaches on this fine-pointer target). `defaultPrevented` IS the real
    // proof: only `attachKineticScroll`'s own listener ever calls `preventDefault()`, and it never
    // ran here, so `false` means no page code intercepted the gesture.
    if (!probe || probe.defaultPrevented !== false) {
      violations.push(
        `flick-distance: desktop kineticProbe expected defaultPrevented false, measured ${JSON.stringify(probeReading)}`,
      );
    } else {
      console.log(
        `flick-distance: desktop kineticProbe measured ${JSON.stringify(probeReading)}`,
      );
    }

    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: 195, y: 400 },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseWheel", x: 195, y: 400, deltaX: 0, deltaY: -120 },
      sessionId,
    );
    await sleep(500);
    const nativeInputFrames = wsFrames.filter(
      (f) => decodeTtydOp(f.payloadData) === "0",
    ).length;
    if (nativeInputFrames < 1) {
      violations.push(
        `flick-distance: desktop native wheel INPUT frames expected >= 1, measured ${nativeInputFrames}`,
      );
    } else {
      console.log(
        `flick-distance: desktop native wheel INPUT frames measured ${nativeInputFrames}`,
      );
    }
    cdp.ws.removeEventListener("message", onMessage);
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/**
 * ZERO tolerance across `deltaSum`, `ticks` and `deltaMode` (the density-91.mjs `compareReadings`
 * shape, applied to geometry only, per PATTERNS gotcha 7). Kept a wholly separate function from
 * `compareLatencyReadings`, which is threshold-based and covers the jittery round-trip numbers, one
 * comparator must never cover both.
 */
function compareFlickReadings(before, after) {
  const violations = [];
  for (const field of ["deltaSum", "ticks", "deltaMode"]) {
    if (before[field] !== after[field]) {
      violations.push(
        `flick-distance.${field}: expected ${before[field]}, got ${after[field]}`,
      );
    }
  }
  return violations;
}

/**
 * Stands up the real fixture once, measures `opts.runs ?? FD_RUNS` canonical flicks (each a fresh
 * page, MEDIAN-reduced so one stalled frame cannot drag the baseline), clears the persisted zoom key
 * once up front so every measured run loads at the default zoom (row height scales with font size,
 * an unpinned zoom would silently change `deltaSum` between BEFORE and AFTER), then runs the desktop
 * leg on a second target against the same fixture unless `opts.skipDesktopLeg`.
 */
async function runFlickDistanceFlow(violations, opts = {}) {
  if (opts.tunnel) await assertCloudflaredOnPath();
  const handle = await standUpFixture({});
  let chromeChild = null;
  let cdp = null;
  let tunnelEnabled = false;
  const userDataDir = join(
    tmpdir(),
    `${SANDBOX_PREFIX}chrome-fd-${process.pid}`,
  );
  try {
    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    await waitForCdpUp();
    cdp = await connectCDP();

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
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
      sessionId,
    );
    await cdp.send(
      "Emulation.setTouchEmulationEnabled",
      { enabled: true, configuration: "mobile" },
      sessionId,
    );

    let targetUrl;
    if (opts.tunnel) {
      const state = await enableTunnelViaLoopback();
      tunnelEnabled = true;
      registerTunnelSecrets(state);
      console.log(`tunnel: up at ${redactTunnelHost(state.url)}`);
      targetUrl = await authenticateOverTunnel(
        cdp,
        sessionId,
        state,
        `/sessions/${handle.sessionId}/terminal/`,
      );
    } else {
      targetUrl = `http://127.0.0.1:${SANDBOX_PORT}/sessions/${handle.sessionId}/terminal/`;
      await cdp.send("Page.navigate", { url: targetUrl }, sessionId);
      await waitForPageComplete(cdp, sessionId, targetUrl);
    }
    await evalValue(
      cdp,
      sessionId,
      "localStorage.removeItem('dsp.terminal.zoom')",
    );

    const runCount = opts.runs ?? FD_RUNS;
    const deltaSums = [];
    const ticksList = [];
    const deltaModes = [];
    const rowHeights = [];

    for (let i = 0; i < runCount; i++) {
      const { wheelProbe, rowHeightPx } = await measureFlickDeltaOnce(
        cdp,
        sessionId,
        targetUrl,
        i,
        opts,
      );
      if (!wheelProbe) {
        violations.push(
          `flick-distance[run ${i}]: window.__wheelProbe missing`,
        );
        continue;
      }
      if (wheelProbe.deltaMode !== 1) {
        violations.push(
          `flick-distance[run ${i}]: deltaMode expected 1, measured ${wheelProbe.deltaMode}`,
        );
      }
      deltaSums.push(wheelProbe.deltaSum);
      ticksList.push(wheelProbe.ticks);
      deltaModes.push(wheelProbe.deltaMode);
      if (rowHeightPx != null) rowHeights.push(rowHeightPx);
    }

    const reading = {
      deltaSum: median(deltaSums),
      ticks: median(ticksList),
      deltaMode: median(deltaModes),
      rowHeightPx: rowHeights.length > 0 ? median(rowHeights) : null,
      headSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT })
        .toString()
        .trim(),
      capturedAt: new Date().toISOString(),
    };

    if (!opts.skipDesktopLeg) {
      await runDesktopLeg(violations, cdp, handle);
    }

    return { reading };
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    rmSync(userDataDir, { recursive: true, force: true });
    if (tunnelEnabled) {
      try {
        await disableTunnelViaLoopback();
      } catch (err) {
        violations.push(err instanceof Error ? err.message : String(err));
      }
    }
    await tearDownFixture(handle);
    if (tunnelEnabled) {
      try {
        await assertNoStrayCloudflared();
      } catch (err) {
        violations.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
}

/** `--tunnel` skips the desktop leg (ponytail: it proves the desktop path is inert to synthetic
 * touch regardless of transport, already proven on loopback, add a tunnel-specific desktop leg
 * only if a transport-dependent desktop regression is ever suspected) and reuses task 1's own
 * `authenticateOverTunnel` bringup, never a forked copy. */
async function checkFlickDistance(violations, cliOpts = {}) {
  const { reading } = await runFlickDistanceFlow(violations, {
    tunnel: !!cliOpts.tunnel,
    skipDesktopLeg: !!cliOpts.tunnel,
  });
  const label = cliOpts.tunnel ? "flick-distance[tunnel]" : "flick-distance";
  console.log(
    `${label}: deltaSum median=${reading.deltaSum} ticks median=${reading.ticks} deltaMode=${reading.deltaMode} (runs=${FD_RUNS})`,
  );

  if (cliOpts.jsonPath) {
    writeFileSync(cliOpts.jsonPath, JSON.stringify(reading, null, 2) + "\n");
    console.log(`${label}: wrote readings to ${cliOpts.jsonPath}`);
  }
  if (cliOpts.comparePath) {
    const before = JSON.parse(readFileSync(cliOpts.comparePath, "utf8"));
    const cmp = compareFlickReadings(before, reading);
    for (const v of cmp) violations.push(v);
  }
}

/** The v2.7-class under-scroll reproduced live: patches `dispatchEvent` to swallow every 5th wheel
 * tick, then compares against the on-disk pre-fix baseline, which must already exist (captured by a
 * prior `--check flick-distance --json` run). */
async function breakDropWheelTicks(violations) {
  const baselinePath = join(
    REPO_ROOT,
    ".planning",
    "phases",
    "101-mobile-terminal",
    "101-flick-before.json",
  );
  if (!existsSync(baselinePath)) {
    violations.push(
      `break drop-wheel-ticks: baseline missing at ${baselinePath}, run --check flick-distance --json ${baselinePath} first`,
    );
    return;
  }
  const before = JSON.parse(readFileSync(baselinePath, "utf8"));
  const { reading: after } = await runFlickDistanceFlow(violations, {
    dropWheelTicks: true,
    skipDesktopLeg: true,
  });
  const cmp = compareFlickReadings(before, after);
  for (const v of cmp) violations.push(v);
}

// ---------------------------------------------------------------------------
// The tunnel leg (101-03): real Quick Tunnel bringup over the real product route
// (POST /api/remote/enable, fire-and-forget, polled via GET /api/remote), the
// real `?code=` auth handshake, and the TERM-06 assertions. `authenticateOverTunnel`
// is the ONE auth path every tunnel-mode leg in this file goes through, including
// task 2's `--tunnel` modifier, never forked.
// ---------------------------------------------------------------------------

const TUNNEL_POLL_INTERVAL_MS = 500;
const TUNNEL_ENABLE_TIMEOUT_MS = 30_000;
const TUNNEL_DISABLE_TIMEOUT_MS = 15_000;

/** Live-confirmed real-world jitter: a freshly-minted Quick Tunnel subdomain has, on a bad draw,
 * taken well over 30s for Chrome's own resolver to route to reliably. A generous budget here (a
 * one-time cost paid once per tunnel bringup, not per measurement run) absorbs that instead of
 * flaking. See `waitForPageComplete`'s `opts.retryNavUrl`. */
const TUNNEL_NAV_RETRY_OPTS = { timeoutMs: 60_000, maxRetries: 40 };

/** Must match cloudflared.ts's own TUNNEL_HOST_SENTINEL. Duplicated here (not imported) since
 * this harness is plain .mjs, and importing a TS module's compiled output would tie this file to
 * dist/'s internal module layout for one string constant. */
const CLOUDFLARED_SENTINEL = "dispatch.invalid";

/** Preflight, fail loud: RESEARCH's Environment Availability table calls for explicit handling,
 * never a silent skip, a missing binary would let TERM-06 close on nothing. */
async function assertCloudflaredOnPath() {
  try {
    await execFileP("which", ["cloudflared"]);
  } catch {
    throw new Error(
      "mobile-term-101: cloudflared not on PATH, the tunnel leg is not skippable, install with 'brew install cloudflared'",
    );
  }
}

async function fetchTunnelState() {
  const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/remote`);
  return res.json();
}

/** `POST /api/remote/enable` is fire-and-forget (202 while state is still "starting"): poll
 * `GET /api/remote`, never trust the enable response, until status is "on", then read url/code off
 * THAT polled response, never the enable response itself.
 * @remarks A freshly-minted `*.trycloudflare.com` subdomain can report `status: "on"` before
 * Chrome's own resolver can reliably route to it (a live-confirmed transient
 * `net::ERR_NAME_NOT_RESOLVED` on the very first navigation). A Node-side `fetch`-based
 * reachability pre-check was tried and reverted here: Node's `getaddrinfo` proved LESS reliable
 * than Chrome's own resolver in this environment (persistent `ENOTFOUND` well past the point
 * Chrome itself recovered), so the retry lives where the actual failure is observed instead, see
 * `waitForPageComplete`'s `opts.retryNavUrl`. */
async function enableTunnelViaLoopback() {
  const res = await fetch(
    `http://127.0.0.1:${SANDBOX_PORT}/api/remote/enable`,
    { method: "POST" },
  );
  await res.body?.cancel().catch(() => {});
  const deadline = Date.now() + TUNNEL_ENABLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await fetchTunnelState();
    if (state.status === "on") return state;
    if (state.status === "binary-missing" || state.status === "error") {
      throw new Error(`tunnel: enable failed, state=${JSON.stringify(state)}`);
    }
    await sleep(TUNNEL_POLL_INTERVAL_MS);
  }
  throw new Error(
    `tunnel: did not reach status "on" within ${TUNNEL_ENABLE_TIMEOUT_MS}ms`,
  );
}

async function disableTunnelViaLoopback() {
  const res = await fetch(
    `http://127.0.0.1:${SANDBOX_PORT}/api/remote/disable`,
    { method: "POST" },
  );
  await res.body?.cancel().catch(() => {});
  const deadline = Date.now() + TUNNEL_DISABLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await fetchTunnelState();
    if (state.status !== "on") return state;
    await sleep(TUNNEL_POLL_INTERVAL_MS);
  }
  throw new Error(
    `tunnel: status still "on" ${TUNNEL_DISABLE_TIMEOUT_MS}ms after disable`,
  );
}

/** This is a publicly reachable, unauthenticated-until-gated ingress: never log the real host or
 * the passphrase, only this redacted shape. */
function redactTunnelHost(url) {
  return url.replace(
    /^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/,
    "https://***.trycloudflare.com",
  );
}

/** Mirrors cloudflared.ts's own `sweepStrayTunnels` matching (harness-local, see
 * `CLOUDFLARED_SENTINEL`'s own comment for why this is not imported): a stray cloudflared carrying
 * the sentinel argv is a live, unauthenticated public ingress, never acceptable to leave running,
 * checked as a second line of defence on top of this file's own `disable` + poll teardown. */
async function assertNoStrayCloudflared() {
  let out = "";
  try {
    ({ stdout: out } = await execFileP("ps", ["-axww", "-o", "pid=,command="]));
  } catch {
    return;
  }
  const survivors = out.split("\n").filter((line) => {
    const m = line.match(/^\s*\d+\s+(.*)$/);
    if (!m) return false;
    const argv = m[1].trim().split(/\s+/);
    return (
      basename(argv[0]) === "cloudflared" && m[1].includes(CLOUDFLARED_SENTINEL)
    );
  });
  if (survivors.length > 0) {
    throw new Error(
      `tunnel: ${survivors.length} stray cloudflared process(es) survived teardown:\n${survivors.join("\n")}`,
    );
  }
}

/** `-J` joins wrapped lines back into one logical line before printing. Live-confirmed load-
 * bearing, not cosmetic: the mobile emulation viewport (390px) is narrow enough that a typed
 * marker wraps mid-string across two physical pane rows, and without `-J` tmux inserts a literal
 * newline at the wrap point, breaking a plain substring match against the unwrapped marker. */
async function capturePane(tmuxName) {
  const { stdout } = await execFileP("tmux", [
    "capture-pane",
    "-p",
    "-J",
    "-t",
    `=${tmuxName}:`,
  ]);
  return stdout;
}

/**
 * Navigates the CDP session's FIRST tunnel request carrying `?code=` (the shipped auto-verify
 * branch, `remote-auth-gate.ts:341-349`), waits for the redirect that strips it, and asserts the
 * session cookie actually landed before any caller trusts the tunnel to be authenticated. Returns
 * the clean (code-stripped) URL every subsequent same-session navigation on this tab should reuse.
 * The ONE auth path every tunnel-mode leg in this file goes through, task 1's own checks included.
 */
async function authenticateOverTunnel(cdp, sessionId, tunnelState, basePath) {
  const cleanUrl = `${tunnelState.url}${basePath}`;
  const navUrl = `${cleanUrl}?code=${encodeURIComponent(tunnelState.code)}`;
  await cdp.send("Page.navigate", { url: navUrl }, sessionId);
  await waitForPageComplete(cdp, sessionId, cleanUrl, {
    ...TUNNEL_NAV_RETRY_OPTS,
    retryNavUrl: navUrl,
  });
  await sleep(1500);
  const cookiesResult = await cdp.send(
    "Network.getCookies",
    { urls: [tunnelState.url] },
    sessionId,
  );
  const cookieNames = (cookiesResult.cookies ?? []).map((c) => c.name);
  if (!cookieNames.includes("dispatch_remote_session")) {
    throw new Error(
      `tunnel: expected cookie dispatch_remote_session present after auth, measured absent (names=${cookieNames.join(",")})`,
    );
  }
  return cleanUrl;
}

async function pollForTextInDom(cdp, sessionId, expression, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await evalValue(cdp, sessionId, expression);
    if (typeof text === "string" && text.includes(needle)) return text;
    await sleep(150);
  }
  return null;
}

/** Real focus (a synthesized click, mirroring a user's own tap-to-focus) then real per-character
 * keyboard dispatch, so the marker travels the real path: browser -> xterm's onData -> WS -> proxy
 * -> ttyd -> pty. A client-only DOM assertion could pass on a locally echoed illusion; pairing this
 * with a server-side `tmux capture-pane` read (the caller's job) is what excludes that.
 * @remarks `perCharMs` (default 15) is the 101-04 telemetry-on check's own vehicle: a slow cadence
 * spaces each keystroke's own WS frame further apart than the recorder's burst-close gap, so a
 * multi-character nonce opens and closes its own harmless one-frame bursts instead of merging into
 * the flick's, which is structurally indistinguishable from it at the WebSocket-frame layer.
 */
async function typeIntoTerminal(cdp, sessionId, x, y, text, perCharMs = 15) {
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x, y, button: "left", clickCount: 1 },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x, y, button: "left", clickCount: 1 },
    sessionId,
  );
  await sleep(300);
  for (const ch of text) {
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "keyDown", text: ch, unmodifiedText: ch, key: ch },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: ch },
      sessionId,
    );
    await sleep(perCharMs);
  }
}

/** Two-point pinch apart, `steps` moves (>= 6) spanning more than `ZOOM.commitFloorMs` (120ms)
 * total, mirroring `attachZoomControl`'s own touch-point-distance pinch math
 * (`terminal-main.ts:788-830`). */
async function pinchApart(
  cdp,
  sessionId,
  { cx, cy, startHalf, endHalf, steps, stepMs },
) {
  await cdp.send(
    "Input.dispatchTouchEvent",
    {
      type: "touchStart",
      touchPoints: [
        { x: cx - startHalf, y: cy, id: 0 },
        { x: cx + startHalf, y: cy, id: 1 },
      ],
    },
    sessionId,
  );
  for (let i = 1; i <= steps; i++) {
    const half = startHalf + ((endHalf - startHalf) * i) / steps;
    await cdp.send(
      "Input.dispatchTouchEvent",
      {
        type: "touchMove",
        touchPoints: [
          { x: cx - half, y: cy, id: 0 },
          { x: cx + half, y: cy, id: 1 },
        ],
      },
      sessionId,
    );
    await sleep(stepMs);
  }
  await cdp.send(
    "Input.dispatchTouchEvent",
    { type: "touchEnd", touchPoints: [] },
    sessionId,
  );
}

/**
 * Stands up the real fixture, brings up a REAL Quick Tunnel through the real product route
 * (loopback-only, the tunnel does not exist yet when this POSTs), drives one CDP tab through mobile
 * emulation and the real auth gate, and proves TERM-06's three clauses. `opts.skipAuth` and
 * `opts.wrongCode` are the two break legs: each navigates the tunnel URL WITHOUT going through
 * `authenticateOverTunnel`, so the gate is exercised exactly as shipped, never weakened.
 */
async function runTunnelFlow(violations, opts = {}) {
  await assertCloudflaredOnPath();
  const handle = await standUpFixture({});
  let chromeChild = null;
  let cdp = null;
  let tunnelEnabled = false;
  const userDataDir = join(
    tmpdir(),
    `${SANDBOX_PREFIX}chrome-tunnel-${process.pid}`,
  );
  try {
    const state = await enableTunnelViaLoopback();
    tunnelEnabled = true;
    registerTunnelSecrets(state);
    console.log(`tunnel: up at ${redactTunnelHost(state.url)}`);

    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    await waitForCdpUp();
    cdp = await connectCDP();

    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);

    const docResponses = [];
    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.sessionId !== sessionId) return;
      if (
        msg.method === "Network.responseReceived" &&
        msg.params.type === "Document"
      ) {
        docResponses.push({
          url: msg.params.response.url,
          status: msg.params.response.status,
        });
      }
      if (process.env.MT101_DEBUG && msg.method === "Network.loadingFailed") {
        console.error(
          `DEBUG Network.loadingFailed: errorText=${msg.params.errorText} type=${msg.params.type} canceled=${msg.params.canceled}`,
        );
      }
    });

    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
      sessionId,
    );
    await cdp.send(
      "Emulation.setTouchEmulationEnabled",
      { enabled: true, configuration: "mobile" },
      sessionId,
    );

    const basePath = `/sessions/${handle.sessionId}/terminal/`;
    const cleanTargetUrl = `${state.url}${basePath}`;
    let finalUrl;

    if (opts.skipAuth) {
      finalUrl = cleanTargetUrl;
      await cdp.send("Page.navigate", { url: finalUrl }, sessionId);
      await waitForPageComplete(cdp, sessionId, finalUrl, {
        ...TUNNEL_NAV_RETRY_OPTS,
        retryNavUrl: finalUrl,
      });
      await sleep(1500);
    } else if (opts.wrongCode) {
      finalUrl = `${cleanTargetUrl}?code=wrong-guess-never-right`;
      await cdp.send("Page.navigate", { url: finalUrl }, sessionId);
      await waitForPageComplete(cdp, sessionId, finalUrl, {
        ...TUNNEL_NAV_RETRY_OPTS,
        retryNavUrl: finalUrl,
      });
      await sleep(1500);
    } else {
      finalUrl = await authenticateOverTunnel(cdp, sessionId, state, basePath);
      console.log("tunnel: cookie dispatch_remote_session present");
    }

    const lastDocStatus =
      docResponses.length > 0
        ? docResponses[docResponses.length - 1].status
        : 200;

    const hasTerminalMarker = await evalValue(
      cdp,
      sessionId,
      "document.querySelector('#terminal .xterm-screen') !== null",
    );
    const hasCodeEntryMarker = await evalValue(
      cdp,
      sessionId,
      "document.querySelector('form[action=\"/__remote/verify\"]') !== null",
    );

    if (opts.skipAuth) {
      if (!hasCodeEntryMarker || hasTerminalMarker) {
        violations.push(
          `tunnel: break skip-auth expected the code-entry page, measured terminalMarker=${hasTerminalMarker} codeEntryMarker=${hasCodeEntryMarker}`,
        );
      } else {
        violations.push(
          `tunnel: expected the terminal page, measured the remote code-entry page (HTTP ${lastDocStatus})`,
        );
      }
      return;
    }
    if (opts.wrongCode) {
      const cookiesResult = await cdp.send(
        "Network.getCookies",
        { urls: [state.url] },
        sessionId,
      );
      const cookieNames = (cookiesResult.cookies ?? []).map((c) => c.name);
      if (cookieNames.includes("dispatch_remote_session")) {
        violations.push(
          "tunnel: break wrong-code expected cookie dispatch_remote_session absent, measured present",
        );
      } else {
        violations.push(
          "tunnel: expected cookie dispatch_remote_session, measured absent",
        );
      }
      return;
    }

    if (!hasTerminalMarker || hasCodeEntryMarker) {
      violations.push(
        `tunnel: expected terminal page confirmed with code-entry marker absent, measured terminalMarker=${hasTerminalMarker} codeEntryMarker=${hasCodeEntryMarker}`,
      );
    } else {
      console.log("tunnel: terminal page confirmed, code-entry marker absent");
    }

    // TERM-06 clause 1: input lands and output renders, in one gesture, proven two ways.
    const markerId = `dsp-tunnel-${randomBytes(6).toString("hex")}`;
    await typeIntoTerminal(cdp, sessionId, 195, 400, markerId);
    const domText = await pollForTextInDom(
      cdp,
      sessionId,
      "(document.querySelector('.xterm-rows')||{}).textContent || ''",
      markerId,
      5000,
    );
    const paneText = await capturePane(handle.tmuxName);
    if (process.env.MT101_DEBUG) {
      console.error(
        `DEBUG paneText (JSON): ${JSON.stringify(paneText)}\nDEBUG domText (JSON): ${JSON.stringify(domText)}`,
      );
    }
    const inDom = domText !== null;
    const inPane = paneText.includes(markerId);
    if (!inDom || !inPane) {
      violations.push(
        `tunnel: marker ${markerId} expected in xterm AND capture-pane, measured inDom=${inDom} inPane=${inPane}`,
      );
    } else {
      console.log(
        `tunnel: marker ${markerId} rendered in xterm AND present in capture-pane`,
      );
    }

    // TERM-06 clause 2: pinch zoom commits and persists.
    // `.xterm-rows`, not `.xterm`, live-confirmed by reading @xterm/xterm's own DomRenderer
    // (`_injectCss`): the dynamic `font-size: <N>px` rule it writes into an injected <style> tag
    // targets a `.xterm-rows` descendant selector, never the outer `.xterm` container itself, so
    // `.xterm`'s own computed style just inherits the page default and never changes with zoom.
    await evalValue(
      cdp,
      sessionId,
      "localStorage.removeItem('dsp.terminal.zoom')",
    );
    const fontSizeBefore = await evalValue(
      cdp,
      sessionId,
      "getComputedStyle(document.querySelector('.xterm-rows')).fontSize",
    );
    await pinchApart(cdp, sessionId, {
      cx: 195,
      cy: 400,
      startHalf: 20,
      endHalf: 120,
      steps: 8,
      stepMs: 30,
    });
    await sleep(500);
    const fontSizeAfter = await evalValue(
      cdp,
      sessionId,
      "getComputedStyle(document.querySelector('.xterm-rows')).fontSize",
    );
    const persistedZoomRaw = await evalValue(
      cdp,
      sessionId,
      "localStorage.getItem('dsp.terminal.zoom')",
    );
    const persistedZoom = Number(persistedZoomRaw);
    const zoomSteps = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4];
    const zoomIncreased =
      parseFloat(fontSizeAfter) > parseFloat(fontSizeBefore);
    const zoomValid = zoomSteps.includes(persistedZoom) && persistedZoom > 1.0;
    if (!zoomIncreased || !zoomValid) {
      violations.push(
        `tunnel: pinch zoom expected fontSize increase and dsp.terminal.zoom in ZOOM.steps strictly > starting zoom, measured ${fontSizeBefore} -> ${fontSizeAfter}, persisted=${persistedZoomRaw}`,
      );
    } else {
      console.log(
        `tunnel: pinch zoom fontSize ${fontSizeBefore} -> ${fontSizeAfter}, dsp.terminal.zoom persisted ${persistedZoom}`,
      );
    }
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    rmSync(userDataDir, { recursive: true, force: true });
    if (tunnelEnabled) {
      try {
        await disableTunnelViaLoopback();
      } catch (err) {
        violations.push(err instanceof Error ? err.message : String(err));
      }
    }
    await tearDownFixture(handle);
    try {
      await assertNoStrayCloudflared();
    } catch (err) {
      violations.push(err instanceof Error ? err.message : String(err));
    }
  }
}

async function checkTunnel(violations) {
  await runTunnelFlow(violations, {});
}

/** Navigates the tunnel terminal URL WITHOUT `?code=`. Proves the check can tell the code-entry
 * page apart from a loaded terminal, never weakening `src/`. */
async function breakSkipAuth(violations) {
  await runTunnelFlow(violations, { skipAuth: true });
}

/** Navigates the tunnel terminal URL with a deliberately wrong passphrase. Same detection as
 * skip-auth, plus the cookie assertion must fire. */
async function breakWrongCode(violations) {
  await runTunnelFlow(violations, { wrongCode: true });
}

// ---------------------------------------------------------------------------
// Checks and breaks.
// ---------------------------------------------------------------------------

/**
 * Standup precondition proof: the tmux session is live, ttyd is LISTENING, assertPaneModes reads
 * "1 1", and GET /sessions/<id>/terminal/ returns 200 (not the 404 an unresolvable session yields).
 * No CDP work here, task 2's activation check owns that.
 */
async function checkStandup(violations) {
  const handle = await standUpFixture({});
  try {
    const live = await tmuxListSessionNames();
    if (!live.includes(handle.tmuxName)) {
      violations.push(
        `standup: tmux session ${handle.tmuxName} not found in tmux list-sessions`,
      );
    }
    if (!(await isPortListening(handle.ttyd.port))) {
      violations.push(`standup: ttyd port ${handle.ttyd.port} not LISTENING`);
    }
    const measured = await assertPaneModes(handle.tmuxName);
    console.log(`standup: pane modes ${measured}`);

    const url = `http://127.0.0.1:${SANDBOX_PORT}/sessions/${handle.sessionId}/terminal/`;
    const res = await fetch(url);
    await res.body?.cancel();
    if (res.status !== 200) {
      violations.push(
        `standup: GET ${url} expected 200, measured ${res.status}`,
      );
    } else {
      console.log(`standup: GET ${url} measured 200`);
    }
  } finally {
    await tearDownFixture(handle);
  }
}

/** Plants writeViewportFixtureBinary instead of the mouse-report fixture, everything else
 * identical, and proves assertPaneModes's own "1 1" precondition can actually fail. */
async function breakViewportFixture(violations) {
  try {
    const handle = await standUpFixture({ useViewportFixture: true });
    await tearDownFixture(handle);
    violations.push(
      "break viewport-fixture: expected assertPaneModes to throw, but standup completed without error",
    );
  } catch (err) {
    violations.push(err instanceof Error ? err.message : String(err));
  }
}

const CHECKS = {
  standup: checkStandup,
  activation: checkActivation,
  "round-trips": checkRoundTrips,
  "flick-distance": checkFlickDistance,
  tunnel: checkTunnel,
  "telemetry-off": checkTelemetryOff,
  "telemetry-on": checkTelemetryOn,
  "telemetry-capture": checkTelemetryCapture,
  "pty-shim": checkPtyShim,
};

const BREAKS = {
  "viewport-fixture": breakViewportFixture,
  "shim-markers-emptied": breakShimMarkersEmptied,
  "no-touch-emulation": breakNoTouchEmulation,
  "sub-slop-flick": breakSubSlopFlick,
  "wrong-page": breakWrongPage,
  "loaf-blind": breakLoafBlind,
  "dead-listener": breakDeadListener,
  "drop-wheel-ticks": breakDropWheelTicks,
  "skip-auth": breakSkipAuth,
  "wrong-code": breakWrongCode,
  "telemetry-flag-ignored": breakTelemetryFlagIgnored,
  "telemetry-no-flick": breakTelemetryNoFlick,
  "telemetry-leak-planted": breakTelemetryLeakPlanted,
  "telemetry-capture-blind": breakTelemetryCaptureBlind,
};

/** `telemetry-capture` (101-05) is the one check that must run at the exact moment the user's own
 * live service is back up: it skips `assertNoLiveService`/`assertSandboxPortsFree`/`assertBuilt`
 * in `main()` below, none of which the offline validator needs since it only reads a file. Its own
 * `--break` leg gets the same treatment, it is the same validator run against a synthetic file. */
const OFFLINE_CHECKS = new Set(["telemetry-capture"]);
const OFFLINE_BREAKS = new Set(["telemetry-capture-blind"]);

function isOfflineRun(checkName, breakName) {
  if (checkName != null) return OFFLINE_CHECKS.has(checkName);
  if (breakName != null) return OFFLINE_BREAKS.has(breakName);
  return false;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const checkName = readFlag(argv, "--check");
  if (checkName != null && !CHECKS[checkName]) {
    console.error(
      `unknown check "${checkName}", valid: ${Object.keys(CHECKS).join(", ") || "(none registered yet)"}`,
    );
    process.exit(1);
  }
  const breakName = readFlag(argv, "--break");
  if (breakName != null && !BREAKS[breakName]) {
    console.error(
      `unknown break "${breakName}", valid: ${Object.keys(BREAKS).join(", ") || "(none registered yet)"}`,
    );
    process.exit(1);
  }
  const cliOpts = {
    jsonPath: readFlag(argv, "--json"),
    comparePath: readFlag(argv, "--compare"),
    tunnel: argv.includes("--tunnel"),
    filePath: readFlag(argv, "--file"),
  };

  if (!isOfflineRun(checkName, breakName)) {
    await assertNoLiveService();
    await assertSandboxPortsFree();
    assertBuilt();
  }

  const realBefore = statRealBoardDb();
  console.log(`\nLIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const violations = [];

  if (breakName != null) {
    console.log(`\n=== running break: ${breakName} ===`);
    await BREAKS[breakName](violations);
  } else {
    const names = checkName != null ? [checkName] : Object.keys(CHECKS);
    for (const n of names) {
      console.log(`\n=== running check: ${n} ===`);
      const before = violations.length;
      try {
        await CHECKS[n](violations, cliOpts);
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
    if (names.length === 0) {
      console.log("\nno checks registered yet in this file");
    }
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

  const portsHeld = await checkPortsHeld();
  if (portsHeld) {
    console.log(
      "\nFAIL: a sandbox resource (port) was still held after teardown",
    );
    process.exit(1);
  }

  if (breakName != null) {
    if (violations.length === 0) {
      console.log(
        `\nFAIL (self-check): --break ${breakName} did not report any violation, the check is a dead instrument.`,
      );
      process.exit(1);
    }
    console.log(
      `\nFAIL (expected, --break ${breakName}): ${violations.length} violation(s)`,
    );
    for (const v of violations) console.log(`  ${v}`);
    process.exit(1);
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
  console.error(`mobile-term-101 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
