/**
 * Real-tmux / real-ttyd liveness instrument (Phase 91, HOOK-01, dev/ops tooling, NOT test code):
 * imports no test framework, asserts nothing via an assertion library, lives outside src/ — the
 * same category as check-invariants.mjs, migration-diff-v3.mjs, and redaction-capture-v3.mjs. The
 * ROADMAP forbids settling this phase's liveness criteria from store records alone ("a store
 * record alone would make every liveness criterion unfalsifiable, which is precisely the
 * dead-instrument failure v2.9 documented nine times"), so this harness stands up TWO REAL tmux
 * sessions running a trivial long-lived shell loop (never `claude`, no worktrees, no repo
 * mutation) with TWO REAL ttyd processes against a sandboxed `HOME`, seeds one card owning both as
 * `Session` records, boots the production server against that sandbox, and exercises the real
 * hook route over loopback HTTP.
 *
 * SAFETY IS THIS FILE'S FIRST-ORDER CONCERN. `adoptAndSweep` (`ttyd.ts`) fingerprints ttyd by ARGV
 * SHAPE — `ttyd` + `tmux attach`, the `DISPATCH_TTYD_REVISION_5` retained key, or the
 * `-b /sessions/<cardId>/terminal` base path — and NEVER by tmux session name, so a harness ttyd
 * is fingerprint-indistinguishable from the user's live service's ttyd regardless of how
 * distinctly this harness names its own tmux sessions. {@link assertNoLiveService} is therefore
 * the ONLY real protection: it fails closed (throws, never degrades) whenever anything answers on
 * the user's live `:4700`, and it is re-run at the top of every single `--check` invocation, not
 * once per process — every break-proving re-run in this phase's Task 3 gets its own fresh assert.
 * Tmux session names still carry the `dsp91h-<pid>-` prefix (protects the tmux layer only, per
 * 91-VALIDATION.md's amended Safety section) and every spawned process is torn down in a `finally`
 * whose own success is THEN VERIFIED with `lsof`/`tmux list-sessions` — a leaked ttyd is reported
 * as a violation, never silently swallowed.
 *
 * KNOWN, ACCEPTED SIDE EFFECT (T-90-19, same acceptance as migration-diff-v3.mjs's own header):
 * booting the sandbox server runs `reconcileSessions()`, which sweeps `dsp`-fingerprinted ttyd
 * processes MACHINE-WIDE via `adoptAndSweep` — not scoped by HOME. `assertNoLiveService()` is what
 * makes this acceptable: it refuses to run at all while the user's real service could have live
 * ttyd of its own to lose.
 *
 * SANDBOX SAFETY IS SCOPED TO STATE ON DISK PLUS THE `:4700` PROBE, NOT TO EVERY PROCESS ON THE
 * MACHINE. `assertSandboxSafe` enforces the database and the port; `assertNoLiveService` covers
 * the one machine-wide process hazard this harness introduces. Within that scope the guarantee is
 * absolute: every sandbox HOME lives under `os.tmpdir()` with a `dispatch-session-liveness-v3-`
 * basename, the sandbox port is asserted to never be 4700, and the real `~/.dispatch/board.db`'s
 * mtime and size are recorded before this script does anything and again after every `--check` run
 * — a mismatch is a loud non-zero-exit failure, not a warning. This harness never writes to
 * `~/.dispatch/`.
 *
 * The frontend dev-server proxy is never used: it hardcodes its dev-mode targets to the user's
 * real, live dispatch port. This harness only ever boots the production build
 * (`dist/server/bootstrap/index.js`), and COMPILES it first ({@link assertBuilt}) so what it proves
 * is always a property of the current `src/` — a `dist` left over from an earlier commit otherwise
 * reports today's fixes as absent, blaming source that already reads correctly.
 *
 * Usage:
 *   node scripts/session-liveness-v3.mjs --check safety            the fixture-standup/teardown proof
 *   node scripts/session-liveness-v3.mjs --check hook-attribution  the per-session hook POST proof
 *   node scripts/session-liveness-v3.mjs --check liveness          WATCH-01/C2: kill one of two real
 *                                                                   tmux sessions, wait out the real
 *                                                                   3-strike detector, both directions
 *   node scripts/session-liveness-v3.mjs --check reconcile         RECON-01/C3: a live sibling's ttyd
 *                                                                   survives a real backend restart on
 *                                                                   its own port, held by the same PID
 *   node scripts/session-liveness-v3.mjs --check attention          UI-02/C5: any session's NEEDS_INPUT
 *                                                                   marker moves the card, a SIBLING's
 *                                                                   reply cannot clear it, the firing
 *                                                                   session's own reply can
 *   node scripts/session-liveness-v3.mjs --check attention-dead-sibling
 *                                                                   CR-01: the same gate RELEASES once
 *                                                                   the marker-holding sibling is really
 *                                                                   dead — otherwise needs_input is a
 *                                                                   one-way latch nothing can clear
 *   node scripts/session-liveness-v3.mjs --check all               every check, its own fresh fixture(s)
 *
 * `liveness` and `reconcile` each run MORE THAN ONE fixture cycle within a single invocation — a
 * rebuilt fixture per kill direction for `liveness`, a live-restart stage plus a fresh
 * dead-session-before-restart stage for `reconcile` — because each needs to start from BOTH
 * sessions live, independent of any prior direction/stage's own mutation. {@link withFixture} is
 * the shared per-cycle lifecycle every check (old and new) now goes through.
 *
 * Exit codes: 0 all checks PASS. 1 a safety-envelope refusal, a setup/build error, a check
 * violation, a teardown-verification failure, or the live board.db changing.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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

/**
 * The package script {@link assertBuilt} shells out to. Named here rather than spelled as a raw
 * `tsc -p …` invocation so the harness can never compile the server differently from the way the
 * project does — one build command, not two literals that can drift apart.
 */
const BUILD_SERVER_SCRIPT = "build:server";

const SANDBOX_PORT = 47862;
const SANDBOX_PREFIX = "dispatch-session-liveness-v3-";

/**
 * Sole occurrence of the literal `.dispatch` config-directory name in this file — reused both for
 * the sandbox home's own `.dispatch` directory ({@link makeSandboxHome}) and, read-only, to locate
 * the REAL `~/.dispatch/board.db` this harness's before/after mtime+size assertion protects
 * ({@link statRealBoardDb}). A single named constant instead of two independent string literals
 * keeps that reuse visible in one place rather than scattering the config-directory name.
 */
const DISPATCH_DIR_NAME = ".dispatch";

/**
 * Namespaces this run's tmux session names distinctly from the user's own `dsp-*` sessions and from
 * any prior run's names (PID-suffixed). Protects the tmux layer ONLY — see the file header: ttyd's
 * own re-adoption/sweep fingerprint never reads a tmux session name, so this prefix does nothing to
 * make this harness's ttyd distinguishable from the live service's; {@link assertNoLiveService} is
 * the sole real protection at that layer.
 */
const TMUX_PREFIX = `dsp91h-${process.pid}-`;

/**
 * The exact re-adoption fingerprint key `spawnTtyd` (`ttyd.ts`) emits via `-t
 * DISPATCH_TTYD_REVISION_5=1` — without it, boot-time `adoptAndSweep` cannot mark this harness's
 * own ttyd as `compatible` and would sweep it as an unrecognized orphan instead of adopting it.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const TTYD_REVISION_RETAINED_KEY = "DISPATCH_TTYD_REVISION_5";

const FAKE_LINEAR_API_KEY = "session-liveness-v3-harness-fake-key-never-real";

const FIXTURE_CARD_ID = "shl-card";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const PORT_PARSE_TIMEOUT_MS = 10_000;
const LISTEN_POLL_TIMEOUT_MS = 10_000;

/**
 * The liveness sub-check's own poll budget (WATCH-01/C2): the 3-strike detector is
 * `captureFailures >= 3` (`watcher.ts:146`) on a self-rescheduling 2000 ms tick
 * (`watcher.ts:321`), so three consecutive failures trip roughly 4-6s after a real kill, with
 * worst-case tick-boundary jitter adding up to one more full cycle — 20s is a generous ceiling,
 * never a target. {@link LIVENESS_MIN_ELAPSED_MS} is the floor a genuine detector-driven
 * transition cannot beat: a transition observed faster than 4s did not come from the real
 * 2000 ms tick and 3-strike threshold, which this harness must NEVER shorten (the interval is
 * itself part of what the criterion verifies).
 */
