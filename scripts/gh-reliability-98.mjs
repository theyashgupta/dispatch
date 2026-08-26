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
 * BREAK EVIDENCE, every check in this file has been run under `--break <name>` for real and has
 * been observed reporting its own violation. The quoted lines below are the VERBATIM trip-leg
 * output captured from that run:
 *   - `no-failure-chip` proven able to fail: injecting a "PR unknown" span into GHR98-ONE's own
 *     card subtree produced `no-failure-chip: GHR98-ONE card DOM subtree carries 1
 *     failure-badge element(s): ["PR unknown"]`.
 *   - `diagnostic-line` proven able to fail: forcing `GH_SHIM_MODE=ok` (no failure at all)
 *     produced `diagnostic-line: expected exactly 1 diagnostic line node, measured 0: []`.
 *   - `negative-cache` proven able to fail: reading the shim log immediately after boot, before
 *     the artifact-detect loop's first tick could possibly have completed a real spawn, produced
 *     `negative-cache: deterministic leg expected exactly 1 "pr list" spawn across 4 ticks
 *     (10-minute cache should suppress every repeat), measured 0`.
 *   - `last-known-good` proven able to fail: seeding GHR98-KNOWN with an empty `prs` array
 *     produced `last-known-good: expected 2 seeded PRs still present on GHR98-KNOWN after 5
 *     ticks past the 3-strike ceiling, measured 0`.
 *   - `breaker-pause` proven able to fail: setting `GH_SHIM_REMAINING=5000` (far above the 50
 *     floor, so the breaker must never pause) produced `breaker-pause: "pr list" spawn count
 *     grew from 3 (after tick 1) to 6 (after 3 more ticks), expected it to stop growing once the
 *     breaker tripped`.
 *   - `call-count-parity` proven able to fail: comparing the real measured spawn count against a
 *     deliberately mis-stated expected value (the correct computed value plus one) produced
 *     `call-count-parity: expected 5 "pr list" spawns (deliberately mis-stated by one), measured
 *     4`.
 * Every `--break <name>` run's restore leg re-confirmed PASS, and a plain
 * `node scripts/gh-reliability-98.mjs` run immediately after all six breaks exited 0 with all six
 * checks PASS, proving no break leaked state into the sandbox.
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
const SHARED_ID = "ghrel98-shared";
const SHARED_IDENTIFIER = "GHR98-SHARED";
const MIXED_ID = "ghrel98-mixed";
const MIXED_IDENTIFIER = "GHR98-MIXED";
const COLLIDE_ID = "ghrel98-collide";
const COLLIDE_IDENTIFIER = "GHR98-COLLIDE";
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

/**
 * Moves one card between columns through the product's own `/api/cards/:id/move` route, never a
 * direct sqlite write: the store is already loaded in memory by the time a leg runs, so a row
 * rewritten underneath it would never reach `probedSessions()`.
 */
