/**
 * Phase 99 plan 05 server-side instrument (PORT-01, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as gh-reliability-98.mjs
 * and panel-92 through panel-99.mjs. It proves PORT-01 against REAL processes, never a fixture:
 * two live workspaces, two real dev servers on different ports, one bound to `::1` and one bound
 * to `127.0.0.1`, each attributed to its own workspace with no cross attribution, and evidence
 * proving the cwd cross-check genuinely ran (`evidence.source === "cwd"`) rather than merely not
 * having broken the pane-pid walk it sits on top of.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (gh-reliability-98.mjs,
 * panel-92 through panel-99.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes
 * MACHINE-WIDE via `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or
 * which board.db spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never
 * warns) if anything answers on :4700, before this script boots any server or spawns any real
 * tmux session, and there is no override flag.
 *
 * REAL TMUX AND REAL LISTENERS ARE REQUIRED, DELIBERATELY. `reconcileSessions()` runs at every
 * boot and marks any session whose `tmuxSession` is not in a real `tmux list-sessions` as lost,
 * clearing `card.previews` before the board ever paints (the exact dead-instrument trap
 * 99-04-SUMMARY.md already documented once for a fixture-only harness). Each real tmux session
 * here runs a real `node -e` listener directly as the pane's own foreground command, no shell
 * layer, so the pane pid IS the listener's own pid, exactly the pid `panePidsBySession()`
 * discovers and the one the port-scan and cwd-lookup `lsof` calls both resolve against. Sessions
 * are named with a `dsp99p-<pid>-` prefix and torn down in the top-level `finally`, verified via
 * `tmux list-sessions` after kill (a leaked session is a violation, never a silent swallow). No
 * real ttyd is spawned: every fixture session omits `ttydPort`, so `adoptAndSweep`'s own candidate
 * list is always empty for this harness's own sessions.
 *
 * THE SANDBOX NEVER TOUCHES THE REAL BOARD. `HOME` is overridden to a directory under `tmpdir()`
 * carrying the `dispatch-portattr-99-` prefix (`assertSandboxSafe`), and the real
 * `~/.dispatch/board.db` mtime/size are stat'd before and after the whole run and asserted
 * unchanged.
 *
 * THE cwd CROSS-CHECK IS THE LOAD-BEARING SUBJECT OF THIS FILE. The sandbox home lives under
 * `tmpdir()`, which macOS resolves through `/private/...` (99-RESEARCH.md Pitfall 2); the
 * `--break realpath` leg is what proves the `realpathSync` normalization inside `matchWorkspace`
 * is genuinely load-bearing rather than a comparison that could never have failed either way, a
 * check asserting only "the badge appears" would still pass with the cwd cross-check completely
 * dead, because the pane-pid walk alone already attributes the port.
 *
 * BREAK EVIDENCE: recorded once all three break legs have been run for real (see plan Task 3);
 * this header is amended with the verbatim trip-leg output in that commit.
 *
 * Usage:
 *   node scripts/port-attribution-99.mjs                          the port-attribution check,
 *                                                                  exits non-zero on any violation.
 *   node scripts/port-attribution-99.mjs --check port-attribution the same, named explicitly.
 *   node scripts/port-attribution-99.mjs --break <name>            that leg's own break, driven
 *                                                                  entirely from a temporary
 *                                                                  `src/` edit, reverted before
 *                                                                  the run ends. <name> one of
 *                                                                  realpath | combined-lsof |
 *                                                                  cwd-failure-must-not-clear.
 *
 * Exit codes: 0 the requested check PASS (or, under `--break <name>`, the break correctly fired
 * and the restore leg re-passed clean). 1 a live :4700, a failed build, a sandbox safety
 * violation, a violated criterion, a changed real `board.db`, a leaked tmux session or held port,
 * or a leaked `src/` edit.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir, homedir } from "node:os";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY_ABS = join(
  REPO_ROOT,
  "dist",
  "server",
  "bootstrap",
  "index.js",
);
/** Server-only build: this harness never reads DOM, only `/api/board`, so `build:server` (tsc)
 * alone is sufficient and considerably faster than the full `build`, load-bearing here since a
 * break leg rebuilds twice (patch, then revert). */
const BUILD_SCRIPT = "build:server";

