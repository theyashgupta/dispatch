/**
 * Mobile terminal touch/scroll diagnosis instrument (Phase 101, TERM-04, dev/ops tooling, NOT test
 * code): lives outside src/, imports no test framework, asserts nothing via an assertion library,
 * the same category as check-invariants.mjs, session-liveness-v3.mjs and panel-100.mjs.
 *
 * This plan (101-01) builds the FOUNDATION only: a real-tmux/real-ttyd fixture whose pane carries
 * production's alternate_on=1/mouse_any_flag=1 mouse-report state, plus three self-proofs that must
 * hold before any round-trip or latency number produced by a later plan means anything: the emulated
 * coarse pointer really flipped, the emulated touch stream really engaged the real kinetic scroller,
 * and a flick really produced INPUT frames on the real ttyd WebSocket.
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
 *   node scripts/mobile-term-101.mjs --break viewport-fixture     trips assertPaneModes's own "1 1"
 *                                                                  precondition
 *   node scripts/mobile-term-101.mjs --break no-touch-emulation   trips proof A
 *   node scripts/mobile-term-101.mjs --break sub-slop-flick       trips proof B, proof A stays green
 *   node scripts/mobile-term-101.mjs --break wrong-page           trips proof C, names the wrong URL
 *
 * Exit codes: 0 all checks PASS. 1 a safety-envelope refusal, a setup/build error, a check
 * violation, a teardown-verification failure, or the live board.db changing.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
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

    handle.server = bootServer(home, { pathPrefix: handle.pathPrefix });
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
async function waitForPageComplete(
  cdp,
  sessionId,
  expectedUrl,
  timeoutMs = READY_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evalValue(cdp, sessionId, "document.readyState");
    const url = await evalValue(cdp, sessionId, "document.URL");
    if (state === "complete" && url === expectedUrl) return url;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `page did not reach readyState "complete" at ${expectedUrl} within ${timeoutMs}ms`,
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
};

const BREAKS = {
  "viewport-fixture": breakViewportFixture,
  "no-touch-emulation": breakNoTouchEmulation,
  "sub-slop-flick": breakSubSlopFlick,
  "wrong-page": breakWrongPage,
};

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

  await assertNoLiveService();
  await assertSandboxPortsFree();
  assertBuilt();

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