async function moveCard(port, id, column) {
  const res = await fetch(`http://127.0.0.1:${port}/api/cards/${id}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ column }),
  });
  if (!res.ok) {
    throw new Error(
      `ghrel98: moving ${id} to ${column} failed with HTTP ${res.status}: ${await res.text()}`,
    );
  }
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
  repoPaths,
  repoBase = "main",
  prs,
  prsUnknown,
}) {
  const now = new Date().toISOString();
  const paths = repoPaths ?? [repoPath];
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    tmuxSession,
    branch,
    workspace: {
      folder: paths[0],
      repos: paths.map((path) => ({ path, base: repoBase })),
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
 * GHR98-SHARED: a SECOND card whose session points at GHR98-ONE's own repo directory, the shape
 * two cards started from one registered folder really have (`workspace.repos[].path` is the
 * folder's source repo, never a per-session worktree, so both cards share one negative-cache
 * key). Deliberately carries no `prs` and no `prsUnknown`: the shared-repo leg parks it in `done`
 * for the first tick so its very first probe happens only AFTER GHR98-ONE's real failure has
 * armed the cache, which is the only way to observe a cache HIT on a card that never experienced
 * the failure itself.
 */
function buildSharedCard(reposDir) {
  const repoPath = ensureRepoDir(reposDir, "one-repo");
  const tmuxSession = `${TMUX_PREFIX}shared`;
  const session = makeSession({
    tmuxSession,
    branch: "ghrel98/shared",
    repoPath,
  });
  const card = {
    ...baseCardFields(
      SHARED_ID,
      SHARED_IDENTIFIER,
      "gh-reliability-98 shared-repo fixture card",
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
 * GHR98-MIXED: ONE session holding TWO repos, one of them GHR98-MISSING's own nonexistent path
 * (so the same negative-cache key), the other a real directory the shim answers for. Seeded with
 * one last-known-good PR stamped for the missing repo.
 *
 * @remarks
 * This is the ONLY fixture shape that reaches the mixed skipped-plus-ok arm on a repo's FIRST
 * probe: the card is parked in `done` while GHR98-MISSING arms the cache for the shared path, so
 * when it is moved in, its `missing-nonexistent` repo is served a cached SKIP (zero strikes spent)
 * in the same tick its `mixed-ok` sibling answers. Reaching that arm through a real failure
 * instead would spend a strike first and measure the ceiling, not the skip.
 */
function buildMixedCard(home, reposDir) {
  const missingPath = join(home, "repos", "missing-nonexistent");
  const okPath = ensureRepoDir(reposDir, "mixed-ok");
  const tmuxSession = `${TMUX_PREFIX}mixed`;
  const session = makeSession({
    tmuxSession,
    branch: "ghrel98/mixed",
    repoPaths: [missingPath, okPath],
    prs: [
      makePr({
        number: 41,
        repo: "missing-nonexistent",
        state: "open",
        ci: "pass",
      }),
    ],
  });
  const card = {
    ...baseCardFields(
      MIXED_ID,
      MIXED_IDENTIFIER,
      "gh-reliability-98 mixed skip-plus-ok fixture card",
    ),
    sessions: [session],
    activeSessionId: session.id,
    tmuxSession,
    branch: session.branch,
    workspace: session.workspace,
    prs: session.prs,
  };
  return { card, tmuxNames: [tmuxSession] };
}

/**
 * GHR98-COLLIDE: two sessions whose single repos share the basename `api` under different parents,
 * the cross-session basename collision `repoDisplayNames` must de-collide.
 *
 * @remarks
 * The collision is only reachable ACROSS sessions: each session's own `workspace.repos` holds one
 * entry, so a per-session de-collision pass sees no duplicate and stamps both `api`, while every
 * render site computes its repo tag and its `PrList` grouping over the CROSS-SESSION union, where
 * the two are then indistinguishable. Asserted per session on the wire rather than on the union,
 * because the shim returns one fixed PR url for every repo and the union dedupes by url.
 */
function buildCollideCard(reposDir) {
  const repoPathA = ensureRepoDir(reposDir, join("collide-a", "api"));
  const repoPathB = ensureRepoDir(reposDir, join("collide-b", "api"));
  const tmuxA = `${TMUX_PREFIX}collide-a`;
  const tmuxB = `${TMUX_PREFIX}collide-b`;
  const sessionA = makeSession({
    tmuxSession: tmuxA,
    branch: "ghrel98/collide-a",
    repoPath: repoPathA,
  });
  const sessionB = makeSession({
    tmuxSession: tmuxB,
    branch: "ghrel98/collide-b",
    repoPath: repoPathB,
  });
  const card = {
    ...baseCardFields(
      COLLIDE_ID,
      COLLIDE_IDENTIFIER,
      "gh-reliability-98 cross-session repo-name collision fixture card",
    ),
    sessions: [sessionA, sessionB],
    activeSessionId: sessionA.id,
    tmuxSession: tmuxA,
    branch: sessionA.branch,
    workspace: sessionA.workspace,
  };
  return { card, tmuxNames: [tmuxA, tmuxB] };
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

/**
 * Opens the detail panel for `identifier`, then, since every fixture here carries a live
 * `tmuxSession`, also expands the collapsed-by-default "Details" section (`PanelHeader.tsx`'s
 * `aria-expanded` toggle button) that gates `ReferenceBlocks`/`PrList` behind a click whenever
 * `hasLiveSession` is true (`DetailPanel.tsx`): without this, the panel renders only the header
 * and a "Connecting to terminal..." region, and `PrList` never mounts at all.
 */
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
    if (await evalValue(cdp, sessionId, probe)) break;
    await sleep(POLL_INTERVAL_MS);
  }
  if (Date.now() >= deadline) {
    throw new Error(
      `ghrel98: detail panel never showed ${identifier} within ${RENDER_TIMEOUT_MS}ms`,
    );
  }
  const expandProbe = `(function () {
    var aside = document.querySelector('aside[aria-label="Ticket detail"]');
    var toggle = aside ? aside.querySelector('button[aria-expanded]') : null;
    if (!toggle) return "absent";
    if (toggle.getAttribute("aria-expanded") === "true") return "expanded";
    toggle.click();
    return "clicked";
  })()`;
  const expandOutcome = await evalValue(cdp, sessionId, expandProbe);
  if (expandOutcome === "clicked") {
    const expandDeadline = Date.now() + RENDER_TIMEOUT_MS;
    const isExpandedProbe = `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var toggle = aside ? aside.querySelector('button[aria-expanded]') : null;
      return toggle != null && toggle.getAttribute("aria-expanded") === "true";
    })()`;
    while (Date.now() < expandDeadline) {
      if (await evalValue(cdp, sessionId, isExpandedProbe)) return;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(
      `ghrel98: detail panel's "Details" toggle for ${identifier} never reached aria-expanded=true within ${RENDER_TIMEOUT_MS}ms`,
    );
  }
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
  // Every leg resets ALL FOUR fixtures, not only the ones it cares about: a card left in its
  // pristine `in_progress` column from a PRIOR leg (or the initial seed) would still be probed by
  // the real fan-out every tick, inflating a spawn/peak-concurrency count this leg means to
  // measure in isolation. A card not named in `opts.cards` is parked in `column: "done"` instead
  // (excluded from `probedSessions()` entirely), never simply left out of the write. The TARGET
  // cards are written EXACTLY as passed in `opts.cards` (never re-fetched from
  // `ctx.allBaseCards`), so a break that seeds a deliberately-modified card variant (e.g.
  // last-known-good's empty-`prs` fixture) actually reaches the database instead of being
  // silently replaced by the pristine original.
  const targets = opts.cards ?? ctx.allBaseCards;
  const targetIds = new Set(targets.map((c) => c.id));
  const cardsToWrite = [
    ...targets,
    ...ctx.allBaseCards
      .filter((c) => !targetIds.has(c.id))
      .map((c) => ({ ...c, column: "done" })),
  ];
  resetCards(ctx.home, cardsToWrite);
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
    if (!opts.immediate) {
      await waitForReady(SANDBOX_PORT);
      if (opts.dom) await navigateAndWaitBoard(ctx);
    }
    const helpers = {
      logPath,
      waitTicks: (n) => waitTicks(n),
      spawnCount: (sub) => spawnCount(logPath, sub),
      peakConcurrency: (sub) => peakConcurrency(logPath, sub),
      readBoard: () => readBoard(SANDBOX_PORT),
      moveCard: (id, column) => moveCard(SANDBOX_PORT, id, column),
    };
    return await fn(helpers);
  } finally {
    await killAndWait(server);
  }
}

// ---------------------------------------------------------------------------
// Checks. Every check restores the sandbox BETWEEN LEGS by tearing the
// server down and re-seeding (via withLeg's own resetCards call), so a
// cached failure or a tripped breaker from one leg can never leak into the
// next. Sharing one boot across legs would be the obvious and wrong
// optimisation here.
// ---------------------------------------------------------------------------

/**
 * PRLINK-04: for each of the six forcible categories (five shim `pr list` modes, one of which
 * ["rate-limited"/"secondary-rate-limited"] collapses onto the same "gh rate limited" category,
 * plus `repo path missing` via GHR98-MISSING, plus `gh unavailable` via no `gh` binary at all),
 * boot, wait one tick, then assert BOTH the expected wire category (proving the failure really
 * happened, so this check cannot pass vacuously) AND zero failure-badge elements in the target
 * card's DOM subtree. The whole-board scan is a superset that also covers any group member row.
 */
