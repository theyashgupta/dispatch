/**
 * Phase 98 plan 08 server reliability instrument (PRLINK-02/04/05, dev/ops tooling, NOT test
 * code): no test framework, no assertion library, lives outside src/, the same category as
 * panel-92 through panel-98.mjs and session-liveness-v3.mjs. It drives every forcible `gh`
 * failure mode through a REAL sandboxed dispatch server (never a stub of `artifact-detect.ts` or
 * `gh-reliability.ts`) with `scripts/fixtures/gh-shim-98.sh` planted on the child server's own
 * PATH, and proves on the wire (`/api/board`), in the DOM (for the two checks that need it) and
 * in the shim's own bracketed `GH_SHIM_LOG` spawn log that no card ever shows a failure badge,
 * that the detail panel's diagnostic line carries the reason instead, that a deterministic
 * failure is negative-cached (repeat ticks spawn `gh pr list` exactly once), that a transient
 * failure holds last-known-good PR data past the strike ceiling, that the fan-out stays bounded
 * at 4 concurrent spawns, and that a forced-low `gh api rate_limit` pauses every repo's probing
 * globally until reset.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-98.mjs, session-liveness-v3.mjs headers). Booting ANY dispatch server sweeps `ttyd`
 * processes MACHINE-WIDE via `adoptAndSweep`, fingerprinted by argv shape, never by tmux session
 * name or which board.db spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it
 * throws (never warns) if anything answers on :4700, before this script boots any server, spawns
 * any real tmux session, or plants any shim, and there is no override flag.
 *
 * REAL TMUX IS REQUIRED, DELIBERATELY, UNLIKE panel-98.mjs. `probedSessions()`
 * (`artifact-detect.ts`) is a pure projection over persisted fields, but `reconcileSessions()`
 * runs at EVERY boot before that projection is ever read, and it marks any session whose
 * `tmuxSession` is not in a REAL `tmux list-sessions` as lost (clearing the field), for any card
 * outside To Do/Done, exactly the column every fixture here sits in. Without a real, live tmux
 * session behind each fixture's `tmuxSession` name, every fixture would be silently repaired into
 * `sessionLost` at the first boot and the whole PR fan-out this instrument exists to exercise
 * would never run. Each real tmux session here is a trivial `sh -c "while true; do sleep 3600;
 * done"` loop, never `claude`, no worktrees, no repo mutation (the `session-liveness-v3.mjs`
 * precedent), named with a `dsp98r-<pid>-` prefix and torn down in the top-level `finally`,
 * verified via `tmux list-sessions` after kill (a leaked session is a violation, never a silent
 * swallow). No real ttyd is spawned: every fixture session deliberately omits `ttydPort`, so
 * `adoptAndSweep`'s own candidate list is always empty for this harness's own sessions.
 *
 * THE `gh` PATH SHIM NEVER ESCAPES THE SANDBOX (T-98-06). It is copied into a per-run temp
 * sandbox bin directory and prepended ONLY to the CHILD server process's own `env.PATH`;
 * `process.env.PATH` of this harness process is never mutated, and nothing is written outside the
 * per-run temp sandbox. `assertHarnessGhIsReal()` asserts, before and after every run, that this
 * harness's OWN `command -v gh` resolution is not the shim path. The one leg that needs `gh` to be
 * genuinely UNRESOLVABLE (`gh unavailable`) cannot simply omit the shim from a prepended
 * directory, because the REAL `gh` later in the same PATH would still resolve, so
 * {@link buildNoGhPath} builds a full PATH clone that symlinks every OTHER executable from every
 * real PATH directory (so `tmux`/`node`/`sh` etc. keep working) while omitting `gh` specifically,
 * so `gh` is truly unreachable rather than merely unshadowed.
 *
 * Usage:
 *   node scripts/gh-reliability-98.mjs                    all six checks below, exits non-zero
 *                                                          on any violation.
 *   node scripts/gh-reliability-98.mjs --check <name>      one named check only, <name> one of
 *                                                          no-failure-chip | diagnostic-line |
 *                                                          negative-cache | last-known-good |
 *                                                          breaker-pause | call-count-parity.
 *   node scripts/gh-reliability-98.mjs --break <name>      that check's OWN break, driven entirely
 *                                                          from OUTSIDE the product (a shim mode,
 *                                                          an env value, a fixture mutation or a
 *                                                          wire mutation, never a `src/` edit).
 *
 * Exit codes: 0 every requested check PASS (or, under `--break <name>`, the break correctly
 * fired). 1 a live :4700, a failed build, a sandbox safety violation, a shim that leaked onto the
 * harness's own PATH, any violated criterion, a changed real `board.db`, or a sandbox port/tmux
 * session still held after teardown.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
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
/** Two of the six checks (`no-failure-chip`, `diagnostic-line`) read rendered DOM, so this is the
 * full `build`, never `build:server`, a server-only build leaves a stale `dist/web` bundle. */