const LIVENESS_POLL_INTERVAL_MS = 500;
const LIVENESS_POLL_TIMEOUT_MS = 20_000;
const LIVENESS_MIN_ELAPSED_MS = 4_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fail-closed pre-flight for WR-08 (91-VALIDATION.md's amended Safety section, T-91-20): the
 * machine-wide ttyd sweep this harness's own boot triggers cannot distinguish its ttyd from the
 * user's live service's — argv fingerprinting never reads a tmux session name. A `fetch` that
 * resolves means something answered on the user's real port and this run must refuse outright; only
 * a REJECTED fetch (ECONNREFUSED, the live service confirmed stopped) is the safe path, and the
 * WR-08 error is re-thrown from inside the catch so it is never swallowed. Reused verbatim from
 * `density-91.mjs`'s own WR-08 pattern (91-01-SUMMARY.md) — the load-bearing precedent every later
 * Phase 91 instrument copies — and re-run at the top of every `--check` invocation, not once per
 * process.
 */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "WR-08: a live dispatch service answered on :4700 — refusing to start real tmux/ttyd " +
        "processes while the user's real service is up. The machine-wide ttyd sweep this " +
        "harness's own boot triggers cannot distinguish this harness's ttyd from the live " +
        "service's ttyd by tmux session name alone (adoptAndSweep fingerprints on argv shape).",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("WR-08")) throw err;
  }
}

/**
 * The structural guarantee behind "never touches the user's real board.db or port 4700" (the
 * `migration-diff-v3.mjs` precedent, verbatim four checks): port, real-HOME identity, tmpdir
 * containment, basename prefix. Throws (never silently degrades) if any check fails. PROCESS state
 * is deliberately outside this function's scope — {@link assertNoLiveService} covers that.
 */
function assertSandboxSafe(home) {
  if (SANDBOX_PORT === 4700) {
    throw new Error(
      "SANDBOX_PORT must never equal 4700 — that is the user's live dispatch instance.",
    );
  }
  if (home === homedir()) {
    throw new Error(
      "sandbox home must never equal the real $HOME — refusing to proceed.",
    );
  }
  if (!home.startsWith(tmpdir())) {
    throw new Error(
      `sandbox home ${home} must live under ${tmpdir()} — refusing to proceed.`,
    );
  }
  if (!basename(home).startsWith(SANDBOX_PREFIX)) {
    throw new Error(
      `sandbox home ${home} must have a basename starting with "${SANDBOX_PREFIX}" — refusing to proceed.`,
    );
  }
}

/**
 * Compute, safety-check, and materialize a fresh sandbox `HOME` with a config carrying only a
 * hardcoded, obviously-fake Linear key — this harness seeds cards directly via `node:sqlite`, so it
 * never reads or needs a real key. No process is spawned by this call.
 */
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

/** Poll `GET /api/board` on `port` until it returns 200. */
async function waitForReady(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/board`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // server not listening yet — keep polling
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

/**
 * Boot the harness's own server against `home`. Only ever spawns the production build — the Vite
 * dev proxy hardcodes its dev-mode targets to the user's real, live dispatch port. Stdout/stderr are
 * piped and captured into the returned `logLines` array (never printed unless a check explicitly
 * inspects them) so a check that needs to confirm a specific server-side log line — e.g. the
 * orphan-token refusal a hook-attribution break proves — has something to grep without re-plumbing
 * stdio per call site. SECURITY: this harness's server never logs token values (matches the app's
 * own hook-tokens.ts contract), so capturing full output is safe.
 * @remarks The build precondition is re-asserted here through {@link assertBuilt} rather than by a
 * local `existsSync` copy, so the staleness half can never be enforced at only some of the places
 * that spawn `dist` — this is the function every boot in the file funnels through.
 */
function bootServer(home) {
  assertBuilt();
  const child = spawn("node", [DIST_ENTRY], {
    env: { ...process.env, HOME: home, NODE_ENV: "production" },
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

/**
 * `tmux new-session -d -s <name> -c <cwd>` running a trivial long-lived shell loop — never
 * `claude`, no worktrees, no repo mutation (91-VALIDATION.md's Safety section).
 */
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

/** `tmux kill-session -t <name>`, tolerant of an already-gone session. */
async function tmuxKillSession(name) {
  try {
    await execFileP("tmux", ["kill-session", "-t", name]);
  } catch {
    // already gone — idempotent teardown
  }
}

/** `lsof -nP -iTCP:<port> -sTCP:LISTEN` existence check, tolerant of lsof's non-zero exit on no match. */
async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

/** The repo's `lsof -Fpn` port→PID resolver (`ttyd.ts#pidsListeningOnPorts`), single-port form. */
async function pidsListeningOnPort(port) {
  try {
    const { stdout } = await execFileP("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fpn",
    ]);
    const pids = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) pids.push(Number(line.slice(1)));
    }
    return pids;
  } catch {
    return [];
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

/**
 * Spawn one real ttyd with the EXACT argv `spawnTtyd` (`ttyd.ts`) uses — including the
 * `-t DISPATCH_TTYD_REVISION_5=1` retained key, without which boot-time `adoptAndSweep` cannot mark
 * it `compatible` for re-adoption — and resolve with its kernel-assigned port, parsed from stderr
 * the way the app's own `parsePort` does.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
function spawnTtyd(session, cardId) {
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
        `/sessions/${cardId}/terminal`,
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

/**
 * Insert the fixture card row directly via `node:sqlite` (the `migration-diff-v3.mjs` seeding
 * idiom) and pin `meta.schemaVersion` to `SESSION_SCHEMA_VERSION` (1) so boot runs no entity
 * migration over this hand-built `sessions[]`/`activeSessionId` shape — a warmup boot against the
 * empty sandbox home has already advanced a fresh install's schema version to 1
 * (91-01-SUMMARY.md), so this is a defensive re-assert, not a required correction.
 */
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

/** `{ exists, mtimeMs, size }` for `path`, or an all-null/false shape when it doesn't exist. */
function statFile(path) {
  try {
    const st = statSync(path);
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { exists: false, mtimeMs: null, size: null };
  }
}

function statRealBoardDb() {
  const p = join(homedir(), DISPATCH_DIR_NAME, "board.db");
  return { path: p, ...statFile(p) };
}

function fmtStat(s) {
  return s.exists ? `mtimeMs=${s.mtimeMs} size=${s.size}` : "(absent)";
}

/**
 * No pre-existing harness tmux session and nothing already bound to the sandbox port — a prior
 * run's teardown must have failed silently for either to be true, and this run must not layer on
 * top of a leak rather than surface it.
 */
async function assertPreflightClean() {
  const existing = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(TMUX_PREFIX),
  );
  if (existing.length > 0) {
    throw new Error(
      `refusing to start — tmux sessions already present with prefix "${TMUX_PREFIX}": ${existing.join(", ")}`,
    );
  }
  if (await isPortListening(SANDBOX_PORT)) {
    throw new Error(
      `refusing to start — something is already LISTENING on sandbox port ${SANDBOX_PORT}`,
    );
  }
  console.log(
    `preflight: 0 tmux sessions with prefix "${TMUX_PREFIX}"; port ${SANDBOX_PORT} free`,
  );
}

/**
 * Memoized result of the one server compile per process — see {@link assertBuilt}. `null` until the
 * first call; every later call reuses it, so the many `dist` boots a multi-fixture check performs
 * cost exactly one `tsc` run between them.
 */
let serverBuild = null;