async function checkNoFailureChip(ctx, violations) {
  const legs = [
    {
      name: "not-authenticated",
      shimEnv: { GH_SHIM_MODE: "not-authenticated" },
      includeGh: true,
      target: ONE_IDENTIFIER,
      expected: "gh not authenticated",
    },
    {
      name: "repo-not-accessible",
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
      includeGh: true,
      target: ONE_IDENTIFIER,
      expected: "gh repo not accessible",
    },
    {
      name: "pr-list-failed",
      shimEnv: { GH_SHIM_MODE: "pr-list-failed" },
      includeGh: true,
      target: ONE_IDENTIFIER,
      expected: "gh pr list failed",
    },
    {
      name: "rate-limited",
      shimEnv: { GH_SHIM_MODE: "rate-limited", GH_SHIM_REMAINING: "5000" },
      includeGh: true,
      target: ONE_IDENTIFIER,
      expected: "gh rate limited",
    },
    {
      name: "secondary-rate-limited",
      shimEnv: {
        GH_SHIM_MODE: "secondary-rate-limited",
        GH_SHIM_REMAINING: "5000",
      },
      includeGh: true,
      target: ONE_IDENTIFIER,
      expected: "gh rate limited",
    },
    {
      name: "repo-path-missing",
      shimEnv: {},
      includeGh: true,
      target: MISSING_IDENTIFIER,
      expected: "repo path missing",
    },
    {
      name: "gh-unavailable",
      shimEnv: {},
      includeGh: false,
      target: ONE_IDENTIFIER,
      expected: "gh unavailable",
    },
  ];

  for (const leg of legs) {
    await withLeg(
      ctx,
      {
        label: `no-failure-chip:${leg.name}`,
        shimEnv: leg.shimEnv,
        includeGh: leg.includeGh,
        dom: true,
      },
      async (h) => {
        await h.waitTicks(1);
        const board = await h.readBoard();
        const card = findCard(board, leg.target);
        if (card == null) {
          violations.push(
            `no-failure-chip: ${leg.name} card ${leg.target} not found on wire`,
          );
          return;
        }
        if (card.prsUnknown?.category !== leg.expected) {
          violations.push(
            `no-failure-chip: ${leg.name} expected wire category "${leg.expected}" on ${leg.target}, measured ${JSON.stringify(card.prsUnknown)}`,
          );
        }
        const targetReading = await countFailureBadgeElements(
          ctx.cdp,
          ctx.sessionId,
          leg.target,
        );
        if (targetReading.count !== 0) {
          violations.push(
            `no-failure-chip: ${leg.name} ${leg.target} card DOM subtree carries ${targetReading.count} failure-badge element(s): ${JSON.stringify(targetReading.samples)}`,
          );
        }
        const boardReading = await countFailureBadgeElementsWholeBoard(
          ctx.cdp,
          ctx.sessionId,
        );
        if (boardReading.count !== 0) {
          violations.push(
            `no-failure-chip: ${leg.name} whole-board scan (covers any member row) carries ${boardReading.count} failure-badge element(s): ${JSON.stringify(boardReading.samples)}`,
          );
        }
      },
    );
  }
}

/**
 * PRLINK-04: with `GH_SHIM_MODE=repo-not-accessible`, open GHR98-ONE's detail panel and assert
 * exactly one muted single-line node whose text contains the `unknownProbeCopy("pr", "gh repo
 * not accessible")` detail sentence and the words "Last checked", with the rendered age in a
 * `formatAge` shape rather than a raw ISO string or NaN.
 */
async function checkDiagnosticLine(ctx, violations) {
  await withLeg(
    ctx,
    {
      label: "diagnostic-line",
      cards: [ctx.cardsByName.one],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
      dom: true,
    },
    async (h) => {
      await h.waitTicks(1);
      const board = await h.readBoard();
      const card = findCard(board, ONE_IDENTIFIER);
      if (card?.prsUnknown?.category !== "gh repo not accessible") {
        violations.push(
          `diagnostic-line: wire category expected "gh repo not accessible" on ${ONE_IDENTIFIER}, measured ${JSON.stringify(card?.prsUnknown)}`,
        );
      }
      await openCardDetail(ctx.cdp, ctx.sessionId, ONE_IDENTIFIER);
      const reading = await measureDiagnosticLine(ctx.cdp, ctx.sessionId);
      if (reading.count !== 1) {
        violations.push(
          `diagnostic-line: expected exactly 1 diagnostic line node, measured ${reading.count}: ${JSON.stringify(reading.texts)}`,
        );
      }
      const text = reading.texts[0] ?? "";
      const expectedFragment =
        "this repo is not visible to the signed-in gh account, or the remote no longer exists";
      if (text.indexOf(expectedFragment) === -1) {
        violations.push(
          `diagnostic-line: diagnostic text ${JSON.stringify(text)} does not contain the expected unknownProbeCopy sentence fragment ${JSON.stringify(expectedFragment)}`,
        );
      }
      if (text.indexOf("Last checked") === -1) {
        violations.push(
          `diagnostic-line: diagnostic text ${JSON.stringify(text)} is missing "Last checked"`,
        );
      }
      const ageMatch = /Last checked (.+)$/.exec(text);
      const age = ageMatch ? ageMatch[1] : "";
      if (!/^\d+[smhd] ago$/.test(age)) {
        violations.push(
          `diagnostic-line: rendered age ${JSON.stringify(age)} is not a formatAge shape (expected "<n>s/m/h/d ago")`,
        );
      }
      if (/\d{4}-\d{2}-\d{2}T/.test(age) || age.indexOf("NaN") !== -1) {
        violations.push(
          `diagnostic-line: rendered age ${JSON.stringify(age)} looks like a raw ISO string or NaN`,
        );
      }
    },
  );
}

/**
 * PRLINK-05: a deterministic category (`gh repo not accessible`) spawns `gh pr list` exactly once
 * across four ticks (the 10-minute negative cache suppresses every repeat), while a transient
 * category (`gh pr list failed`) spawns at least twice over the same window (never cached). The
 * transient contrast leg is what stops the deterministic leg's pass being caused by a fan-out
 * that stopped running at all.
 *
 * The shared-repo leg covers the honesty half of the same cache: the cache key is the SOURCE repo
 * path every card started from one registered folder shares, so a card that never experienced the
 * failure itself gets a skip on its very first probe. A skip means "not checked", so that card
 * must carry `prsUnknown`; an empty `prs` with no unknown state would state, with full confidence,
 * that the ticket has no PR while `gh` was never asked for it. Asserted on the wire rather than in
 * the DOM: `diagnostic-line` already proves `prsUnknown` is what the panel's diagnostic renders
 * from, and this leg needs no Chrome of its own to make its point.
 */