const BUILD_SCRIPT = "build";

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair in this repo (98-08-PLAN.md's
 * own taken-ports list: 47820/47831/47833/47845/47861..47870, CDP 9358/9359/9366..9372). */
const SANDBOX_PORT = 47871;
const CDP_PORT = 9373;
const SANDBOX_PREFIX = "dispatch-ghrel-98-";
const TMUX_PREFIX = `dsp98r-${process.pid}-`;

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RENDER_TIMEOUT_MS = 15_000;

/** Mirrors `artifact-detect.ts`'s own tick cadence (98-08-PLAN.md interfaces block). */
const ARTIFACT_DETECT_INTERVAL_MS = 10_000;
/** Mirrors `PROBE_FAILURE_CEILING` (`artifact-detect.ts`): a strike count at or above this clears
 * `prs`; the negative-cache legs prove a cached skip never advances this counter. */
const PROBE_FAILURE_CEILING = 3;
/** Mirrors `NEGATIVE_CACHE_TTL_MS` (`gh-reliability.ts`): far longer than any wait window below,
 * so a cache armed on tick 1 is still live for every later tick this harness observes. */
const NEGATIVE_CACHE_TTL_MS = 600_000;
/**
 * How long a leg sleeps to observe exactly `n` tick firings: `(n - 1)` full intervals plus one
 * settle margin, timed to land after tick #n but strictly before tick #(n + 1) would fire (the
 * loop's own first tick fires immediately at boot, not after the first interval). Named so a
 * reader can see the cadence assumption: margin must stay comfortably under
 * {@link ARTIFACT_DETECT_INTERVAL_MS} or an exact-count leg (`call-count-parity`) would
 * intermittently observe one tick too many.
 */
const TICK_SETTLE_MARGIN_MS = 4_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "gh-reliability-98-harness-fake-key-never-real";

const GH_SHIM_SOURCE = join(REPO_ROOT, "scripts", "fixtures", "gh-shim-98.sh");

const ONE_ID = "ghrel98-one";
const ONE_IDENTIFIER = "GHR98-ONE";
const KNOWN_ID = "ghrel98-known";
const KNOWN_IDENTIFIER = "GHR98-KNOWN";
const PAIR_ID = "ghrel98-pair";
const PAIR_IDENTIFIER = "GHR98-PAIR";
const MISSING_ID = "ghrel98-missing";
const MISSING_IDENTIFIER = "GHR98-MISSING";
const TOP_LEVEL_IDENTIFIERS = [
  ONE_IDENTIFIER,
  KNOWN_IDENTIFIER,
  PAIR_IDENTIFIER,
  MISSING_IDENTIFIER,
];

const STUB_CLAUDE_SRC =
  "#!/bin/sh\n" +
  'case " $* " in\n' +
  '  *" --version "*)\n' +
  '    echo "1.0.0 (Claude Code)"\n' +
  "    exit 0\n" +
  "    ;;\n" +
  "esac\n" +
  "echo 'gh-reliability-98 stub claude, deliberately never ready'\n" +
  "while true; do sleep 3600; done\n";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "GHREL98-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real tmux sessions or boot a sandbox server while the user's real " +
        "service is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("GHREL98-LIVE"))
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

let headBuild = null;