/**
 * Compile the server the harness is about to boot, then confirm the entry point exists.
 *
 * This REPLACES an existence-only precondition that was actively misleading: the harness boots
 * `dist`, never `src` (see {@link bootServer}), so a `dist` predating a source fix reported that
 * fix as absent — a correct source tree failing its own proof, with the violation text blaming
 * store/watcher code that already read correctly. Detecting that by mtime is not sound here:
 * `tsc` leaves an output file untouched when its emitted text is unchanged, so `dist` legitimately
 * holds artifacts months older than the last build, and a comment-only source edit (this codebase
 * is JSDoc-dense) would trip an mtime guard that no rebuild could clear. Compiling unconditionally
 * makes the staleness class structurally impossible rather than merely detectable.
 *
 * `stdio: "pipe"` keeps a clean transcript on success while folding `tsc`'s own diagnostics into
 * the thrown error on failure — a source tree that does not compile must stop the run outright,
 * never fall through to boot the previous build and report its behaviour as today's.
 *
 * The one-line announcement is emitted from the compiling call ONLY, never from the memoized ones:
 * `--check all` funnels six checks and every fixture boot through here, and reprinting the same
 * duration each time would read as six compiles of a suspiciously identical length.
 */
function assertBuilt() {
  if (serverBuild !== null) return serverBuild;
  const startedAt = Date.now();
  try {
    execFileSync("npm", ["run", BUILD_SERVER_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `refusing to run — \`npm run ${BUILD_SERVER_SCRIPT}\` failed, so dist/ does not reflect ` +
        `src/ and any result would describe code you are not running:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `Missing ${DIST_ENTRY} after a successful \`npm run ${BUILD_SERVER_SCRIPT}\` — run \`npm run build\` first.`,
    );
  }
  serverBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: compiled src/ -> dist/ via \`npm run ${BUILD_SERVER_SCRIPT}\` in ${serverBuild.durationMs}ms — every boot below runs current source`,
  );
  return serverBuild;
}

/**
 * Stand up the fixture, mutating `built` incrementally as each real resource comes up so a
 * mid-standup failure still leaves {@link tearDownFixture} enough state to clean up whatever DID
 * start. Order: a warmup boot against the still-cardless sandbox home to create the sqlite schema
 * FIRST, then two real tmux sessions (verified via `tmux list-sessions`), then two real ttyd
 * processes matching the app's exact spawn argv (verified LISTENING via `lsof`), the two-session
 * fixture card seeded directly, then the real boot the checks run against.
 * @remarks The warmup boot MUST precede the ttyd spawns, not follow them — `main()`'s own boot
 * sequence runs `reconcileSessions()` unconditionally, and a warmup boot against a still-empty
 * sandbox (no fixture card exists yet) resolves an EMPTY `sessionsWithTmux()` candidates list, so
 * `adoptAndSweep` would spare nothing and sweep BOTH of this harness's own freshly-spawned,
 * fingerprint-matched ttyd processes as unrecognized orphans before the fixture card seeding step
 * ever runs — empirically confirmed by this task's own `--check safety` proof run, corrected here.
 */
async function standUpFixture(built) {
  const warmup = bootServer(built.home);
  await waitForReady(SANDBOX_PORT);
  await killAndWait(warmup.child);

  built.tmux.a = `${TMUX_PREFIX}a`;
  await tmuxNewSession(built.tmux.a, built.home);
  built.tmux.b = `${TMUX_PREFIX}b`;
  await tmuxNewSession(built.tmux.b, built.home);

  const live = await tmuxListSessionNames();
  if (!live.includes(built.tmux.a) || !live.includes(built.tmux.b)) {
    throw new Error(
      `tmux sessions did not both come up: expected ${built.tmux.a} and ${built.tmux.b}, live=${JSON.stringify(live)}`,
    );
  }
  console.log(`standup: tmux sessions live — ${built.tmux.a}, ${built.tmux.b}`);

  built.ttyd.a = await spawnTtyd(built.tmux.a, built.cardId);
  built.ttyd.b = await spawnTtyd(built.tmux.b, built.cardId);
  await waitForPortListening(built.ttyd.a.port);
  await waitForPortListening(built.ttyd.b.port);
  console.log(
    `standup: ttyd ports LISTENING — a=${built.ttyd.a.port}, b=${built.ttyd.b.port}`,
  );

  const now = new Date().toISOString();
  built.sessionA = { id: randomUUID(), token: randomBytes(32).toString("hex") };
  built.sessionB = { id: randomUUID(), token: randomBytes(32).toString("hex") };

  const sessionARecord = {
    id: built.sessionA.id,
    createdAt: now,
    updatedAt: now,
    tmuxSession: built.tmux.a,
    ttydPort: built.ttyd.a.port,
    hookToken: built.sessionA.token,
    workspacePath: join(built.home, "workspaces", "SHL-1"),
  };
  const sessionBRecord = {
    id: built.sessionB.id,
    createdAt: now,
    updatedAt: now,
    tmuxSession: built.tmux.b,
    ttydPort: built.ttyd.b.port,
    hookToken: built.sessionB.token,
    workspacePath: join(built.home, "workspaces", "SHL-1-sibling"),
  };

  const card = {
    id: built.cardId,
    issueId: `${built.cardId}-issue`,
    identifier: "SHL-1",
    title: "session-liveness-v3 harness fixture card — two real sessions",
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: now,
    sessions: [sessionARecord, sessionBRecord],
    activeSessionId: sessionARecord.id,
    tmuxSession: sessionARecord.tmuxSession,
    ttydPort: sessionARecord.ttydPort,
    hookToken: sessionARecord.hookToken,
    workspacePath: sessionARecord.workspacePath,
  };
  seedFixtureCard(built.home, card);

  built.server = bootServer(built.home);
  await waitForReady(SANDBOX_PORT);
  console.log(`standup: sandbox server ready on :${SANDBOX_PORT}`);
}

/**
 * Unconditional teardown: kill the server, kill both ttyd (falling back to the `lsof`-resolved PID
 * for one that survives its own SIGTERM), kill both tmux sessions, remove the sandbox home — THEN
 * verify each of those actually happened, pushing a violation for anything still present rather
 * than assuming success. Runs against whatever fields `built` has populated, so a fixture that
 * failed partway through standup still gets torn down as far as it got.
 */