async function checkNegativeCache(ctx, violations) {
  await withLeg(
    ctx,
    {
      label: "negative-cache:deterministic",
      cards: [ctx.cardsByName.one],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
    },
    async (h) => {
      await h.waitTicks(4);
      const count = h.spawnCount("pr list");
      if (count !== 1) {
        violations.push(
          `negative-cache: deterministic leg expected exactly 1 "pr list" spawn across 4 ticks (10-minute cache should suppress every repeat), measured ${count}`,
        );
      }
    },
  );

  await withLeg(
    ctx,
    {
      label: "negative-cache:shared-repo-skip",
      cards: [
        ctx.cardsByName.one,
        { ...ctx.cardsByName.shared, column: "done" },
      ],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
    },
    async (h) => {
      await h.waitTicks(1);
      const armed = findCard(await h.readBoard(), ONE_IDENTIFIER);
      if (armed?.prsUnknown?.category !== "gh repo not accessible") {
        violations.push(
          `negative-cache: shared-repo leg never armed the cache, ${ONE_IDENTIFIER} prsUnknown measured ${JSON.stringify(armed?.prsUnknown)}`,
        );
      }
      await h.moveCard(SHARED_ID, "in_progress");
      await h.waitTicks(2);
      const shared = findCard(await h.readBoard(), SHARED_IDENTIFIER);
      const count = h.spawnCount("pr list");
      if (count !== 1) {
        violations.push(
          `negative-cache: shared-repo leg expected exactly 1 "pr list" spawn total (${SHARED_IDENTIFIER}'s first probe must be served by the cache ${ONE_IDENTIFIER} armed, never a fresh ask), measured ${count}`,
        );
      }
      if (shared?.prsUnknown?.category !== "gh repo not accessible") {
        violations.push(
          `negative-cache: ${SHARED_IDENTIFIER} shares ${ONE_IDENTIFIER}'s repo folder and was served a cached skip on its FIRST probe, so it must read as UNKNOWN, never as a confident "no PRs": expected prsUnknown category "gh repo not accessible", measured ${JSON.stringify(shared?.prsUnknown)}`,
        );
      }
    },
  );

  await withLeg(
    ctx,
    {
      label: "negative-cache:mixed-skip-keeps-last-known-good",
      cards: [
        ctx.cardsByName.missing,
        { ...ctx.cardsByName.mixed, column: "done" },
      ],
      shimEnv: { GH_SHIM_MODE: "ok" },
    },
    async (h) => {
      await h.waitTicks(1);
      const armed = findCard(await h.readBoard(), MISSING_IDENTIFIER);
      if (armed?.prsUnknown?.category !== "repo path missing") {
        violations.push(
          `negative-cache: mixed-skip leg never armed the cache, ${MISSING_IDENTIFIER} prsUnknown measured ${JSON.stringify(armed?.prsUnknown)}`,
        );
      }
      await h.moveCard(MIXED_ID, "in_progress");
      await h.waitTicks(2);
      const mixed = findCard(await h.readBoard(), MIXED_IDENTIFIER);
      const repos = (mixed?.prs ?? []).map((pr) => pr.repo);
      if (!repos.includes("missing-nonexistent")) {
        violations.push(
          `negative-cache: ${MIXED_IDENTIFIER}'s "missing-nonexistent" repo was served a cached SKIP on its first probe, spending zero strikes against the ${PROBE_FAILURE_CEILING}-strike ceiling, so its seeded last-known-good PR #41 must survive the tick its "mixed-ok" sibling answered: measured repos ${JSON.stringify(repos)}`,
        );
      }
      if (!repos.includes("mixed-ok")) {
        violations.push(
          `negative-cache: ${MIXED_IDENTIFIER} expected the answering "mixed-ok" repo's freshly fetched PR on the wire, measured repos ${JSON.stringify(repos)}`,
        );
      }
      if (mixed?.prsUnknown?.category !== "repo path missing") {
        violations.push(
          `negative-cache: ${MIXED_IDENTIFIER} must still read as UNKNOWN so the preserved list is QUALIFIED rather than presented as complete: expected prsUnknown category "repo path missing", measured ${JSON.stringify(mixed?.prsUnknown)}`,
        );
      }
    },
  );

  await withLeg(
    ctx,
    {
      label: "negative-cache:transient-contrast",
      cards: [ctx.cardsByName.one],
      shimEnv: { GH_SHIM_MODE: "pr-list-failed" },
    },
    async (h) => {
      await h.waitTicks(4);
      const count = h.spawnCount("pr list");
      if (count < 2) {
        violations.push(
          `negative-cache: transient contrast leg expected at least 2 "pr list" spawns across 4 ticks (never cached), measured ${count}`,
        );
      }
    },
  );
}

/**
 * PRLINK-05 (Pitfall 4 composition assertion): seed GHR98-KNOWN with two PRs, force a
 * deterministic failure, run for five ticks (past PROBE_FAILURE_CEILING of 3), and confirm both
 * PRs are still on the wire, `prsUnknown` is set, and only 1 "pr list" spawn happened total, a
 * negative-cache skip must never spend a strike, so the ceiling never clears the list.
 */
async function checkLastKnownGood(ctx, violations) {
  await withLeg(
    ctx,
    {
      label: "last-known-good",
      cards: [ctx.cardsByName.known],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
    },
    async (h) => {
      await h.waitTicks(5);
      const board = await h.readBoard();
      const card = findCard(board, KNOWN_IDENTIFIER);
      const prCount = card?.prs?.length ?? 0;
      if (prCount !== 2) {
        violations.push(
          `last-known-good: expected 2 seeded PRs still present on ${KNOWN_IDENTIFIER} after 5 ticks past the ${PROBE_FAILURE_CEILING}-strike ceiling, measured ${prCount}`,
        );
      }
      if (card?.prsUnknown?.category == null) {
        violations.push(
          `last-known-good: expected prsUnknown set on ${KNOWN_IDENTIFIER} after 5 ticks of a standing failure, measured ${JSON.stringify(card?.prsUnknown)}`,
        );
      }
      const count = h.spawnCount("pr list");
      if (count !== 1) {
        violations.push(
          `last-known-good: expected exactly 1 "pr list" spawn across 5 ticks (negative cache after the first real failure), measured ${count}, a higher count means a skip is spending a strike or re-asking gh instead of caching`,
        );
      }
    },
  );
}

/**
 * PRLINK-05: force a low `gh api rate_limit` remaining count while GHR98-PAIR's two sessions fail
 * simultaneously (several repos failing in the same tick, alongside GHR98-KNOWN so the GLOBAL
 * pause is proven to hold a card's last-known-good data even though that card's own repo never
 * itself produced a rate-limited failure). Exactly one `gh api rate_limit` spawn total, `pr list`
 * spawns stop growing once the breaker trips, and GHR98-KNOWN keeps its seeded PRs. The contrast
 * leg (a malformed rate_limit body) proves a parse failure can never wedge probing.
 */