/** Distinct from every other scripts/*.mjs sandbox port in this repo (99-05-PLAN.md's own
 * interfaces block: the neighboring panel-98/gh-reliability-98/panel-99 harnesses each already
 * hold their own sandbox port a few values lower). */
const SANDBOX_PORT = 47875;
const SANDBOX_PREFIX = "dispatch-portattr-99-";
const TMUX_PREFIX = `dsp99p-${process.pid}-`;

/** Workspace A's real listener: bound to the IPv6 loopback token. */
const LISTENER_PORT_V6 = 47881;
/** Workspace B's real listener: bound to the IPv4 loopback token. */
const LISTENER_PORT_V4 = 47882;

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;

/** Mirrors `artifact-detect.ts`'s own tick cadence (99-05-PLAN.md interfaces block). */
const ARTIFACT_DETECT_INTERVAL_MS = 10_000;
/** Settle margin added past `(n - 1)` full intervals so an exact-tick-count wait lands after tick
 * #n but strictly before tick #(n + 1), mirrors gh-reliability-98.mjs's own `TICK_SETTLE_MARGIN_MS`. */
const TICK_SETTLE_MARGIN_MS = 4_000;

const FAKE_LINEAR_API_KEY = "port-attribution-99-harness-fake-key-never-real";

const API_ID = "portattr99-api";
const API_IDENTIFIER = "PORTATTR99-API";
const WEB_ID = "portattr99-web";
const WEB_IDENTIFIER = "PORTATTR99-WEB";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PORTATTR99-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real tmux sessions or boot a sandbox server while the user's real " +
        "service is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PORTATTR99-LIVE"))
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

async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
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

async function waitForPortFree(port) {
  const deadline = Date.now() + KILL_TIMEOUT_MS + 5_000;
  while ((await isPortListening(port)) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
  }
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

/** Unconditional `npm run build:server`, never mtime-gated: a break leg calls this twice (patch,
 * then revert) and must never reuse a stale compile. */
function rebuildServer() {
  const startedAt = Date.now();
  try {
    execFileSync("npm", ["run", BUILD_SCRIPT], { cwd: REPO_ROOT, stdio: "pipe" });
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `refusing to proceed, \`npm run ${BUILD_SCRIPT}\` failed, so dist/ does not reflect src/:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY_ABS)) {
    throw new Error(
      `Missing ${DIST_ENTRY_ABS} after a successful \`npm run ${BUILD_SCRIPT}\`.`,
    );
  }
  console.log(
    `build: \`npm run ${BUILD_SCRIPT}\` completed in ${Date.now() - startedAt}ms`,
  );
}