async function tearDownFixture(built, violations) {
  await killAndWait(built.server?.child);

  for (const key of ["a", "b"]) {
    const t = built.ttyd[key];
    if (t?.child) {
      try {
        t.child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
  }
  await sleep(300);
  for (const key of ["a", "b"]) {
    const t = built.ttyd[key];
    if (!t) continue;
    if (await isPortListening(t.port)) {
      for (const pid of await pidsListeningOnPort(t.port)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }

  if (built.tmux.a) await tmuxKillSession(built.tmux.a);
  if (built.tmux.b) await tmuxKillSession(built.tmux.b);

  if (built.home && existsSync(built.home)) {
    rmSync(built.home, { recursive: true, force: true });
  }

  const remaining = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(TMUX_PREFIX),
  );
  if (remaining.length > 0) {
    violations.push(
      `teardown: tmux sessions still present after kill-session: ${remaining.join(", ")}`,
    );
  }
  for (const key of ["a", "b"]) {
    const t = built.ttyd[key];
    if (t && (await isPortListening(t.port))) {
      violations.push(
        `teardown: ttyd port ${t.port} (session ${key}) still LISTENING after kill`,
      );
    }
  }
  if (await isPortListening(SANDBOX_PORT)) {
    violations.push(
      `teardown: sandbox port ${SANDBOX_PORT} still LISTENING after server kill`,
    );
  }
  if (built.home && existsSync(built.home)) {
    violations.push(
      `teardown: sandbox home ${built.home} still exists after rmSync`,
    );
  }
}

/**
 * One complete fixture lifecycle: preflight, a fresh sandbox home under `label`, two real tmux
 * sessions, two real ttyd, `fn(built)`, then unconditional-and-verified teardown — regardless of
 * what `fn` returns or throws. Every check in {@link CHECKS} is built on this: `safety` and
 * `hook-attribution` call it exactly once; `liveness` (Task 1) and `reconcile` (Task 2) call it
 * more than once within a single `--check` invocation, because each needs a fixture that starts
 * from BOTH sessions live, independent of any prior direction/stage's own mutation — a rebuilt
 * fixture per kill direction for `liveness`, a live-restart stage plus a fresh
 * dead-session-before-restart stage for `reconcile`. {@link assertPreflightClean} is re-run at
 * the top of every call, not once per `--check` invocation, so a fixture rebuilt mid-check still
 * refuses to layer onto a leak the prior cycle's own teardown left behind.
 */
async function withFixture(label, fn) {
  const violations = [];
  const home = makeSandboxHome(label);
  const built = {
    home,
    cardId: FIXTURE_CARD_ID,
    tmux: {},
    ttyd: {},
    server: null,
    sessionA: null,
    sessionB: null,
    dbPath: join(home, DISPATCH_DIR_NAME, "board.db"),
  };
  try {
    await assertPreflightClean();
    assertBuilt();
    await standUpFixture(built);
    violations.push(...(await fn(built)));
  } catch (err) {
    violations.push(
      `run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
  } finally {
    await tearDownFixture(built, violations);
  }
  return violations;
}

/**
 * Resolve the fixture card exactly as `GET /api/board` — the wire the UI itself consumes —
 * reports it: `redactCard`'s shape, never the store's own in-memory `Card`. A non-active
 * sibling's own fields are therefore NEVER visible here (`redactCard` strips `sessions` and
 * projects only `activeSession`); the `liveness` sub-check's non-active kill direction reads the
 * persisted record directly for that reason. Tolerant of a transient fetch failure (a dropped
 * connection mid-poll) — resolves `undefined` rather than throwing, so a long poll loop degrades
 * to "not yet observed" instead of crashing the check.
 */
async function fetchFixtureCard(cardId) {
  try {
    const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/board`);
    const body = await res.json();
    const cards = Array.isArray(body?.cards) ? body.cards : [];
    return cards.find((c) => c.id === cardId);
  } catch {
    return undefined;
  }
}

/**
 * Kill the sandbox server and boot it again against the SAME sandbox home — tmux and ttyd are
 * left untouched by this call, so it is a backend-only restart. Reused by both `reconcile`
 * stages (Task 2): a live restart (stage 1, both sessions still live) and a restart with one
 * session already dead (stage 2). `bootServer` always re-captures fresh `logLines`, so a stage
 * that greps the post-restart `[reconcile]` boot line never sees a pre-restart line by accident.
 */
async function restartServer(built) {
  await killAndWait(built.server?.child);
  built.server = bootServer(built.home);
  await waitForReady(SANDBOX_PORT);
}

/**
 * The scaffolding's own falsifiable subject (Task 1): both real tmux sessions appear in
 * `tmux list-sessions`, both real ttyd ports are confirmed LISTENING via `lsof`. No hook traffic,
 * no persisted-state assertions — those belong to the `hook-attribution` check.
 */
async function checkSafety(built) {
  const violations = [];
  const live = (await tmuxListSessionNames()).filter((n) =>
    n.startsWith(TMUX_PREFIX),
  );
  console.log(
    `safety: tmux sessions live with our prefix = ${JSON.stringify(live)}`,
  );
  if (!live.includes(built.tmux.a)) {
    violations.push(
      `tmux session ${built.tmux.a} not found in tmux list-sessions`,
    );
  }
  if (!live.includes(built.tmux.b)) {
    violations.push(
      `tmux session ${built.tmux.b} not found in tmux list-sessions`,
    );
  }
  const aListening = await isPortListening(built.ttyd.a.port);
  const bListening = await isPortListening(built.ttyd.b.port);
  console.log(
    `safety: ttyd A port=${built.ttyd.a.port} listening=${aListening}`,
  );
  console.log(
    `safety: ttyd B port=${built.ttyd.b.port} listening=${bListening}`,
  );
  if (!aListening) {
    violations.push(`ttyd port ${built.ttyd.a.port} (session A) not LISTENING`);
  }
  if (!bListening) {
    violations.push(`ttyd port ${built.ttyd.b.port} (session B) not LISTENING`);
  }
  return violations;
}

/** The exact `DISPATCH_STATUS: NEEDS_INPUT — <reason>` Stop-payload text `parse.ts#MARKER_RE` matches. */
function stopBodyWithReason(reason) {
  return {
    hook_event_name: "Stop",
    last_assistant_message: `⏺ DISPATCH_STATUS: NEEDS_INPUT — ${reason}`,
  };
}

/** POST `body` to the sandbox's `/api/hook/claude` route carrying `token`, returning the response status. */
async function postHook(token, body) {
  const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/hook/claude`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dispatch-token": token,
    },
    body: JSON.stringify(body),
  });
  await res.body?.cancel().catch(() => {});
  return res.status;
}

/**
 * POST a `UserPromptSubmit` hook event through `token` — the exact event `applyPromptSubmit`
 * (`hook-events.ts:171`) maps onto `store.flipBack`, driving the cross-session gate this file's
 * `--check attention` proves. No message body is required: `applyPromptSubmit` binds only on the
 * event name plus the token-resolved session identity, never on payload text.
 */
async function postPromptSubmit(token) {
  const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/hook/claude`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dispatch-token": token,
    },
    body: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
  });
  await res.body?.cancel().catch(() => {});
  return res.status;
}

/** Read one persisted card row via a FRESH `readOnly: true` node:sqlite connection, or `undefined`. */
function readCard(dbPath, cardId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT data FROM cards WHERE id = ?").get(cardId);
    return row ? JSON.parse(row.data) : undefined;
  } finally {
    db.close();
  }
}

/**
 * Per-session hook attribution proof (Task 2, HOOK-01): POST a NEEDS_INPUT Stop marker carrying a
 * reason unique to EACH real session's own token, POST once more with a token that was never
 * minted, then kill the server and re-read the persisted card through a fresh `readOnly: true`
 * connection — never through the still-live process — and assert against the PERSISTED session
 * records, KEYED BY SESSION ID, never by array position or "two distinct markers exist somewhere
 * on this card": {@link expectedReasonBySessionId} is an explicit session-id-keyed map so the
 * assertion is always "THIS session got THIS marker".
 * @remarks A mismatch is annotated with a cross-attribution note when the actual value equals a
 * SIBLING session's expected value — the exact shape Task 3's Break A (mis-registration against
 * `card.activeSessionId`) and Break B (a swapped expectation table) both need surfaced plainly.
 */
async function checkHookAttribution(built) {
  const violations = [];
  const reasonA = "reason-unique-to-session-A";
  const reasonB = "reason-unique-to-session-B";

  const statusA = await postHook(
    built.sessionA.token,
    stopBodyWithReason(reasonA),
  );
  console.log(
    `hook-attribution: POST session ${built.sessionA.id} (token A) -> ${statusA} (expected 204)`,
  );
  if (statusA !== 204) {
    violations.push(
      `session ${built.sessionA.id}: POST with its own token returned ${statusA}, expected 204`,
    );
  }

  const statusB = await postHook(
    built.sessionB.token,
    stopBodyWithReason(reasonB),
  );
  console.log(
    `hook-attribution: POST session ${built.sessionB.id} (token B) -> ${statusB} (expected 204)`,
  );
  if (statusB !== 204) {
    violations.push(
      `session ${built.sessionB.id}: POST with its own token returned ${statusB}, expected 204`,
    );
  }

  const unmintedToken = randomBytes(32).toString("hex");
  const statusUnminted = await postHook(
    unmintedToken,
    stopBodyWithReason("reason-never-attributed"),
  );
  console.log(
    `hook-attribution: POST an unminted token -> ${statusUnminted} (expected 401)`,
  );
  if (statusUnminted !== 401) {
    violations.push(
      `unminted token: POST returned ${statusUnminted}, expected 401`,
    );
  }

  await killAndWait(built.server?.child);
  const card = readCard(built.dbPath, built.cardId);
  if (!card) {
    violations.push(
      `card ${built.cardId} missing from persisted board.db after kill`,
    );
    return violations;
  }

  const sessions = Array.isArray(card.sessions) ? card.sessions : [];
  console.log(
    `hook-attribution: persisted session count = ${sessions.length} (expected 2)`,
  );
  if (sessions.length !== 2) {
    violations.push(
      `card ${built.cardId}: expected exactly 2 persisted session records, found ${sessions.length}`,
    );
  }

  const expectedReasonBySessionId = new Map([
    [built.sessionA.id, reasonA],
    [built.sessionB.id, reasonB],
  ]);

  for (const [sessionId, expectedReason] of expectedReasonBySessionId) {
    const expectedMarkerKey = `NEEDS_INPUT ${expectedReason}`;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      violations.push(
        `session ${sessionId}: not found in persisted sessions[]`,
      );
      continue;
    }
    const actualMarker = session.lastMarker;
    if (actualMarker === expectedMarkerKey) {
      console.log(
        `hook-attribution: PASS session ${sessionId} lastMarker = "${actualMarker}"`,
      );
    } else {
      const crossMatch = [...expectedReasonBySessionId.entries()].find(
        ([otherId, otherReason]) =>
          otherId !== sessionId &&
          actualMarker === `NEEDS_INPUT ${otherReason}`,
      );
      const crossNote = crossMatch
        ? ` — matches session ${crossMatch[0]}'s expected marker instead (cross-attribution)`
        : "";
      violations.push(
        `session ${sessionId}: lastMarker expected "${expectedMarkerKey}", actual "${actualMarker}"${crossNote}`,
      );
    }
    if (session.hookRoutedAt == null) {
      violations.push(
        `session ${sessionId}: hookRoutedAt is undefined, expected a timestamp`,
      );
    } else {
      console.log(
        `hook-attribution: PASS session ${sessionId} hookRoutedAt = "${session.hookRoutedAt}"`,
      );
    }
  }

  if (
    typeof card.activeSessionId !== "string" ||
    !sessions.some((s) => s.id === card.activeSessionId)
  ) {
    violations.push(
      `card ${built.cardId}: activeSessionId "${card.activeSessionId}" does not name a persisted session`,
    );
  } else {
    console.log(
      `hook-attribution: PASS activeSessionId "${card.activeSessionId}" still names a persisted session`,
    );
  }

  const hooksLogLines = (built.server?.logLines ?? []).filter((l) =>
    l.includes("[hooks]"),
  );
  for (const line of hooksLogLines) {
    console.log(`hook-attribution: server log: ${line}`);
  }

  return violations;
}