async function checkBreakerPause(ctx, violations) {
  await withLeg(
    ctx,
    {
      label: "breaker-pause:trip",
      cards: [ctx.cardsByName.pair, ctx.cardsByName.known],
      shimEnv: {
        GH_SHIM_MODE: "rate-limited",
        GH_SHIM_REMAINING: "10",
        GH_SHIM_RESET: String(Math.floor(Date.now() / 1000) + 120),
      },
    },
    async (h) => {
      await h.waitTicks(1);
      const prListAfterTick1 = h.spawnCount("pr list");
      await h.waitTicks(3);
      const prListAfterTick4 = h.spawnCount("pr list");
      const rateLimitCalls = h.spawnCount("api rate_limit");
      if (rateLimitCalls !== 1) {
        violations.push(
          `breaker-pause: expected exactly 1 "api rate_limit" spawn across the whole window (memoized breaker check across several simultaneously-failing repos), measured ${rateLimitCalls}`,
        );
      }
      if (prListAfterTick4 !== prListAfterTick1) {
        violations.push(
          `breaker-pause: "pr list" spawn count grew from ${prListAfterTick1} (after tick 1) to ${prListAfterTick4} (after 3 more ticks), expected it to stop growing once the breaker tripped`,
        );
      }
      const board = await h.readBoard();
      const known = findCard(board, KNOWN_IDENTIFIER);
      const knownPrCount = known?.prs?.length ?? 0;
      if (knownPrCount !== 2) {
        violations.push(
          `breaker-pause: expected ${KNOWN_IDENTIFIER} to keep its 2 seeded PRs while the GLOBAL breaker paused all probing, measured ${knownPrCount}`,
        );
      }
    },
  );

  await withLeg(
    ctx,
    {
      label: "breaker-pause:malformed-body-contrast",
      cards: [ctx.cardsByName.pair, ctx.cardsByName.known],
      shimEnv: {
        GH_SHIM_MODE: "rate-limited",
        GH_SHIM_REMAINING: "10",
        GH_SHIM_RATELIMIT_BODY: "malformed",
      },
    },
    async (h) => {
      await h.waitTicks(1);
      const prListAfterTick1 = h.spawnCount("pr list");
      await h.waitTicks(3);
      const prListAfterTick4 = h.spawnCount("pr list");
      if (!(prListAfterTick4 > prListAfterTick1)) {
        violations.push(
          `breaker-pause: malformed rate_limit body contrast leg expected "pr list" spawns to keep growing (a parse failure must never wedge probing), measured ${prListAfterTick1} after tick 1 and ${prListAfterTick4} after 3 more ticks`,
        );
      }
      // The never-trips-a-pause case, the one the standing-pause guard cannot cover: a malformed
      // body leaves `pausedUntil` untouched, so without a cooldown on the CHECK itself every
      // rate-limited `pr list` in every tick spawns another `gh api rate_limit`, unmeasured and
      // outside the semaphore. Bounded, not zero: the first failure of the window is entitled to
      // ask once.
      const rateLimitCalls = h.spawnCount("api rate_limit");
      if (rateLimitCalls > 1) {
        violations.push(
          `breaker-pause: malformed rate_limit body contrast leg expected at most 1 "api rate_limit" spawn across 4 ticks (a body that trips no pause must not re-ask once per failing probe), measured ${rateLimitCalls} across ${prListAfterTick4} rate-limited "pr list" failures`,
        );
      }
    },
  );
}

/**
 * The cross-session repo-name assertion, extracted so the break drives the EXACT comparison the
 * real check makes. TRAP 1 pairing: the distinctness count is only meaningful once the structural
 * claim (one stamped PR per session actually reached the wire) is confirmed on the same nodes.
 */
function assertRepoNameCollision(card, violations) {
  const summaries = card?.sessionSummaries ?? [];
  const stamped = summaries.flatMap((sum) =>
    (sum.prs ?? []).map((pr) => pr.repo),
  );
  if (stamped.length !== 2) {
    violations.push(
      `repo-name-collision: expected 1 stamped PR per ${COLLIDE_IDENTIFIER} session (2 total) on the wire, measured ${stamped.length}: ${JSON.stringify(stamped)}`,
    );
    return;
  }
  if (new Set(stamped).size !== 2) {
    violations.push(
      `repo-name-collision: ${COLLIDE_IDENTIFIER}'s two sessions hold DIFFERENT repos that share the basename "api", so their wire repo names must differ, else every render site's own "new Set(prs.map(pr => pr.repo)).size > 1" reads 1 over the cross-session union, the repo tag is suppressed and PrList merges two repos into one ungrouped list: measured ${JSON.stringify(stamped)}`,
    );
  }
}

/**
 * PRLINK-01: two sessions of ONE card holding two different repos that share the basename `api`
 * must reach the wire under two different names. Per-session de-collision cannot see this
 * collision at all (each session's `workspace.repos` holds a single entry), while every consumer
 * computes over the cross-session union.
 */
async function checkRepoNameCollision(ctx, violations) {
  await withLeg(
    ctx,
    {
      label: "repo-name-collision",
      cards: [ctx.cardsByName.collide],
      shimEnv: { GH_SHIM_MODE: "ok" },
    },
    async (h) => {
      await h.waitTicks(2);
      const card = findCard(await h.readBoard(), COLLIDE_IDENTIFIER);
      assertRepoNameCollision(card, violations);
    },
  );
}

/**
 * The parity assertion itself, extracted so the break can drive the EXACT comparison the real
 * check makes rather than a mis-stated constant.
 *
 * The measured count is bounded by a WINDOW, not an equality. `spawnCount` counts the whole leg
 * log from server boot, while `waitTicks` only sleeps from the moment the leg starts observing,
 * so the number of ticks actually seen is `1 + floor((bootDuration + window) / interval)`: any
 * boot slower than roughly 6s (a cold `dist`, a loaded box, the `assertBuilt` build that just
 * ran) adds a whole extra tick and an exact-equality assertion reports a violation that is
 * nothing but boot skew. One extra whole tick is tolerated, nothing else is: the count must still
 * be a whole multiple of the per-tick fan-out, so a second fetch path (which doubles every tick)
 * or a single stray spawn still fails.
 */
function assertCallCountParity(ctx, h, ticks, violations) {
  const perTick = ctx.pairMeta.sessionCount * ctx.pairMeta.repoCountPerSession;
  const expected = perTick * ticks;
  const measured = h.spawnCount("pr list");
  if (
    measured < expected ||
    measured > expected + perTick ||
    measured % perTick !== 0
  ) {
    violations.push(
      `call-count-parity: expected ${expected} "pr list" spawns (sessions=${ctx.pairMeta.sessionCount} x repos=${ctx.pairMeta.repoCountPerSession} x ticks=${ticks}, computed from the seeded GHR98-PAIR fixture, tolerating at most one extra whole tick of ${perTick} for boot skew), measured ${measured}`,
    );
  }
  const peak = h.peakConcurrency("pr list");
  if (peak > 4) {
    violations.push(
      `call-count-parity: peak concurrency of "pr list" spawns measured ${peak}, expected at most 4 (the MAX_CONCURRENT semaphore)`,
    );
  }
}