/** Unconditional full `build` (web + server), this instrument reads rendered DOM in two of its
 * six checks. Never mtime-gated, matching the `panel-9x.mjs` precedent. */
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
  if (!existsSync(DIST_ENTRY_ABS)) {
    throw new Error(
      `Missing ${DIST_ENTRY_ABS} after a successful \`npm run ${BUILD_SCRIPT}\`.`,
    );
  }
  headBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: built src/ -> dist/ via \`npm run ${BUILD_SCRIPT}\` in ${headBuild.durationMs}ms`,
  );
  return headBuild;
}

/**
 * Build a full PATH-directory clone that symlinks every executable EXCEPT `gh` from every real
 * PATH directory, so `gh unavailable` is genuinely unresolvable rather than merely unshadowed.
 * Required because `tmux` and `gh` commonly live in the SAME directory (both under Homebrew's
 * `bin` on this project's own dev machine, confirmed live): simply excluding any directory that
 * contains a `gh` binary would also remove `tmux`, silently breaking `reconcileSessions()` for
 * every fixture this harness depends on being kept alive by a real tmux session.
 */
function buildNoGhPath(home) {
  const raw = process.env.PATH ?? "";
  const dirs = raw.split(":").filter(Boolean);
  const shadowRoot = join(home, "path-shadow-no-gh");
  const out = [];
  dirs.forEach((dir, i) => {
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      out.push(dir);
      return;
    }
    if (!entries.includes("gh")) {
      out.push(dir);
      return;
    }
    const shadow = join(shadowRoot, `${i}-${basename(dir)}`);
    mkdirSync(shadow, { recursive: true });
    for (const entry of entries) {
      if (entry === "gh") continue;
      try {
        symlinkSync(join(dir, entry), join(shadow, entry));
      } catch {
        // a broken source symlink, a permission error, or a duplicate basename across two real
        // PATH dirs already shadowed by ordering, skip rather than fail the whole clone.
      }
    }
    out.push(shadow);
  });
  return out.join(":");
}

/**
 * Spawn the sandboxed server (`process.execPath` used directly, never the bare string `"node"`,
 * so PATH sanitization for a `gh unavailable` leg can never accidentally break resolving `node`
 * itself). `basePath` defaults to the harness's OWN real PATH (unmodified), the shim in
 * `pathPrefix` shadows a real `gh` by ORDERING alone for every leg except `gh unavailable`, which
 * passes {@link buildNoGhPath}'s clone as `basePath` instead (T-98-06).
 */