/**
 * One kill direction of the real-detector liveness proof (WATCH-01/C2, Task 1). Kills exactly
 * ONE real tmux session by name and polls — this file never calls the store's own per-session
 * lost-clearing method directly and never imports the store, so the ONLY thing that can ever
 * clear a session's fields here is the real 3-strike capture-failure detector on its real
 * self-rescheduling tick. Samples the wire's `sessionLost` on EVERY poll — not only the terminal
 * read — so a transient `true` is a violation even when the final read looks clean.
 * @remarks `kind === "active"` kills the card's ACTIVE session (A) and polls the WIRE for the
 * promotion (`activeSession.tmuxSession` becoming B's) — the wire is enough because the
 * promoted-to session is, by definition, the new active one. `kind === "sibling"` kills the
 * NON-active session (B) and polls the PERSISTED record directly instead, because the wire's
 * `redactCard` projection never exposes a non-active session's own fields — the active pointer
 * never moves in this direction, so there is no wire signal to poll for a clear.
 * @remarks On a timeout (the detector never fired within the poll budget), this still falls
 * through to the final persisted-state assertions below rather than returning early — a
 * regression that clears the WRONG session's fields (Task 3's Break A) needs those assertions to
 * run so the report names which session's fields actually disappeared, not just "timed out".
 */
async function checkLivenessDirection(kind) {
  return withFixture(`liveness-${kind}`, async (built) => {
    const violations = [];
    const dying = kind === "active" ? built.sessionA : built.sessionB;
    const surviving = kind === "active" ? built.sessionB : built.sessionA;
    const dyingTmux = kind === "active" ? built.tmux.a : built.tmux.b;
    const survivingTmux = kind === "active" ? built.tmux.b : built.tmux.a;

    const start = Date.now();
    await tmuxKillSession(dyingTmux);
    console.log(
      `liveness (${kind}): killed real tmux session ${dyingTmux} (session ${dying.id}) — waiting for the real 3-strike detector`,
    );

    let sawSessionLostTrue = false;
    let lastWireCard;
    let transitioned = false;
    const deadline = Date.now() + LIVENESS_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      lastWireCard = await fetchFixtureCard(built.cardId);
      if (lastWireCard?.sessionLost === true) sawSessionLostTrue = true;
      if (kind === "active") {
        transitioned =
          lastWireCard?.activeSession?.tmuxSession === survivingTmux;
      } else {
        let persisted;
        try {
          persisted = readCard(built.dbPath, built.cardId);
        } catch {
          persisted = undefined;
        }
        const target = persisted?.sessions?.find((s) => s.id === dying.id);
        transitioned = target != null && target.tmuxSession == null;
      }
      if (transitioned) break;
      await sleep(LIVENESS_POLL_INTERVAL_MS);
    }
    const elapsedMs = Date.now() - start;
    console.log(
      `liveness (${kind}): transitioned=${transitioned} elapsedMs=${elapsedMs}`,
    );

    if (!transitioned) {
      violations.push(
        `liveness (${kind}): the real 3-strike detector did not clear session ${dying.id} within ${LIVENESS_POLL_TIMEOUT_MS}ms`,
      );
    } else if (elapsedMs < LIVENESS_MIN_ELAPSED_MS) {
      violations.push(
        `liveness (${kind}): transition observed after only ${elapsedMs}ms — faster than the real 2000ms tick / 3-strike detector could ` +
          `produce (floor ${LIVENESS_MIN_ELAPSED_MS}ms); this did not come from the real detector`,
      );
    }
    if (sawSessionLostTrue) {
      violations.push(
        `liveness (${kind}): wire sessionLost was observed true at least once while a live sibling still answered — ` +
          `a card must never render "Session lost" while a sibling is live`,
      );
    }

    if (kind === "active") {
      if (lastWireCard?.sessionCount !== 2) {
        violations.push(
          `liveness (${kind}): wire sessionCount expected 2, actual ${lastWireCard?.sessionCount}`,
        );
      }
      if (lastWireCard?.activeSession?.ttydPort !== built.ttyd.b.port) {
        violations.push(
          `liveness (${kind}): wire activeSession.ttydPort expected ${built.ttyd.b.port} (survivor's port), actual ${lastWireCard?.activeSession?.ttydPort}`,
        );
      }
    } else {
      if (lastWireCard?.activeSession?.id !== surviving.id) {
        violations.push(
          `liveness (${kind}): wire activeSession.id expected the untouched active session ${surviving.id}, actual ${lastWireCard?.activeSession?.id}`,
        );
      }
      if (lastWireCard?.activeSession?.tmuxSession !== survivingTmux) {
        violations.push(
          `liveness (${kind}): wire activeSession.tmuxSession expected the untouched ${survivingTmux}, actual ${lastWireCard?.activeSession?.tmuxSession}`,
        );
      }
    }

    await killAndWait(built.server?.child);
    const persisted = readCard(built.dbPath, built.cardId);
    if (!persisted) {
      violations.push(
        `liveness (${kind}): card ${built.cardId} missing from persisted board.db after kill`,
      );
      return violations;
    }
    const dyingRecord = persisted.sessions?.find((s) => s.id === dying.id);
    const survivingRecord = persisted.sessions?.find(
      (s) => s.id === surviving.id,
    );
    if (!dyingRecord) {
      violations.push(
        `liveness (${kind}): dying session ${dying.id} missing from persisted sessions[]`,
      );
    } else {
      for (const field of ["tmuxSession", "ttydPort", "hookToken"]) {
        if (dyingRecord[field] !== undefined) {
          violations.push(
            `liveness (${kind}): session ${dying.id} persisted ${field} expected absent, actual ${JSON.stringify(dyingRecord[field])}`,
          );
        } else {
          console.log(
            `liveness (${kind}): PASS session ${dying.id} persisted ${field} is absent`,
          );
        }
      }
    }
    if (!survivingRecord) {
      violations.push(
        `liveness (${kind}): surviving session ${surviving.id} missing from persisted sessions[]`,
      );
    } else {
      const expected =
        kind === "active"
          ? {
              tmuxSession: built.tmux.b,
              ttydPort: built.ttyd.b.port,
              hookToken: built.sessionB.token,
            }
          : {
              tmuxSession: built.tmux.a,
              ttydPort: built.ttyd.a.port,
              hookToken: built.sessionA.token,
            };
      for (const [field, expectedValue] of Object.entries(expected)) {
        if (survivingRecord[field] !== expectedValue) {
          violations.push(
            `liveness (${kind}): session ${surviving.id} persisted ${field} expected ${JSON.stringify(expectedValue)}, actual ${JSON.stringify(survivingRecord[field])}`,
          );
        } else {
          console.log(
            `liveness (${kind}): PASS session ${surviving.id} persisted ${field} = ${JSON.stringify(expectedValue)}`,
          );
        }
      }
    }
    if (persisted.activeSessionId !== surviving.id) {
      violations.push(
        `liveness (${kind}): persisted activeSessionId expected ${surviving.id}, actual ${persisted.activeSessionId}`,
      );
    } else {
      console.log(
        `liveness (${kind}): PASS persisted activeSessionId = ${persisted.activeSessionId}`,
      );
    }

    return violations;
  });
}