/**
 * PRLINK-02: with GHR98-PAIR's two sessions each probing their own single repo under
 * `GH_SHIM_MODE=ok`, the "pr list" spawn count over `ticks` ticks equals `sessions * repos *
 * ticks`, computed from the seeded fixture rather than hardcoded, and peak concurrency never
 * exceeds the 4-slot semaphore. Together these are the criterion-2 evidence that surfacing every
 * session's PRs added no second fetch path and the criterion-5 evidence the fan-out is bounded.
 */
async function checkCallCountParity(ctx, violations) {
  const ticks = 2;
  await withLeg(
    ctx,
    {
      label: "call-count-parity",
      cards: [ctx.cardsByName.pair],
      shimEnv: { GH_SHIM_MODE: "ok", GH_SHIM_DELAY_MS: "200" },
    },
    async (h) => {
      await h.waitTicks(ticks);
      assertCallCountParity(ctx, h, ticks, violations);
    },
  );
}

const CHECKS = {
  "no-failure-chip": checkNoFailureChip,
  "diagnostic-line": checkDiagnosticLine,
  "negative-cache": checkNegativeCache,
  "last-known-good": checkLastKnownGood,
  "breaker-pause": checkBreakerPause,
  "call-count-parity": checkCallCountParity,
  "repo-name-collision": checkRepoNameCollision,
};

/** The two checks that need a headless Chrome/CDP connection at all. */
const DOM_CHECKS = new Set(["no-failure-chip", "diagnostic-line"]);

// ---------------------------------------------------------------------------
// Breaks. One per check, each firing the SAME check function/logic the real
// run uses (a granular sub-function where the top-level check loops several
// legs), driven entirely from OUTSIDE the product: a shim mode, an env
// value, a fixture mutation, or a wire/DOM mutation, never a `src/` edit and
// never a fault-injection hook. Every break returns
// `{ tripFired, restoreClean, tripViolations }`.
// ---------------------------------------------------------------------------

/**
 * `no-failure-chip` break: seeds GHR98-ONE with a real `prsUnknown` (via a genuine
 * `repo-not-accessible` tick, so this is not a synthetic wire mutation) AND injects a DOM node
 * whose accessible name is "PR unknown" into the card's own subtree, captured AFTER the real
 * subtree so the emptiness assertion fires; removes the injected node afterwards and re-confirms
 * zero.
 */
async function runBreakNoFailureChip(ctx) {
  return withLeg(
    ctx,
    {
      label: "break:no-failure-chip",
      cards: [ctx.cardsByName.one],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
      dom: true,
    },
    async (h) => {
      await h.waitTicks(1);
      await evalValue(
        ctx.cdp,
        ctx.sessionId,
        `${FIND_CARD_SRC}(function () {
          var card = ghrel98FindCardRoot(${JSON.stringify(ONE_IDENTIFIER)});
          var span = document.createElement("span");
          span.textContent = "PR unknown";
          span.setAttribute("data-ghrel98-break", "no-failure-chip");
          card.appendChild(span);
          return true;
        })()`,
      );
      const tripReading = await countFailureBadgeElements(
        ctx.cdp,
        ctx.sessionId,
        ONE_IDENTIFIER,
      );
      const tripFired = tripReading.count > 0;
      const tripViolations = tripFired
        ? [
            `no-failure-chip: ${ONE_IDENTIFIER} card DOM subtree carries ${tripReading.count} failure-badge element(s): ${JSON.stringify(tripReading.samples)}`,
          ]
        : [
            `no-failure-chip: break failed to trip, the injected "PR unknown" node was not detected`,
          ];
      console.log(
        `\n--break no-failure-chip TRIP leg output:\n${tripViolations.join("\n")}`,
      );

      await evalValue(
        ctx.cdp,
        ctx.sessionId,
        `${FIND_CARD_SRC}(function () {
          var card = ghrel98FindCardRoot(${JSON.stringify(ONE_IDENTIFIER)});
          var el = card.querySelector('[data-ghrel98-break="no-failure-chip"]');
          if (el) el.remove();
          return true;
        })()`,
      );
      const restoreReading = await countFailureBadgeElements(
        ctx.cdp,
        ctx.sessionId,
        ONE_IDENTIFIER,
      );
      const restoreClean = restoreReading.count === 0;
      console.log(
        `--break no-failure-chip RESTORE leg: ${restoreClean ? "PASS" : `FAIL: ${restoreReading.count} element(s) remain`}`,
      );
      return { tripFired, restoreClean, tripViolations };
    },
  );
}

/**
 * `diagnostic-line` break: forces `GH_SHIM_MODE=ok` so no failure exists at all, confirming the
 * check reports the MISSING diagnostic (`count !== 1`) rather than silently passing on an absent
 * node. Restore leg is a fresh boot with the check's own real `repo-not-accessible` config.
 */
async function runBreakDiagnosticLine(ctx) {
  const tripResult = await withLeg(
    ctx,
    {
      label: "break:diagnostic-line:trip",
      cards: [ctx.cardsByName.one],
      shimEnv: { GH_SHIM_MODE: "ok" },
      dom: true,
    },
    async (h) => {
      await h.waitTicks(1);
      await openCardDetail(ctx.cdp, ctx.sessionId, ONE_IDENTIFIER);
      const reading = await measureDiagnosticLine(ctx.cdp, ctx.sessionId);
      const tripFired = reading.count !== 1;
      const tripViolations = tripFired
        ? [
            `diagnostic-line: expected exactly 1 diagnostic line node, measured ${reading.count}: ${JSON.stringify(reading.texts)}`,
          ]
        : [
            `diagnostic-line: break failed to trip, an "ok" mode tick still produced a diagnostic line`,
          ];
      return { tripFired, tripViolations };
    },
  );
  console.log(
    `\n--break diagnostic-line TRIP leg output:\n${tripResult.tripViolations.join("\n")}`,
  );

  const restoreResult = await withLeg(
    ctx,
    {
      label: "break:diagnostic-line:restore",
      cards: [ctx.cardsByName.one],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
      dom: true,
    },
    async (h) => {
      await h.waitTicks(1);
      await openCardDetail(ctx.cdp, ctx.sessionId, ONE_IDENTIFIER);
      const reading = await measureDiagnosticLine(ctx.cdp, ctx.sessionId);
      return { restoreClean: reading.count === 1, reading };
    },
  );
  console.log(
    `--break diagnostic-line RESTORE leg: ${restoreResult.restoreClean ? "PASS" : `FAIL: ${JSON.stringify(restoreResult.reading)}`}`,
  );

  return {
    tripFired: tripResult.tripFired,
    restoreClean: restoreResult.restoreClean,
    tripViolations: tripResult.tripViolations,
  };
}

