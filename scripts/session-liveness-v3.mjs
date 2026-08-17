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
 * (`dist/server/bootstrap/index.js`).
 *
 * Usage:
 *   node scripts/session-liveness-v3.mjs --check safety            the fixture-standup/teardown proof
 *   node scripts/session-liveness-v3.mjs --check hook-attribution  the per-session hook POST proof
 *   node scripts/session-liveness-v3.mjs --check all               every check, one fixture each
 *
 * Exit codes: 0 all checks PASS. 1 a safety-envelope refusal, a setup/build error, a check
 * violation, a teardown-verification failure, or the live board.db changing.
 */
import { spawn, execFile } from "node:child_process";
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
 */
function bootServer(home) {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
  }
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

function assertBuilt() {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
  }
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

const CHECKS = {
  safety: checkSafety,
};

/**
 * Run one named check end to end: safety envelope, one fresh fixture, the check's own assertions,
 * unconditional-and-verified teardown, the real board.db before/after comparison. Every step above
 * "run the check" throws rather than degrades; a thrown error inside the fixture/check phase is
 * folded into `violations` (not re-thrown) so teardown always still runs in the `finally`.
 */
async function runCheck(name) {
  await assertNoLiveService();

  const home = makeSandboxHome("run");
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

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const violations = [];
  try {
    await assertPreflightClean();
    assertBuilt();
    await standUpFixture(built);

    const checkFn = CHECKS[name];
    if (!checkFn) throw new Error(`unknown check "${name}"`);
    violations.push(...(await checkFn(built)));
  } catch (err) {
    violations.push(
      `run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
  } finally {
    await tearDownFixture(built, violations);
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