/**
 * `--check liveness` (WATCH-01/C2, Task 1): both real kill directions, each its own rebuilt
 * fixture. Neither this function nor any other in this file calls the store's own per-session
 * lost-clearing method or imports the store — the only path that clears a session here is a real
 * tmux kill plus the real 2000 ms-tick, 3-strike detector.
 */
async function checkLiveness() {
  const violations = [];
  violations.push(...(await checkLivenessDirection("active")));
  violations.push(...(await checkLivenessDirection("sibling")));
  return violations;
}

/**
 * Reconcile stage 1 (RECON-01/C3, Task 2): both sessions live across a real backend restart.
 * Records each ttyd port's listening PID with the repo's own `lsof -Fpn` port→PID technique
 * BEFORE the restart, restarts the sandbox server on the SAME home, and asserts each port is
 * still LISTENING held by the IDENTICAL PID — a different PID means a respawn, never the
 * adoption this criterion is about. Then proves the per-session token re-registration by
 * ATTRIBUTION, not by counting log lines: POST through each session's own token after the
 * restart and confirm, via a persisted readOnly re-read, that each POST's marker landed on its
 * own session's record.
 */
async function checkReconcileStage1(built) {
  const violations = [];
  const pidBeforeA = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  const pidBeforeB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `reconcile stage1: before restart — port ${built.ttyd.a.port} (A) pid=${pidBeforeA}, port ${built.ttyd.b.port} (B) pid=${pidBeforeB}`,
  );
  if (pidBeforeA == null || pidBeforeB == null) {
    violations.push(
      `reconcile stage1: could not resolve a pre-restart lsof PID for both ttyd ports`,
    );
    return violations;
  }

  await restartServer(built);

  const pidAfterA = (await pidsListeningOnPort(built.ttyd.a.port))[0];
  const pidAfterB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `reconcile stage1: after restart — port ${built.ttyd.a.port} (A) pid=${pidAfterA}, port ${built.ttyd.b.port} (B) pid=${pidAfterB}`,
  );
  if (pidAfterA !== pidBeforeA) {
    violations.push(
      `reconcile stage1: session A's port ${built.ttyd.a.port} lsof PID changed across restart — before=${pidBeforeA} after=${pidAfterA} (a respawn, not an adoption)`,
    );
  }
  if (pidAfterB !== pidBeforeB) {
    violations.push(
      `reconcile stage1: session B's port ${built.ttyd.b.port} lsof PID changed across restart — before=${pidBeforeB} after=${pidAfterB} (a respawn, not an adoption)`,
    );
  }

  const reconcileLines = (built.server?.logLines ?? []).filter((l) =>
    l.includes("[reconcile]"),
  );
  for (const line of reconcileLines)
    console.log(`reconcile stage1: server log: ${line}`);
  const adoptedMatch = reconcileLines
    .map((l) => l.match(/ttyd adopted: (\d+)/))
    .find((m) => m);
  const adoptedCount = adoptedMatch ? Number(adoptedMatch[1]) : undefined;
  if (adoptedCount !== 2) {
    violations.push(
      `reconcile stage1: [reconcile] boot line reported ttyd adopted=${adoptedCount}, expected 2`,
    );
  }

  const reasonA = "reconcile-stage1-reason-A";
  const reasonB = "reconcile-stage1-reason-B";
  const statusA = await postHook(
    built.sessionA.token,
    stopBodyWithReason(reasonA),
  );
  const statusB = await postHook(
    built.sessionB.token,
    stopBodyWithReason(reasonB),
  );
  console.log(
    `reconcile stage1: POST session ${built.sessionA.id} (token A) -> ${statusA}; POST session ${built.sessionB.id} (token B) -> ${statusB}`,
  );
  if (statusA !== 204) {
    violations.push(
      `reconcile stage1: session ${built.sessionA.id}'s own token POSTed ${statusA}, expected 204`,
    );
  }
  if (statusB !== 204) {
    violations.push(
      `reconcile stage1: session ${built.sessionB.id}'s own token POSTed ${statusB}, expected 204`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  const expectedReasonBySessionId = new Map([
    [built.sessionA.id, reasonA],
    [built.sessionB.id, reasonB],
  ]);
  for (const [sessionId, reason] of expectedReasonBySessionId) {
    const expectedMarkerKey = `NEEDS_INPUT ${reason}`;
    const record = persisted?.sessions?.find((s) => s.id === sessionId);
    if (!record) {
      violations.push(
        `reconcile stage1: session ${sessionId} missing from persisted sessions[] after restart`,
      );
      continue;
    }
    if (record.lastMarker !== expectedMarkerKey) {
      violations.push(
        `reconcile stage1: session ${sessionId} persisted lastMarker expected "${expectedMarkerKey}", actual "${record.lastMarker}"`,
      );
    } else {
      console.log(
        `reconcile stage1: PASS session ${sessionId} lastMarker = "${record.lastMarker}"`,
      );
    }
  }

  return violations;
}

/**
 * Reconcile stage 2 (RECON-01/C3, Task 2): one session already dead BEFORE a backend restart —
 * boot reconcile is the subject here, never the 3-strike detector (`bootstrap/index.ts` awaits
 * the sweep to completion before it ever starts listening, so there is no watcher wait to budget:
 * the assertions below run on the FIRST post-restart read). Kills tmux session A and its real
 * ttyd child directly — a truly dead session, not merely a dead pane — restarts the sandbox
 * server, and asserts B's port survives on the same PID, A's record is cleared, the wire's
 * `sessionLost` is falsy, `activeSessionId` still names a live session, and `sessionCount` stays
 * 2 (a lost session's record is cleared in place, never removed).
 */
async function checkReconcileStage2(built) {
  const violations = [];
  const pidBeforeB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `reconcile stage2: before restart — port ${built.ttyd.b.port} (B) pid=${pidBeforeB}`,
  );

  await tmuxKillSession(built.tmux.a);
  try {
    built.ttyd.a.child.kill("SIGTERM");
  } catch {
    // already gone
  }
  await sleep(300);
  if (await isPortListening(built.ttyd.a.port)) {
    for (const pid of await pidsListeningOnPort(built.ttyd.a.port)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  console.log(
    `reconcile stage2: killed real tmux session ${built.tmux.a} and its ttyd (session ${built.sessionA.id})`,
  );

  await restartServer(built);

  const pidAfterB = (await pidsListeningOnPort(built.ttyd.b.port))[0];
  console.log(
    `reconcile stage2: after restart — port ${built.ttyd.b.port} (B) pid=${pidAfterB}`,
  );
  if (pidBeforeB == null) {
    violations.push(
      `reconcile stage2: could not resolve a pre-restart lsof PID for B's port`,
    );
  } else if (pidAfterB !== pidBeforeB) {
    violations.push(
      `reconcile stage2: session B's port ${built.ttyd.b.port} lsof PID changed across restart — before=${pidBeforeB} after=${pidAfterB}`,
    );
  }

  const card = await fetchFixtureCard(built.cardId);
  console.log(
    `reconcile stage2: wire sessionLost=${card?.sessionLost}, sessionCount=${card?.sessionCount}, activeSession.id=${card?.activeSession?.id}`,
  );
  if (card?.sessionLost === true) {
    violations.push(
      `reconcile stage2: wire sessionLost is true — a live sibling must keep the card off "Session lost"`,
    );
  }
  if (card?.sessionCount !== 2) {
    violations.push(
      `reconcile stage2: wire sessionCount expected 2, actual ${card?.sessionCount}`,
    );
  }
  if (card?.activeSession?.id !== built.sessionB.id) {
    violations.push(
      `reconcile stage2: wire activeSession.id expected the live session ${built.sessionB.id}, actual ${card?.activeSession?.id}`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  const deadRecord = persisted?.sessions?.find(
    (s) => s.id === built.sessionA.id,
  );
  if (!deadRecord) {
    violations.push(
      `reconcile stage2: dead session ${built.sessionA.id} missing from persisted sessions[]`,
    );
  } else {
    for (const field of ["tmuxSession", "ttydPort", "hookToken"]) {
      if (deadRecord[field] !== undefined) {
        violations.push(
          `reconcile stage2: dead session ${built.sessionA.id} persisted ${field} expected absent, actual ${JSON.stringify(deadRecord[field])}`,
        );
      }
    }
  }
  if (persisted?.activeSessionId !== built.sessionB.id) {
    violations.push(
      `reconcile stage2: persisted activeSessionId expected ${built.sessionB.id}, actual ${persisted?.activeSessionId}`,
    );
  }

  return violations;
}

/**
 * `--check reconcile` (RECON-01/C3, Task 2): stage 1 (both sessions live across a restart) and
 * stage 2 (one already dead before the restart), each its own fresh fixture.
 */
async function checkReconcile() {
  const violations = [];
  violations.push(
    ...(await withFixture("reconcile-stage1", checkReconcileStage1)),
  );
  violations.push(
    ...(await withFixture("reconcile-stage2", checkReconcileStage2)),
  );
  return violations;
}

/**
 * Cross-session attention proof (UI-02/criterion 5, Task 1): "a ticket where ANY session needs
 * input reads as needing input, and stays that way while another session replies." Reads
 * `GET /api/board` — the identical wire the board and Orca both consume — between every step,
 * never a store-internal read, so this check is falsified by exactly the same signal a human
 * would see on screen.
 * @remarks Session B is deliberately the NON-active session (`built.sessionA` is the
 * `activeSessionId` per {@link standUpFixture}) — step 1 firing through the non-active sibling's
 * own token is what proves attention is not active-session-only. Step 2 (session A, the working
 * sibling, replies) is the cross-session gate under test: `flipBack`'s "any OTHER session still
 * needs input" clause (`board.store.ts`) must suppress the move. Step 3 (session B's OWN reply)
 * is the positive control the plan requires — without it, step 2 passing could mean flip-back is
 * broken outright rather than that the cross-session gate specifically works.
 */
async function checkAttention(built) {
  const violations = [];
  const reasonB = "attention-cross-session-reason-B";

  console.log(
    `attention: active session at standup = ${built.sessionA.id} (A); firing session = ${built.sessionB.id} (B, non-active)`,
  );

  const statusStopB = await postHook(
    built.sessionB.token,
    stopBodyWithReason(reasonB),
  );
  console.log(
    `attention: step 1 POST Stop/NEEDS_INPUT via session B (non-active) -> ${statusStopB} (expected 204)`,
  );
  if (statusStopB !== 204) {
    violations.push(
      `step 1: POST Stop via session B returned ${statusStopB}, expected 204`,
    );
  }
  let card = await fetchFixtureCard(built.cardId);
  console.log(
    `attention: step 1 card.column = ${card?.column} (expected needs_input)`,
  );
  if (card?.column !== "needs_input") {
    violations.push(
      `step 1: card.column expected "needs_input" after session B's (non-active) NEEDS_INPUT marker, actual "${card?.column}"`,
    );
  }

  const statusPromptA = await postPromptSubmit(built.sessionA.token);
  console.log(
    `attention: step 2 POST UserPromptSubmit via session A (active, working sibling replying) -> ${statusPromptA} (expected 204)`,
  );
  if (statusPromptA !== 204) {
    violations.push(
      `step 2: POST UserPromptSubmit via session A returned ${statusPromptA}, expected 204`,
    );
  }
  card = await fetchFixtureCard(built.cardId);
  console.log(
    `attention: step 2 card.column = ${card?.column} (expected still needs_input — B still holds its marker)`,
  );
  if (card?.column !== "needs_input") {
    violations.push(
      `step 2: card.column expected to REMAIN "needs_input" after A's reply (session B still holds a needs-input marker), actual "${card?.column}" — a card that flipped here would read as answered while B is still blocked`,
    );
  }

  const statusPromptB = await postPromptSubmit(built.sessionB.token);
  console.log(
    `attention: step 3 POST UserPromptSubmit via session B (its own reply, positive control) -> ${statusPromptB} (expected 204)`,
  );
  if (statusPromptB !== 204) {
    violations.push(
      `step 3: POST UserPromptSubmit via session B returned ${statusPromptB}, expected 204`,
    );
  }
  card = await fetchFixtureCard(built.cardId);
  console.log(
    `attention: step 3 card.column = ${card?.column} (expected in_progress)`,
  );
  if (card?.column !== "in_progress") {
    violations.push(
      `step 3: card.column expected "in_progress" after session B's own reply, actual "${card?.column}" — without this passing, step 2 could be passing because flip-back is broken outright rather than because the cross-session gate works`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  if (!persisted) {
    violations.push(
      `step 4: card ${built.cardId} missing from persisted board.db after kill`,
    );
    return violations;
  }
  const recordA = persisted.sessions?.find((s) => s.id === built.sessionA.id);
  const recordB = persisted.sessions?.find((s) => s.id === built.sessionB.id);
  const expectedMarkerKeyB = `NEEDS_INPUT ${reasonB}`;
  console.log(
    `attention: step 4 persisted session A (${built.sessionA.id}) lastMarker = ${JSON.stringify(recordA?.lastMarker)}`,
  );
  console.log(
    `attention: step 4 persisted session B (${built.sessionB.id}) lastMarker = ${JSON.stringify(recordB?.lastMarker)}`,
  );
  if (recordB?.lastMarker !== expectedMarkerKeyB) {
    violations.push(
      `step 4: session B persisted lastMarker expected "${expectedMarkerKeyB}" (FLOW-05: flipping out of needs_input leaves lastMarker untouched), actual "${recordB?.lastMarker}"`,
    );
  }
  if (recordA?.lastMarker !== undefined) {
    violations.push(
      `step 4: session A persisted lastMarker expected undefined (A never posted a marker), actual "${recordA?.lastMarker}" — the dedup key stayed per-session while the column stayed card-level`,
    );
  }

  return violations;
}

/**
 * Kill one real tmux session plus its real ttyd child and wait out the REAL 3-strike
 * capture-failure detector, resolving the elapsed milliseconds. Never calls a store mutator and
 * never imports the store — the only thing that can clear the session's fields here is
 * `watcher.ts`'s own detector on its own self-rescheduling tick, which is what makes a check
 * built on this falsifiable rather than self-fulfilling. Resolves `null` if the detector never
 * fired inside {@link LIVENESS_POLL_TIMEOUT_MS}, so the caller reports a timeout as its own named
 * violation instead of hanging.
 */
async function killSessionAndAwaitDetector(
  built,
  tmuxName,
  ttydEntry,
  sessionId,
) {
  const start = Date.now();
  await tmuxKillSession(tmuxName);
  if (ttydEntry?.child) {
    try {
      ttydEntry.child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + LIVENESS_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let persisted;
    try {
      persisted = readCard(built.dbPath, built.cardId);
    } catch {
      persisted = undefined;
    }
    const record = persisted?.sessions?.find((s) => s.id === sessionId);
    if (record != null && record.tmuxSession == null) return Date.now() - start;
    await sleep(LIVENESS_POLL_INTERVAL_MS);
  }
  return null;
}

/**
 * Cross-session attention proof, DEAD-sibling direction (CR-01). {@link checkAttention} proves the
 * gate HOLDS while the sibling that fired the marker is still live; this proves the gate RELEASES
 * once that sibling can no longer answer. The distinction is the whole correctness property: the
 * gate exists so a ticket where any session needs input reads as needing input, and a session
 * whose tmux pane is gone is definitionally not waiting on the user, so leaving it able to
 * suppress the move makes `needs_input` a one-way latch no code path can ever clear.
 * @remarks Session B (non-active) fires the marker and is then really killed — tmux session and
 * ttyd child both — and the REAL 3-strike detector, never a store call from this file, is what
 * clears its `tmuxSession`. Session A (active, still live) then replies through its own token.
 * Step 3 is the falsifiable subject: a card still reading `needs_input` there is a user-visible
 * permanent freeze, because every later reply repeats the identical suppression.
 * @remarks Step 4 reads the PERSISTED record rather than the wire because `redactCard` never
 * projects a non-active sibling's own fields — B's cleared `lastMarker` is only observable there.
 */
async function checkAttentionDeadSibling(built) {
  const violations = [];
  const reasonB = "attention-dead-sibling-reason-B";

  console.log(
    `attention-dead-sibling: active session = ${built.sessionA.id} (A, stays live); firing-then-dying session = ${built.sessionB.id} (B, non-active)`,
  );

  const statusStopB = await postHook(
    built.sessionB.token,
    stopBodyWithReason(reasonB),
  );
  console.log(
    `attention-dead-sibling: step 1 POST Stop/NEEDS_INPUT via session B -> ${statusStopB} (expected 204)`,
  );
  if (statusStopB !== 204) {
    violations.push(
      `step 1: POST Stop via session B returned ${statusStopB}, expected 204`,
    );
  }
  let card = await fetchFixtureCard(built.cardId);
  console.log(
    `attention-dead-sibling: step 1 card.column = ${card?.column} (expected needs_input)`,
  );
  if (card?.column !== "needs_input") {
    violations.push(
      `step 1: card.column expected "needs_input" after session B's NEEDS_INPUT marker, actual "${card?.column}"`,
    );
  }

  const elapsedMs = await killSessionAndAwaitDetector(
    built,
    built.tmux.b,
    built.ttyd.b,
    built.sessionB.id,
  );
  console.log(
    `attention-dead-sibling: step 2 killed real tmux ${built.tmux.b} + its ttyd; detector cleared session B after elapsedMs=${elapsedMs}`,
  );
  if (elapsedMs == null) {
    violations.push(
      `step 2: the real 3-strike detector did not clear session ${built.sessionB.id} within ${LIVENESS_POLL_TIMEOUT_MS}ms`,
    );
  } else if (elapsedMs < LIVENESS_MIN_ELAPSED_MS) {
    violations.push(
      `step 2: session ${built.sessionB.id} cleared after only ${elapsedMs}ms — faster than the real 2000ms tick / 3-strike detector could produce (floor ${LIVENESS_MIN_ELAPSED_MS}ms)`,
    );
  }
  card = await fetchFixtureCard(built.cardId);
  console.log(
    `attention-dead-sibling: step 2 wire sessionLost=${card?.sessionLost} (expected falsy — A is still live), column=${card?.column} (expected still needs_input)`,
  );
  if (card?.sessionLost === true) {
    violations.push(
      `step 2: wire sessionLost is true while session A is still live — a card must never render "Session lost" with a live sibling`,
    );
  }
  if (card?.column !== "needs_input") {
    violations.push(
      `step 2: card.column expected to REMAIN "needs_input" after B merely died (nobody has replied yet), actual "${card?.column}"`,
    );
  }

  const statusPromptA = await postPromptSubmit(built.sessionA.token);
  console.log(
    `attention-dead-sibling: step 3 POST UserPromptSubmit via session A (live, the only session that can still answer) -> ${statusPromptA} (expected 204)`,
  );
  if (statusPromptA !== 204) {
    violations.push(
      `step 3: POST UserPromptSubmit via session A returned ${statusPromptA}, expected 204`,
    );
  }
  card = await fetchFixtureCard(built.cardId);
  console.log(
    `attention-dead-sibling: step 3 card.column = ${card?.column} (expected in_progress)`,
  );
  if (card?.column !== "in_progress") {
    violations.push(
      `step 3: card.column expected "in_progress" after the live session A replied, actual "${card?.column}" — the dead session B still holds a NEEDS_INPUT marker no code path can clear, so the card is frozen in Needs Input permanently and every later reply repeats this suppression`,
    );
  }

  await killAndWait(built.server?.child);
  const persisted = readCard(built.dbPath, built.cardId);
  if (!persisted) {
    violations.push(
      `step 4: card ${built.cardId} missing from persisted board.db after kill`,
    );
    return violations;
  }
  const recordB = persisted.sessions?.find((s) => s.id === built.sessionB.id);
  console.log(
    `attention-dead-sibling: step 4 persisted session B (${built.sessionB.id}) tmuxSession=${JSON.stringify(recordB?.tmuxSession)} lastMarker=${JSON.stringify(recordB?.lastMarker)}`,
  );
  if (!recordB) {
    violations.push(
      `step 4: session ${built.sessionB.id} missing from persisted sessions[]`,
    );
  } else {
    if (recordB.tmuxSession !== undefined) {
      violations.push(
        `step 4: dead session ${built.sessionB.id} persisted tmuxSession expected absent, actual ${JSON.stringify(recordB.tmuxSession)}`,
      );
    }
    if (recordB.lastMarker !== undefined) {
      violations.push(
        `step 4: dead session ${built.sessionB.id} persisted lastMarker expected absent — a session whose tmux pane is gone cannot be waiting on the user, so its needs-input key must not survive the loss, actual ${JSON.stringify(recordB.lastMarker)}`,
      );
    }
  }

  return violations;
}

const CHECKS = {
  safety: () => withFixture("safety", checkSafety),
  "hook-attribution": () =>
    withFixture("hook-attribution", checkHookAttribution),
  liveness: checkLiveness,
  reconcile: checkReconcile,
  attention: () => withFixture("attention", checkAttention),
  "attention-dead-sibling": () =>
    withFixture("attention-dead-sibling", checkAttentionDeadSibling),
};

/**
 * Run one named check end to end: the WR-08 safety-envelope re-assert, the check's own fixture
 * lifecycle(s) via {@link withFixture}, the real board.db before/after comparison. A thrown error
 * anywhere inside a check is folded into `violations` by that check's own `withFixture` call, so
 * this function's only remaining failure mode is an unknown check name.
 */
async function runCheck(name) {
  await assertNoLiveService();
  assertBuilt();

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const checkFn = CHECKS[name];
  let violations;
  if (!checkFn) {
    violations = [`unknown check "${name}"`];
  } else {
    try {
      violations = await checkFn();
    } catch (err) {
      violations = [
        `run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      ];
    }
  }

  const realAfter = statRealBoardDb();
  console.log(`LIVE ${realAfter.path} AFTER: ${fmtStat(realAfter)}`);
  if (
    realBefore.exists !== realAfter.exists ||
    realBefore.mtimeMs !== realAfter.mtimeMs ||
    realBefore.size !== realAfter.size
  ) {
    violations.push(
      `the real ${realAfter.path} changed during this run — before=${fmtStat(realBefore)} after=${fmtStat(realAfter)}`,
    );
  }

  return violations;
}

async function main() {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf("--check");
  const name = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  if (!name) {
    console.error(
      `usage: node scripts/session-liveness-v3.mjs --check <${[...Object.keys(CHECKS), "all"].join("|")}>`,
    );
    process.exit(1);
  }
  const names = name === "all" ? Object.keys(CHECKS) : [name];
  if (name !== "all" && !CHECKS[name]) {
    console.error(
      `unknown check "${name}" — valid: ${Object.keys(CHECKS).join(", ")}, all`,
    );
    process.exit(1);
  }

  let allViolations = [];
  for (const n of names) {
    console.log(`\n=== running check: ${n} ===`);
    const violations = await runCheck(n);
    if (violations.length > 0) {
      console.log(`FAIL (${n}): ${violations.length} violation(s)`);
      for (const v of violations) console.log(`  ${v}`);
    } else {
      console.log(`PASS (${n})`);
    }
    allViolations = allViolations.concat(violations);
  }

  if (allViolations.length === 0) {
    console.log(`\nPASS: ${names.join(", ")}`);
    process.exit(0);
  }
  console.log(
    `\nFAIL: ${allViolations.length} violation(s) across ${names.join(", ")}`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(`session-liveness-v3 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