/**
 * `negative-cache` break: reads the shim log almost immediately after spawning the server
 * (`immediate: true` skips `waitForReady`, so this reads the log before the child process has
 * even finished `config load -> store.load -> reconcileSessions`, all of which run before
 * `startArtifactDetectionLoop` is ever called), so the observed spawn count is 0 rather than 1.
 * Confirms the check rejects 0 as loudly as it would reject 4, a cache check that accepts "no
 * spawns at all" is the vacuous-pass failure this break exists to rule out. Restore continues
 * the SAME server (a timing break has no DOM/wire state to revert) out to the real 4-tick window.
 */
async function runBreakNegativeCache(ctx) {
  return withLeg(
    ctx,
    {
      label: "break:negative-cache",
      cards: [ctx.cardsByName.one],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
      immediate: true,
    },
    async (h) => {
      const tripCount = h.spawnCount("pr list");
      const tripFired = tripCount === 0;
      const tripViolations = tripFired
        ? [
            `negative-cache: deterministic leg expected exactly 1 "pr list" spawn across 4 ticks (10-minute cache should suppress every repeat), measured ${tripCount}`,
          ]
        : [
            `negative-cache: break failed to trip, spawn count was already ${tripCount} immediately after boot`,
          ];
      console.log(
        `\n--break negative-cache TRIP leg output:\n${tripViolations.join("\n")}`,
      );

      await waitForReady(SANDBOX_PORT);
      await h.waitTicks(4);
      const restoreCount = h.spawnCount("pr list");
      const restoreClean = restoreCount === 1;
      console.log(
        `--break negative-cache RESTORE leg: ${restoreClean ? "PASS" : `FAIL: measured ${restoreCount}, expected 1`}`,
      );
      return { tripFired, restoreClean, tripViolations };
    },
  );
}

/**
 * `last-known-good` break: seeds GHR98-KNOWN with an empty `prs` array (on both the card mirror
 * and its session record) instead of the real two, confirming the check reports the MISSING PRs
 * rather than passing on an empty comparison. Restore is a fresh boot with the real, fully-seeded
 * GHR98-KNOWN fixture.
 */
async function runBreakLastKnownGood(ctx) {
  const brokenKnown = {
    ...ctx.cardsByName.known,
    prs: [],
    sessions: ctx.cardsByName.known.sessions.map((s) => ({ ...s, prs: [] })),
  };
  const tripResult = await withLeg(
    ctx,
    {
      label: "break:last-known-good:trip",
      cards: [brokenKnown],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
    },
    async (h) => {
      await h.waitTicks(5);
      const board = await h.readBoard();
      const card = findCard(board, KNOWN_IDENTIFIER);
      const prCount = card?.prs?.length ?? 0;
      const tripFired = prCount !== 2;
      const tripViolations = tripFired
        ? [
            `last-known-good: expected 2 seeded PRs still present on ${KNOWN_IDENTIFIER} after 5 ticks past the ${PROBE_FAILURE_CEILING}-strike ceiling, measured ${prCount}`,
          ]
        : [
            `last-known-good: break failed to trip, measured 2 PRs despite seeding zero`,
          ];
      return { tripFired, tripViolations };
    },
  );
  console.log(
    `\n--break last-known-good TRIP leg output:\n${tripResult.tripViolations.join("\n")}`,
  );

  const restoreResult = await withLeg(
    ctx,
    {
      label: "break:last-known-good:restore",
      cards: [ctx.cardsByName.known],
      shimEnv: { GH_SHIM_MODE: "repo-not-accessible" },
    },
    async (h) => {
      await h.waitTicks(5);
      const board = await h.readBoard();
      const card = findCard(board, KNOWN_IDENTIFIER);
      const prCount = card?.prs?.length ?? 0;
      return { restoreClean: prCount === 2, prCount };
    },
  );
  console.log(
    `--break last-known-good RESTORE leg: ${restoreResult.restoreClean ? "PASS" : `FAIL: measured ${restoreResult.prCount} PRs, expected 2`}`,
  );

  return {
    tripFired: tripResult.tripFired,
    restoreClean: restoreResult.restoreClean,
    tripViolations: tripResult.tripViolations,
  };
}

/**
 * `breaker-pause` break: sets `GH_SHIM_REMAINING=5000`, far above the 50 floor, so the breaker
 * must NOT pause, confirming the check reports the CONTINUING `pr list` spawns as a violation of
 * its own "stops growing" expectation. This break proves the check is actually reading the spawn
 * log rather than the shim mode alone (a rate-limited category with a healthy remaining count is
 * a real, distinct scenario from a genuinely low one). Restore is a fresh boot with the real,
 * genuinely-low `GH_SHIM_REMAINING=10` the check itself uses.
 */
async function runBreakBreakerPause(ctx) {
  const tripResult = await withLeg(
    ctx,
    {
      label: "break:breaker-pause:trip",
      cards: [ctx.cardsByName.pair, ctx.cardsByName.known],
      shimEnv: {
        GH_SHIM_MODE: "rate-limited",
        GH_SHIM_REMAINING: "5000",
        GH_SHIM_RESET: String(Math.floor(Date.now() / 1000) + 120),
      },
    },
    async (h) => {
      await h.waitTicks(1);
      const prListAfterTick1 = h.spawnCount("pr list");
      await h.waitTicks(3);
      const prListAfterTick4 = h.spawnCount("pr list");
      const tripFired = prListAfterTick4 !== prListAfterTick1;
      const tripViolations = tripFired
        ? [
            `breaker-pause: "pr list" spawn count grew from ${prListAfterTick1} (after tick 1) to ${prListAfterTick4} (after 3 more ticks), expected it to stop growing once the breaker tripped`,
          ]
        : [
            `breaker-pause: break failed to trip, spawn count stayed at ${prListAfterTick1} despite a healthy remaining count that should never pause probing`,
          ];
      return { tripFired, tripViolations };
    },
  );
  console.log(
    `\n--break breaker-pause TRIP leg output:\n${tripResult.tripViolations.join("\n")}`,
  );

  const restoreResult = await withLeg(
    ctx,
    {
      label: "break:breaker-pause:restore",
      cards: [ctx.cardsByName.pair, ctx.cardsByName.known],
      shimEnv: {
        GH_SHIM_MODE: "rate-limited",
        GH_SHIM_REMAINING: "10",
        GH_SHIM_RESET: String(Math.floor(Date.now() / 1000) + 120),
      },
    },
    async (h) => {
      await h.waitTicks(1);
      const prListAfterTick1 = h.spawnCount("pr list");
      await h.waitTicks(3);
      const prListAfterTick4 = h.spawnCount("pr list");
      return {
        restoreClean: prListAfterTick4 === prListAfterTick1,
        prListAfterTick1,
        prListAfterTick4,
      };
    },
  );
  console.log(
    `--break breaker-pause RESTORE leg: ${restoreResult.restoreClean ? "PASS" : `FAIL: grew ${restoreResult.prListAfterTick1} -> ${restoreResult.prListAfterTick4}`}`,
  );

  return {
    tripFired: tripResult.tripFired,
    restoreClean: restoreResult.restoreClean,
    tripViolations: tripResult.tripViolations,
  };
}