function bootServerAt(home) {
  const env = {
    ...process.env,
    HOME: home,
    NODE_ENV: "production",
  };
  return spawn(process.execPath, [realpathSync(DIST_ENTRY_ABS)], {
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

async function tmuxKillSession(name) {
  try {
    await execFileP("tmux", ["kill-session", "-t", name]);
  } catch {
    // already gone, idempotent teardown
  }
}

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

/** `tmux new-session -d -s <name> -c <cwd> node -e <script>`: the node listener runs directly as
 * the pane's own foreground command, no interposed shell, so `#{pane_pid}` IS the listener's own
 * pid, the exact pid the product's pane-pid walk and cwd lookup both resolve against. */
async function tmuxNewListenerSession(name, cwd, port, host) {
  const script = `require("net").createServer().listen(${port}, ${JSON.stringify(host)})`;
  await execFileP("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    cwd,
    "node",
    "-e",
    script,
  ]);
}

async function getPanePid(name) {
  const { stdout } = await execFileP("tmux", [
    "list-panes",
    "-t",
    name,
    "-F",
    "#{pane_pid}",
  ]);
  const pid = Number(stdout.trim().split("\n")[0]);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(
      `port-attribution-99: could not resolve pane_pid for tmux session ${name}, got ${JSON.stringify(stdout)}`,
    );
  }
  return pid;
}

function connectOnce(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

/** Direct-connect confirmation that a fixture listener is genuinely bound, BEFORE the first
 * detection tick has any chance to run, the acceptance criterion this harness's own standup must
 * satisfy independent of anything the product code reports. */
async function waitForListenerBound(host, port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await connectOnce(host, port, 500)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `port-attribution-99: nothing accepted a connection at ${host}:${port} within ${READY_TIMEOUT_MS}ms`,
  );
}

/**
 * Sleeps long enough to observe `n` tick firings of the product's own
 * `ARTIFACT_DETECT_INTERVAL_MS` cadence, mirroring gh-reliability-98.mjs's own `waitTicks`.
 */
async function waitTicks(n) {
  const ticks = Math.max(1, n);
  await sleep(
    (ticks - 1) * ARTIFACT_DETECT_INTERVAL_MS + TICK_SETTLE_MARGIN_MS,
  );
}

async function readBoard(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/board`);
  return res.json();
}

function findCard(board, identifier) {
  return (board?.cards ?? []).find((c) => c.identifier === identifier);
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

async function checkPortsHeld() {
  try {
    const ports = [SANDBOX_PORT, LISTENER_PORT_V6, LISTENER_PORT_V4];
    const args = ports.flatMap((p) => ["-i", `:${p}`]);
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

async function assertSandboxPortsFree() {
  for (const port of [SANDBOX_PORT, LISTENER_PORT_V6, LISTENER_PORT_V4]) {
    if (await isPortListening(port)) {
      const { stdout } = await execFileP("lsof", [
        "-nP",
        `-iTCP:${port}`,
      ]).catch((err) => ({
        stdout: err.stdout ?? "",
      }));
      throw new Error(
        `PORTATTR99-STALE-PORT: :${port} is already held before this run started, a prior run of ` +
          `this file likely leaked a process. Kill it and confirm the port refuses a connection ` +
          `before rerunning:\n${stdout}`,
      );
    }
  }
}

function readFlag(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Fixtures. Two workspaces, each a real directory tree matching the product
// layout: a workspace folder plus one repo worktree directory under it named
// by the repo basename ("api"/"web"), so `worktreePath(folder, repoPath)`
// resolves to a real directory a real tmux pane's own cwd is set to.
// ---------------------------------------------------------------------------

function baseCardFields(id, identifier, title) {
  return {
    id,
    issueId: `${id}-issue`,
    identifier,
    title,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: new Date().toISOString(),
  };
}

/** No `branch` field: the PR fan-out block in `artifact-detect.ts` is gated on
 * `rec.branch != null`, so omitting it entirely skips that block and this harness never needs a
 * `gh` binary at all. */
function makeSession(tmuxSession, folder, repoPath) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    tmuxSession,
    workspace: { folder, repos: [{ path: repoPath, base: "main" }] },
  };
}

function buildCard(id, identifier, title, tmuxSession, folder, repoPath) {
  const session = makeSession(tmuxSession, folder, repoPath);
  const card = {
    ...baseCardFields(id, identifier, title),
    sessions: [session],
    activeSessionId: session.id,
    tmuxSession,
    workspace: session.workspace,
  };
  return { card, session };
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93 through gh-reliability-98.mjs seeding idiom, never a hand-duplicated schema), kill that
 * boot, then insert both fixture rows directly via `node:sqlite`.
 */
async function seedFixtureCards(home, cards) {
  const dbPath = join(home, ".dispatch", "board.db");
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const warmup = bootServerAt(home);
    try {
      await waitForReady(SANDBOX_PORT);
    } finally {
      await killAndWait(warmup);
    }
    await waitForPortFree(SANDBOX_PORT);
    const db = new DatabaseSync(dbPath);
    try {
      const hasCardsTable =
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
          )
          .get() != null;
      if (!hasCardsTable) {
        console.log(
          `seedFixtureCards: schema not yet created after warmup attempt ${attempt}/${ATTEMPTS}, retrying`,
        );
        continue;
      }
      const insert = db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      );
      for (const card of cards) insert.run(card.id, JSON.stringify(card));
      return;
    } finally {
      db.close();
    }
  }
  throw new Error(
    `seedFixtureCards: sqlite schema never appeared after ${ATTEMPTS} warmup-boot attempts`,
  );
}

/** Between-run reset: overwrite each card's row back to its pristine fixture JSON, no warmup boot
 * (the schema already exists after {@link seedFixtureCards}'s first call). Called before every
 * server boot so a break leg's own prior write can never leak into the next assertion. */
function resetCards(home, cards) {
  const dbPath = join(home, ".dispatch", "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    const insert = db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    );
    for (const card of cards) insert.run(card.id, JSON.stringify(card));
  } finally {
    db.close();
  }
}

/** Reset the sandbox's persisted card state, boot a fresh server, wait for two detection ticks so
 * the cwd cross-check has genuinely run, hand the wire board to `fn`, then tear the server down.
 * Sharing one boot across runs would let a break leg's own write leak into the next assertion. */
async function bootFreshAndAssert(ctx, fn) {
  resetCards(ctx.home, [ctx.apiCard, ctx.webCard]);
  await waitForPortFree(SANDBOX_PORT);
  const server = bootServerAt(ctx.home);
  try {
    await waitForReady(SANDBOX_PORT);
    await waitTicks(2);
    const board = await readBoard(SANDBOX_PORT);
    await fn(board);
  } finally {
    await killAndWait(server);
    await waitForPortFree(SANDBOX_PORT);
  }
}

// ---------------------------------------------------------------------------
// Assertions. `assertPortAttribution` is the full port-attribution check,
// shared verbatim by the CHECK itself and by the `realpath`/`combined-lsof`
// break legs (which run it expecting it to FAIL).
// ---------------------------------------------------------------------------

/** Every string leaf under `previews` (outside the `url` field) must carry no sandbox home path,
 * no `/private`, and no path separator at all: `matchedCwd` is a basename, `source`/`bindAddress`
 * are closed-vocabulary tokens, none of which legitimately contains `/`. */
function scanForLeakedPaths(value, keyPath, home, violations, identifier) {
  if (value == null) return;
  if (typeof value === "string") {
    if (keyPath.endsWith(".url") || keyPath === "url") return;
    if (value.includes(home)) {
      violations.push(
        `port-attribution: no-path-on-wire: ${identifier}.${keyPath} contains the sandbox home path: ${JSON.stringify(value)}`,
      );
    }
    if (value.includes("/private")) {
      violations.push(
        `port-attribution: no-path-on-wire: ${identifier}.${keyPath} contains "/private": ${JSON.stringify(value)}`,
      );
    }
    if (value.includes("/")) {
      violations.push(
        `port-attribution: no-path-on-wire: ${identifier}.${keyPath} contains a path separator outside the url field: ${JSON.stringify(value)}`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) =>
      scanForLeakedPaths(v, `${keyPath}[${i}]`, home, violations, identifier),
    );
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      scanForLeakedPaths(
        v,
        keyPath ? `${keyPath}.${k}` : k,
        home,
        violations,
        identifier,
      );
    }
  }
}

/**
 * Groups 1 and 2 of the port-attribution check: detection (this workspace's own port, and only
 * that port) and no-cross-attribution (the OTHER workspace's port must never appear), asserted as
 * two separately named violations per the plan's own instruction, so a report can distinguish
 * "did not find it" from "found the wrong one".
 */
function assertPortAttributionForCard(ctx, board, violations, spec) {
  const { identifier, expectedPort, otherPort } = spec;
  const card = findCard(board, identifier);
  if (card == null) {
    violations.push(`port-attribution: detection: ${identifier} not found on wire`);
    return;
  }
  const previews = card.previews ?? [];

  if (previews.length !== 1 || previews[0].port !== expectedPort) {
    violations.push(
      `port-attribution: detection: ${identifier} expected exactly one preview on port ${expectedPort}, measured ports ${JSON.stringify(previews.map((p) => p.port))}`,
    );
  }

  if (previews.some((p) => p.port === otherPort)) {
    violations.push(
      `port-attribution: no-cross-attribution: ${identifier} carries port ${otherPort}, which belongs to the OTHER workspace`,
    );
  }
}

async function assertPortAttribution(ctx, board, violations) {
  assertPortAttributionForCard(ctx, board, violations, {
    identifier: API_IDENTIFIER,
    expectedPort: LISTENER_PORT_V6,
    otherPort: LISTENER_PORT_V4,
  });
  assertPortAttributionForCard(ctx, board, violations, {
    identifier: WEB_IDENTIFIER,
    expectedPort: LISTENER_PORT_V4,
    otherPort: LISTENER_PORT_V6,
  });
}

async function checkPortAttribution(ctx, violations) {
  const start = violations.length;
  await bootFreshAndAssert(ctx, async (board) => {
    await assertPortAttribution(ctx, board, violations);
  });
  if (violations.length === start) {
    console.log(
      "port-attribution: PASS, detection and no-cross-attribution confirmed for both PORTATTR99-API and PORTATTR99-WEB",
    );
  }
}

const CHECKS = {
  "port-attribution": checkPortAttribution,
};

const BREAKS = {};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const checkName = readFlag(argv, "--check");
  const breakName = readFlag(argv, "--break");
  if (checkName != null && !(checkName in CHECKS)) {
    console.error(
      `unknown --check "${checkName}", known: ${Object.keys(CHECKS).join(", ")}`,
    );
    process.exit(1);
  }
  if (breakName != null && !(breakName in BREAKS)) {
    console.error(
      `unknown --break "${breakName}", known: ${Object.keys(BREAKS).join(", ")}`,
    );
    process.exit(1);
  }

  await assertNoLiveService();
  await assertSandboxPortsFree();
  rebuildServer();

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  const violations = [];
  const tmuxSpawned = [];
  let portsHeld = false;
  let breakResult = null;

  const workspacesDir = join(home, "workspaces");
  const reposSourceDir = join(home, "repo-sources");
  const folderA = join(workspacesDir, "ws-api");
  const folderB = join(workspacesDir, "ws-web");
  const repoPathA = join(reposSourceDir, "api");
  const repoPathB = join(reposSourceDir, "web");
  const worktreeA = join(folderA, "api");
  const worktreeB = join(folderB, "web");
  mkdirSync(worktreeA, { recursive: true });
  mkdirSync(worktreeB, { recursive: true });

  const tmuxA = `${TMUX_PREFIX}api`;
  const tmuxB = `${TMUX_PREFIX}web`;

  const { card: apiCard } = buildCard(
    API_ID,
    API_IDENTIFIER,
    "port-attribution-99 workspace A (::1)",
    tmuxA,
    folderA,
    repoPathA,
  );
  const { card: webCard } = buildCard(
    WEB_ID,
    WEB_IDENTIFIER,
    "port-attribution-99 workspace B (127.0.0.1)",
    tmuxB,
    folderB,
    repoPathB,
  );

  const ctx = { home, apiCard, webCard, apiPanePid: null, webPanePid: null };

  try {
    await tmuxNewListenerSession(tmuxA, worktreeA, LISTENER_PORT_V6, "::1");
    tmuxSpawned.push(tmuxA);
    await tmuxNewListenerSession(tmuxB, worktreeB, LISTENER_PORT_V4, "127.0.0.1");
    tmuxSpawned.push(tmuxB);
    console.log(
      `standup: 2 real tmux sessions live, each running a real dual-stack listener: ${tmuxSpawned.join(", ")}`,
    );

    ctx.apiPanePid = await getPanePid(tmuxA);
    ctx.webPanePid = await getPanePid(tmuxB);

    await waitForListenerBound("::1", LISTENER_PORT_V6);
    await waitForListenerBound("127.0.0.1", LISTENER_PORT_V4);
    console.log(
      `standup: both fixture listeners genuinely bound (::1:${LISTENER_PORT_V6} pid=${ctx.apiPanePid}, 127.0.0.1:${LISTENER_PORT_V4} pid=${ctx.webPanePid})`,
    );

    await seedFixtureCards(home, [apiCard, webCard]);
    console.log("standup: 2 fixture cards seeded via node:sqlite");

    if (breakName != null) {
      breakResult = await BREAKS[breakName](ctx);
    } else {
      const names = checkName != null ? [checkName] : Object.keys(CHECKS);
      for (const n of names) {
        console.log(`\n=== running check: ${n} ===`);
        const before = violations.length;
        try {
          await CHECKS[n](ctx, violations);
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
    for (const name of tmuxSpawned) await tmuxKillSession(name);
    const stillLive = (await tmuxListSessionNames()).filter((n) =>
      tmuxSpawned.includes(n),
    );
    if (stillLive.length > 0) {
      violations.push(
        `teardown: tmux sessions still present after kill-session: ${stillLive.join(", ")}`,
      );
    }
    rmSync(home, { recursive: true, force: true });
    portsHeld = await checkPortsHeld();
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
        `FAIL (self-check): the trip leg did NOT report the expected result for "${breakName}", the check is a dead instrument.`,
      );
      process.exit(1);
    }
    if (!breakResult.restoreClean) {
      console.log(
        `FAIL (self-check): the restore leg for "${breakName}" still reports a violation after restoring the correct condition.`,
      );
      process.exit(1);
    }
    console.log(
      `PASS (--break ${breakName} self-check): trip leg correctly reported the expected result, restore leg re-passed clean.`,
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
  console.error(
    `port-attribution-99 failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exit(1);
});