function bootServerAt(home, opts = {}) {
  assertBuilt();
  const { pathPrefix, extraEnv, basePath } = opts;
  const base = basePath ?? process.env.PATH ?? "";
  const env = {
    ...process.env,
    ...(extraEnv ?? {}),
    HOME: home,
    NODE_ENV: "production",
    PATH: pathPrefix ? `${pathPrefix}:${base}` : base,
  };
  return spawn(process.execPath, [realpathSync(DIST_ENTRY_ABS)], {
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function writeStubClaudeBinary(binDir) {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "claude"), STUB_CLAUDE_SRC, { mode: 0o755 });
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

/** Minimal raw-CDP-over-WebSocket client (Node global WebSocket/fetch, zero new npm dependency),
 * copied verbatim in shape from `panel-98.mjs`. */
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
        `GHREL98-STALE-PORT: :${port} is already held before this run started, a prior run of ` +
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

/** T-98-06: assert the HARNESS's own shell-visible `gh` is still the real binary, never the
 * shim, the shim only ever rides a CHILD server process's own `env.PATH`. */
function assertHarnessGhIsReal(label) {
  let resolved = "";
  try {
    resolved = execFileSync("sh", ["-c", "command -v gh || true"], {
      encoding: "utf8",
    }).trim();
  } catch {
    resolved = "";
  }
  if (resolved.includes("gh-shim-98") || resolved.includes(SANDBOX_PREFIX)) {
    throw new Error(
      `GHREL98-PATH-LEAK: the harness's own \`gh\` resolution is "${resolved}" (${label}), the shim escaped onto the developer's own PATH.`,
    );
  }
}

/** `tmux new-session -d -s <name> -c <cwd>` running a trivial long-lived shell loop, never
 * `claude`, no worktrees, no repo mutation, matching `session-liveness-v3.mjs`'s own precedent. */
async function tmuxNewSession(name, cwd) {
  await execFileP("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    cwd,
    "sh",
    "-c",
    "while true; do sleep 3600; done",
  ]);
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readLogLines(logPath) {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Counts `start <subcommand> <mode>` lines in a `GH_SHIM_LOG` file, the real subprocess spawn
 * count for that subcommand pair (e.g. `"pr list"`, `"api rate_limit"`) across the whole window. */
function spawnCount(logPath, subcommand) {
  const re = new RegExp(`^start ${escapeRegExp(subcommand)} `);
  return readLogLines(logPath).filter((l) => re.test(l)).length;
}

/** Walks a `GH_SHIM_LOG` file top to bottom tracking the running (starts seen minus ends seen)
 * value, returning its maximum, the real peak concurrency for `subcommand` (or every subcommand,
 * if omitted) across the whole window, no clock or timestamp needed. */
function peakConcurrency(logPath, subcommand) {
  const startRe = subcommand
    ? new RegExp(`^start ${escapeRegExp(subcommand)} `)
    : /^start /;
  const endRe = subcommand
    ? new RegExp(`^end ${escapeRegExp(subcommand)} `)
    : /^end /;
  let running = 0;
  let peak = 0;
  for (const line of readLogLines(logPath)) {
    if (startRe.test(line)) {
      running++;
      if (running > peak) peak = running;
    } else if (endRe.test(line)) {
      running--;
    }
  }
  return peak;
}

async function readBoard(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/board`);
  return res.json();
}

function findCard(board, identifier) {
  return (board?.cards ?? []).find((c) => c.identifier === identifier);
}

/**
 * Sleeps long enough to observe `n` tick firings of the product's own
 * {@link ARTIFACT_DETECT_INTERVAL_MS} cadence, counting from whenever this call starts (the
 * loop's own timer keeps running in the background regardless of when a leg starts observing it).
 */
async function waitTicks(n) {
  const ticks = Math.max(1, n);
  await sleep(
    (ticks - 1) * ARTIFACT_DETECT_INTERVAL_MS + TICK_SETTLE_MARGIN_MS,
  );
}

// ---------------------------------------------------------------------------
// Fixtures. Four cards, each carrying real `tmuxSession`/`branch`/`workspace`
// fields on every session so `probedSessions()` actually fans this card's
// repos out through the real PR probe. Each fixture's own repo directory is
// created for real on disk (`existsSync(repoPath)` is load-bearing in
// `gh.ts`'s own category discrimination), except `GHR98-MISSING`'s, which is
// deliberately never created.
// ---------------------------------------------------------------------------

function ensureRepoDir(reposDir, name) {
  const p = join(reposDir, name);
  mkdirSync(p, { recursive: true });
  return p;
}

function makePr({ number, repo, state, isDraft = false, ci = null, title }) {
  return {
    number,
    url: `https://github.com/acme/${repo}/pull/${number}`,
    title: title ?? `gh-reliability-98 fixture PR #${number} (${repo})`,
    state,
    isDraft,
    ci,
    repo,
  };
}

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

function makeSession({
  tmuxSession,
  branch,
  repoPath,
  repoBase = "main",
  prs,
  prsUnknown,
}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    tmuxSession,
    branch,
    workspace: {
      folder: repoPath,
      repos: [{ path: repoPath, base: repoBase }],
    },
    ...(prs != null ? { prs } : {}),
    ...(prsUnknown != null ? { prsUnknown } : {}),
  };
}

/** GHR98-ONE: one session, one repo, no `prs` yet, the subject of the failure-mode legs. */
function buildOneCard(reposDir) {
  const repoPath = ensureRepoDir(reposDir, "one-repo");
  const tmuxSession = `${TMUX_PREFIX}one`;
  const session = makeSession({ tmuxSession, branch: "ghrel98/one", repoPath });
  const card = {
    ...baseCardFields(
      ONE_ID,
      ONE_IDENTIFIER,
      "gh-reliability-98 single fixture card",
    ),
    sessions: [session],
    activeSessionId: session.id,
    tmuxSession,
    branch: session.branch,
    workspace: session.workspace,
  };
  return { card, tmuxNames: [tmuxSession] };
}

/** GHR98-KNOWN: one session, one repo, a seeded `prs` array of two PRs, the subject of the
 * last-known-good leg. */
function buildKnownCard(reposDir) {
  const repoPath = ensureRepoDir(reposDir, "known-repo");
  const tmuxSession = `${TMUX_PREFIX}known`;
  const prs = [
    makePr({ number: 11, repo: "known-repo", state: "open", ci: "pass" }),
    makePr({ number: 12, repo: "known-repo", state: "merged", ci: null }),
  ];
  const session = makeSession({
    tmuxSession,
    branch: "ghrel98/known",
    repoPath,
    prs,
  });
  const card = {
    ...baseCardFields(
      KNOWN_ID,
      KNOWN_IDENTIFIER,
      "gh-reliability-98 last-known-good fixture card",
    ),
    sessions: [session],
    activeSessionId: session.id,
    tmuxSession,
    branch: session.branch,
    workspace: session.workspace,
    prs,
  };
  return { card, tmuxNames: [tmuxSession] };
}

/** GHR98-PAIR: two sessions, each with its own single-repo workspace, the subject of the
 * call-count parity leg and (paired with GHR98-KNOWN) the breaker-pause leg. */
function buildPairCard(reposDir) {
  const repoPathA = ensureRepoDir(reposDir, "pair-a");
  const repoPathB = ensureRepoDir(reposDir, "pair-b");
  const tmuxA = `${TMUX_PREFIX}pair-a`;
  const tmuxB = `${TMUX_PREFIX}pair-b`;
  const sessionA = makeSession({
    tmuxSession: tmuxA,
    branch: "ghrel98/pair-a",
    repoPath: repoPathA,
  });
  const sessionB = makeSession({
    tmuxSession: tmuxB,
    branch: "ghrel98/pair-b",
    repoPath: repoPathB,
  });
  const card = {
    ...baseCardFields(
      PAIR_ID,
      PAIR_IDENTIFIER,
      "gh-reliability-98 call-count-parity fixture card",
    ),
    sessions: [sessionA, sessionB],
    activeSessionId: sessionA.id,
    tmuxSession: tmuxA,
    branch: sessionA.branch,
    workspace: sessionA.workspace,
  };
  return {
    card,
    tmuxNames: [tmuxA, tmuxB],
    sessionCount: 2,
    repoCountPerSession: 1,
  };
}

/** GHR98-MISSING: one session whose `workspace.repos[0].path` points at a directory that does
 * not exist, forces `repo path missing` with no shim mode involved at all. */
function buildMissingCard(home) {
  const repoPath = join(home, "repos", "missing-nonexistent");
  const tmuxSession = `${TMUX_PREFIX}missing`;
  const session = makeSession({
    tmuxSession,
    branch: "ghrel98/missing",
    repoPath,
  });
  const card = {
    ...baseCardFields(
      MISSING_ID,
      MISSING_IDENTIFIER,
      "gh-reliability-98 repo-path-missing fixture card",
    ),
    sessions: [session],
    activeSessionId: session.id,
    tmuxSession,
    branch: session.branch,
    workspace: session.workspace,
  };
  return { card, tmuxNames: [tmuxSession] };
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93 through panel-98.mjs seeding idiom, never a hand-duplicated schema), kill that boot,
 * then insert every fixture row directly via `node:sqlite` in the same pass. Called exactly once,
 * at harness startup; between-leg resets use the lighter {@link resetCards}, which assumes the
 * schema already exists.
 */
async function seedFixtureCards(home, cards) {
  const dbPath = join(home, ".dispatch", "board.db");
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const warmup = bootServerAt(home, {});
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

/** Between-leg reset: overwrite every given card's row back to its pristine fixture JSON, no
 * warmup boot (the schema already exists after {@link seedFixtureCards}'s first call). This is
 * what makes every leg below independent: a cached failure or a tripped breaker from one leg
 * (in-memory state in `gh-reliability.ts`/`artifact-detect.ts`) can never leak into the next,
 * since the server that held that in-memory state is already dead and the persisted fields it
 * wrote are overwritten before the next one boots. */
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

// ---------------------------------------------------------------------------
// DOM helpers, used only by the two checks that read rendered DOM
// (`no-failure-chip`, `diagnostic-line`). Card lookup mirrors panel-98.mjs's
// own `FIND_CARD_SRC` idiom exactly (generalized from density-91.mjs).
// ---------------------------------------------------------------------------

const FIND_CARD_SRC = `
  function ghrel98FindCardRoot(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("ghrel98: board root #root not found");
    var columns = Array.prototype.slice.call(root.querySelectorAll("[data-column]"));
    var matches = [];
    columns.forEach(function (col) {
      var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
      if (!scrollContainer) return;
      var cardRoots = Array.prototype.filter.call(scrollContainer.children, function (el) {
        return el.tagName === "DIV";
      });
      cardRoots.forEach(function (el) {
        if (el.textContent.indexOf(identifier) !== -1) matches.push(el);
      });
    });
    if (matches.length === 0) throw new Error("ghrel98: card " + identifier + " not found on board");
    if (matches.length > 1) throw new Error("ghrel98: identifier " + identifier + " matched " + matches.length + " card roots");
    return matches[0];
  }
`;

async function waitForBoardRootLoaded(cdp, sessionId, identifiers) {
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const probe = `
    (function () {
      var root = document.getElementById("root");
      if (!root) return false;
      var text = root.textContent;
      return ${JSON.stringify(identifiers)}.every(function (id) { return text.indexOf(id) !== -1; });
    })()
  `;
  while (Date.now() < deadline) {
    try {
      if (await evalValue(cdp, sessionId, probe)) return;
    } catch {
      // page mid-navigation, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `initial board load never rendered every fixture identifier within ${RENDER_TIMEOUT_MS}ms`,
  );
}

async function navigateAndWaitBoard(ctx) {
  await ctx.cdp.send(
    "Page.navigate",
    { url: `http://127.0.0.1:${SANDBOX_PORT}/` },
    ctx.sessionId,
  );
  await waitForBoardRootLoaded(ctx.cdp, ctx.sessionId, TOP_LEVEL_IDENTIFIERS);
}

async function openCardDetail(cdp, sessionId, identifier) {
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}ghrel98FindCardRoot(${JSON.stringify(identifier)}).click()`,
  );
  const probe = `(function () {
    var aside = document.querySelector('aside[aria-label="Ticket detail"]');
    return aside != null && aside.textContent.indexOf(${JSON.stringify(identifier)}) !== -1;
  })()`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `ghrel98: detail panel never showed ${identifier} within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/** Zero leaf elements whose trimmed text starts with "PR unknown" or "PR check incomplete"
 * (`unknownProbeCopy`'s two `signal: "pr"` labels), scoped to one card's own DOM subtree. */
async function countFailureBadgeElements(cdp, sessionId, identifier) {
  const expr = `${FIND_CARD_SRC}(function () {
    var card = ghrel98FindCardRoot(${JSON.stringify(identifier)});
    var all = Array.prototype.slice.call(card.querySelectorAll("*"));
    var hits = all.filter(function (el) {
      if (el.children.length > 0) return false;
      var t = (el.textContent || "").trim();
      return t.indexOf("PR unknown") === 0 || t.indexOf("PR check incomplete") === 0;
    });
    return { count: hits.length, samples: hits.slice(0, 3).map(function (el) { return el.textContent; }) };
  })()`;
  return evalValue(cdp, sessionId, expr);
}

/** Same emptiness scan across the WHOLE board root, a superset that also covers any group
 * member row, see the SUMMARY's documented deviation on why this harness has no dedicated group
 * fixture. */
async function countFailureBadgeElementsWholeBoard(cdp, sessionId) {
  const expr = `(function () {
    var root = document.getElementById("root");
    if (!root) throw new Error("ghrel98: board root #root not found");
    var all = Array.prototype.slice.call(root.querySelectorAll("*"));
    var hits = all.filter(function (el) {
      if (el.children.length > 0) return false;
      var t = (el.textContent || "").trim();
      return t.indexOf("PR unknown") === 0 || t.indexOf("PR check incomplete") === 0;
    });
    return { count: hits.length, samples: hits.slice(0, 5).map(function (el) { return el.textContent; }) };
  })()`;
  return evalValue(cdp, sessionId, expr);
}

/** Every leaf `div` inside the detail panel whose text carries "Last checked", the diagnostic
 * line `PrList.tsx` renders through `<Notice tone="muted">`. */
async function measureDiagnosticLine(cdp, sessionId) {
  const expr = `(function () {
    var aside = document.querySelector('aside[aria-label="Ticket detail"]');
    if (!aside) return { count: 0, texts: [] };
    var all = Array.prototype.slice.call(aside.querySelectorAll("div"));
    var hits = all.filter(function (el) {
      return el.children.length === 0 && (el.textContent || "").indexOf("Last checked") !== -1;
    });
    return { count: hits.length, texts: hits.map(function (el) { return el.textContent; }) };
  })()`;
  return evalValue(cdp, sessionId, expr);
}

// ---------------------------------------------------------------------------
// Leg lifecycle: reset the sandbox's persisted card state, boot a fresh
// server with a per-leg shim env and PATH, run the leg's own callback, then
// tear the server down, so a cached failure or a tripped breaker from one
// leg (in-memory state in `gh-reliability.ts`/`artifact-detect.ts`) can never
// leak into the next. Sharing one boot across legs would be the obvious and
// wrong optimisation here.
// ---------------------------------------------------------------------------

async function withLeg(ctx, opts, fn) {
  const cards = opts.cards ?? ctx.allBaseCards;
  resetCards(ctx.home, cards);
  const logPath = join(ctx.home, `gh-shim-log-${ctx.legCounter++}.txt`);
  writeFileSync(logPath, "");
  const includeGh = opts.includeGh !== false;
  const pathPrefix = includeGh ? ctx.binDirWithGh : ctx.binDirNoGh;
  const basePath = includeGh ? undefined : ctx.noGhPath;
  const env = { ...(opts.shimEnv ?? {}), GH_SHIM_LOG: logPath };
  await waitForPortFree(SANDBOX_PORT);
  const server = bootServerAt(ctx.home, {
    pathPrefix,
    basePath,
    extraEnv: env,
  });
  try {
    await waitForReady(SANDBOX_PORT);
    if (opts.dom) await navigateAndWaitBoard(ctx);
    const helpers = {
      logPath,
      waitTicks: (n) => waitTicks(n),
      spawnCount: (sub) => spawnCount(logPath, sub),
      peakConcurrency: (sub) => peakConcurrency(logPath, sub),
      readBoard: () => readBoard(SANDBOX_PORT),
    };
    return await fn(helpers);
  } finally {
    await killAndWait(server);
  }
}

// ---------------------------------------------------------------------------
// Checks. Task 1 wires every one as a stub, so the boot, the PATH planting,
// the seeding and the teardown are proven working before any assertion logic
// exists. Task 2 replaces each body.
// ---------------------------------------------------------------------------

async function checkNoFailureChip() {
  throw new Error("not implemented");
}

async function checkDiagnosticLine() {
  throw new Error("not implemented");
}

async function checkNegativeCache() {
  throw new Error("not implemented");
}

async function checkLastKnownGood() {
  throw new Error("not implemented");
}

async function checkBreakerPause() {
  throw new Error("not implemented");
}

async function checkCallCountParity() {
  throw new Error("not implemented");
}

const CHECKS = {
  "no-failure-chip": checkNoFailureChip,
  "diagnostic-line": checkDiagnosticLine,
  "negative-cache": checkNegativeCache,
  "last-known-good": checkLastKnownGood,
  "breaker-pause": checkBreakerPause,
  "call-count-parity": checkCallCountParity,
};

/** The two checks that need a headless Chrome/CDP connection at all. */
const DOM_CHECKS = new Set(["no-failure-chip", "diagnostic-line"]);

/** Populated in Task 3: one break function per check, keyed identically to {@link CHECKS}. */
const BREAKS = {};

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
  if (!existsSync(GH_SHIM_SOURCE)) {
    console.error(`missing shim source at ${GH_SHIM_SOURCE}`);
    process.exit(1);
  }

  await assertNoLiveService();
  await assertSandboxPortsFree();
  assertBuilt();
  assertHarnessGhIsReal("before");

  const realBefore = statRealBoardDb();
  console.log(`\nLIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  const reposDir = join(home, "repos");
  mkdirSync(reposDir, { recursive: true });

  const one = buildOneCard(reposDir);
  const known = buildKnownCard(reposDir);
  const pair = buildPairCard(reposDir);
  const missing = buildMissingCard(home);

  const allBaseCards = [one.card, known.card, pair.card, missing.card];
  const allTmuxNames = [
    ...one.tmuxNames,
    ...known.tmuxNames,
    ...pair.tmuxNames,
    ...missing.tmuxNames,
  ];

  const binDirWithGh = join(home, "bin-with-gh");
  const binDirNoGh = join(home, "bin-no-gh");
  writeStubClaudeBinary(binDirWithGh);
  writeStubClaudeBinary(binDirNoGh);
  copyFileSync(GH_SHIM_SOURCE, join(binDirWithGh, "gh"));
  chmodSync(join(binDirWithGh, "gh"), 0o755);
  console.log(`standup: shim planted at ${join(binDirWithGh, "gh")}`);

  const noGhPath = buildNoGhPath(home);
  console.log(
    "standup: no-gh shadow PATH built (gh unreachable, tmux/claude/etc. preserved)",
  );

  const violations = [];
  let chromeChild = null;
  let chromeUserDataDir = null;
  let cdp = null;
  let portsHeld = false;
  const tmuxSpawned = [];

  const ctx = {
    home,
    reposDir,
    binDirWithGh,
    binDirNoGh,
    noGhPath,
    allBaseCards,
    cardsByName: {
      one: one.card,
      known: known.card,
      pair: pair.card,
      missing: missing.card,
    },
    pairMeta: {
      sessionCount: pair.sessionCount,
      repoCountPerSession: pair.repoCountPerSession,
    },
    legCounter: 0,
    cdp: null,
    sessionId: null,
  };

  try {
    for (const name of allTmuxNames) {
      await tmuxNewSession(name, reposDir);
      tmuxSpawned.push(name);
    }
    console.log(
      `standup: ${tmuxSpawned.length} real (fake-workload) tmux sessions live: ${tmuxSpawned.join(", ")}`,
    );

    await seedFixtureCards(home, allBaseCards);
    console.log("standup: four fixture cards seeded via node:sqlite");

    const names =
      breakName != null
        ? [breakName]
        : checkName != null
          ? [checkName]
          : Object.keys(CHECKS);
    const needsChrome = names.some((n) => DOM_CHECKS.has(n));
    if (needsChrome) {
      chromeUserDataDir = join(
        tmpdir(),
        `${SANDBOX_PREFIX}chrome-${process.pid}`,
      );
      chromeChild = spawn(
        findChrome(),
        [
          "--headless=new",
          `--remote-debugging-port=${CDP_PORT}`,
          `--user-data-dir=${chromeUserDataDir}`,
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
      ctx.cdp = cdp;
      ctx.sessionId = sessionId;
      console.log("standup: headless Chrome connected over CDP");
    }

    if (breakName != null) {
      violations.push(`--break ${breakName}: not implemented`);
    } else {
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
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
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
    if (chromeUserDataDir)
      rmSync(chromeUserDataDir, { recursive: true, force: true });
    portsHeld = await checkPortsHeld();
  }

  assertHarnessGhIsReal("after");

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
    console.log(`\nFAIL: --break ${breakName} is not implemented yet`);
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
  console.error(`gh-reliability-98 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