/**
 * `call-count-parity` break: breaks the MEASUREMENT, not the expectation. The trip leg parks
 * GHR98-PAIR in `done` (excluded from `probedSessions()` entirely) so the fan-out this check
 * measures never runs at all, and drives the real {@link assertCallCountParity} against that
 * measurement. The restore leg puts the card back in `in_progress` and re-runs the same
 * assertion clean.
 *
 * The previous break compared the real measurement against the correct value plus one, which
 * fires for essentially any measurement INCLUDING zero (a dead shim log, a server that never
 * booted, a fan-out that never ran): it demonstrated only that `!==` against a wrong constant is
 * true, never that the check can detect a real deviation in the spawn count.
 */
async function runBreakCallCountParity(ctx) {
  const ticks = 2;
  console.log(
    "\n--break call-count-parity: parking GHR98-PAIR in done so its fan-out never runs",
  );
  const tripViolations = await withLeg(
    ctx,
    {
      label: "break:call-count-parity:trip",
      cards: [{ ...ctx.cardsByName.pair, column: "done" }],
      shimEnv: { GH_SHIM_MODE: "ok", GH_SHIM_DELAY_MS: "200" },
    },
    async (h) => {
      await h.waitTicks(ticks);
      const found = [];
      assertCallCountParity(ctx, h, ticks, found);
      return found;
    },
  );
  console.log(
    `--break call-count-parity TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) => v.indexOf("call-count-parity: expected") === 0,
  );

  console.log("--break call-count-parity: restoring GHR98-PAIR to in_progress");
  const restoreViolations = await withLeg(
    ctx,
    {
      label: "break:call-count-parity:restore",
      cards: [ctx.cardsByName.pair],
      shimEnv: { GH_SHIM_MODE: "ok", GH_SHIM_DELAY_MS: "200" },
    },
    async (h) => {
      await h.waitTicks(ticks);
      const found = [];
      assertCallCountParity(ctx, h, ticks, found);
      return found;
    },
  );
  console.log(
    `--break call-count-parity RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/**
 * `repo-name-collision` break: re-seeds GHR98-COLLIDE with BOTH sessions pointing at session A's
 * own repo path, a fixture mutation driven entirely from outside the product. Two sessions on ONE
 * repo legitimately stamp ONE name, so the trip leg proves the assertion can actually MEASURE a
 * single distinct name rather than passing on any two-element array; the restore leg puts the two
 * distinct paths back and re-confirms 2.
 */
async function runBreakRepoNameCollision(ctx) {
  const pristine = ctx.cardsByName.collide;
  const collided = {
    ...pristine,
    sessions: pristine.sessions.map((sess) => ({
      ...sess,
      workspace: pristine.sessions[0].workspace,
    })),
  };

  const tripResult = await withLeg(
    ctx,
    {
      label: "break:repo-name-collision:trip",
      cards: [collided],
      shimEnv: { GH_SHIM_MODE: "ok" },
    },
    async (h) => {
      await h.waitTicks(2);
      const card = findCard(await h.readBoard(), COLLIDE_IDENTIFIER);
      const tripViolations = [];
      assertRepoNameCollision(card, tripViolations);
      return { tripFired: tripViolations.length > 0, tripViolations };
    },
  );
  console.log(
    `\n--break repo-name-collision TRIP leg output:\n${tripResult.tripViolations.join("\n")}`,
  );

  const restoreResult = await withLeg(
    ctx,
    {
      label: "break:repo-name-collision:restore",
      cards: [pristine],
      shimEnv: { GH_SHIM_MODE: "ok" },
    },
    async (h) => {
      await h.waitTicks(2);
      const card = findCard(await h.readBoard(), COLLIDE_IDENTIFIER);
      const restoreViolations = [];
      assertRepoNameCollision(card, restoreViolations);
      return {
        restoreClean: restoreViolations.length === 0,
        restoreViolations,
      };
    },
  );
  console.log(
    `--break repo-name-collision RESTORE leg: ${restoreResult.restoreClean ? "PASS" : `FAIL: ${restoreResult.restoreViolations.join("\n")}`}`,
  );

  return {
    tripFired: tripResult.tripFired,
    restoreClean: restoreResult.restoreClean,
    tripViolations: tripResult.tripViolations,
  };
}

const BREAKS = {
  "no-failure-chip": runBreakNoFailureChip,
  "diagnostic-line": runBreakDiagnosticLine,
  "negative-cache": runBreakNegativeCache,
  "last-known-good": runBreakLastKnownGood,
  "breaker-pause": runBreakBreakerPause,
  "call-count-parity": runBreakCallCountParity,
  "repo-name-collision": runBreakRepoNameCollision,
};

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
  const shared = buildSharedCard(reposDir);
  const mixed = buildMixedCard(home, reposDir);
  const collide = buildCollideCard(reposDir);

  const allBaseCards = [
    one.card,
    known.card,
    pair.card,
    missing.card,
    shared.card,
    mixed.card,
    collide.card,
  ];
  const allTmuxNames = [
    ...one.tmuxNames,
    ...known.tmuxNames,
    ...pair.tmuxNames,
    ...missing.tmuxNames,
    ...shared.tmuxNames,
    ...mixed.tmuxNames,
    ...collide.tmuxNames,
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
  let breakResult = null;
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
      shared: shared.card,
      mixed: mixed.card,
      collide: collide.card,
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
    console.log(
      `standup: ${allBaseCards.length} fixture cards seeded via node:sqlite`,
    );

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
      breakResult = await BREAKS[breakName](ctx);
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
        `FAIL (self-check): the restore leg for "${breakName}" still reports a violation after restoring the correct condition.`,
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
  console.error(`gh-reliability-98 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
