/**
 * Phase 94 plan 09 UI measurement instrument (`UI-04`, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/ — the same category as panel-92.mjs,
 * panel-93.mjs, panel-mount-92.mjs, session-liveness-v3.mjs. It measures all EIGHT observable
 * acceptance criteria `94-UI-SPEC.md` names for `StartAnotherSessionButton` against a real Chrome,
 * a real sandboxed dispatch server and a real board — never eyeballed, never asserted from source
 * reading alone.
 *
 * SAFETY — copied verbatim from this milestone's own precedent (panel-92/93/mount-92.mjs headers).
 * Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via `adoptAndSweep`,
 * fingerprinted by argv shape, never by tmux session name or which board.db spawned it.
 * `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if anything answers
 * on :4700, before this script boots any server or spawns any real tmux/ttyd.
 *
 * ONE REAL SESSION, the rest inert — criterion 6 (zero new mount events) needs a genuine ttyd
 * process so a real ESTABLISHED socket exists to count; every other criterion needs only the DOM
 * shape a plain `node:sqlite` row seed produces (the panel-93.mjs idiom). Spinning up real tmux+
 * ttyd for every fixture would be pure overhead for criteria that never touch the terminal, so only
 * the `healthy` fixture (criteria 1's keyboard/focus-ring path, 5's N=1 row height, and 6's mount
 * count) gets a real session — `panel-mount-92.mjs`'s own `spawnTtyd`/`tmuxNewSession` primitives,
 * copied wholesale. Every other fixture's `tmuxSession` is deliberately left `undefined` so
 * `hasLiveSession` stays false and `DetailPanel`'s `ensureTerminal` effect never fires against a
 * session this harness never actually started.
 *
 * THE TWO-HOP TRAP (criterion 6) — restated from `94-UI-SPEC.md`/STATE.md, load-bearing here too.
 * The socket to a ttyd port belongs to the DISPATCH SERVER process (`net.connect` inside
 * `upgradeForward`), never the browser (client -> Express -> ttyd, two hops). Counting established
 * sockets from the BROWSER side reads a constant and passes vacuously — Phase 92's fourth dead
 * instrument. `establishedLocalPorts`/`pollForSingleEstablished` (this file, copied from
 * `panel-mount-92.mjs`) scope `lsof -sTCP:ESTABLISHED` to the SANDBOX SERVER'S OWN pid.
 *
 * THE BLIND-GEOMETRY TRAP (criterion 5) — a `display:none` or otherwise-absent row reads a false
 * 0px and a naive geometry-only check would report that as "smaller, therefore correct" instead of
 * "the wrong node entirely." Every geometry read in this file is PAIRED with an independent
 * structural existence assertion (the button or switcher group must resolve via
 * `document.querySelector`/accessible-name search BEFORE its parent's height is read) — Phase 92's
 * third dead instrument, the same lesson `94-UI-SPEC.md`'s own criterion 2 names explicitly.
 *
 * macOS TRAP, load-bearing here too: `dist`'s `main()` guard compares `import.meta.url` against an
 * UNRESOLVED `process.argv[1]`; `realpathSync(entry)` before spawn fixes it (see `bootServerAt`).
 *
 * Usage:
 *   node scripts/panel-94.mjs                the real run: all eight criteria, exits non-zero on
 *                                             any violation.
 *   node scripts/panel-94.mjs --n1-expect-44  Task 2's dead-instrument self-check ONLY: swaps the
 *                                             N=1 row-height expectation from 48px (this phase's
 *                                             real figure) to 44px (Phase 92's N>=2-only figure) —
 *                                             MUST fail, demonstrating the 48px expectation is
 *                                             load-bearing rather than a copied constant. Harness-
 *                                             only; touches no product code.
 *
 * Exit codes: 0 every check PASS. 1 a live :4700, a failed build, a sandbox/tmux/ttyd-safety
 * violation, a DOM element the evaluate could not find, any measured-criterion violation, the real
 * board.db changing during the run, or a sandbox port/tmux/ttyd resource still held after teardown.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
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
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair in this repo. */
const SANDBOX_PORT = 47867;
const CDP_PORT = 9369;
const SANDBOX_PREFIX = "dispatch-panel-94-";
const TMUX_PREFIX = `dsp94-${process.pid}-`;

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RESIZE_SETTLE_MS = 250;
const RENDER_TIMEOUT_MS = 15_000;
const LISTEN_POLL_TIMEOUT_MS = 10_000;
const PORT_PARSE_TIMEOUT_MS = 10_000;
const CONNECT_POLL_TIMEOUT_MS = 5_000;
const DISCONNECT_POLL_TIMEOUT_MS = 8_000;
const TAB_TRAVERSAL_CAP = 40;
/** Sub-pixel tolerance for a live `getBoundingClientRect().height` read against a fixed expected integer. */
const HEIGHT_TOLERANCE_PX = 0.5;
/**
 * `94-UI-SPEC.md`'s own row-height arithmetic (`8px padding + 32px Button + 8px padding = 48px`,
 * `8 + 28 + 8 = 44`) counts padding and content only. The row's OWN style also carries
 * `borderBottom: "1px solid var(--border)"` (`DetailPanel.tsx`, unchanged since Phase 92) — a
 * border always adds to an element's rendered footprint regardless of `box-sizing`, so
 * `getBoundingClientRect().height` — the exact method both `94-UI-SPEC.md` criterion 5 and this
 * file name — reads 1px MORE than the spec's stated figures. Live-verified, reproducible across
 * all three geometry fixtures and all four breakpoints (never off by any OTHER amount). This is
 * not a product defect (a 1px border is normal, intentional CSS, not a bug) and not a component
 * this plan owns — it is the spec's own arithmetic omitting a value its own CSS already carried.
 * Ground truth wins: the constants below add this to `94-UI-SPEC.md`'s stated 48/44.
 */
const ROW_BOTTOM_BORDER_PX = 1;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** `>=1600px`, `1024-1599px`, `768-1023px`, `<768px` — the four breakpoints `94-UI-SPEC.md` names. */
const BREAKPOINTS = [
  { name: "1600", width: 1600, height: 1000 },
  { name: "1280", width: 1280, height: 900 },
  { name: "900", width: 900, height: 800 },
  { name: "390", width: 390, height: 844 },
];

const TTYD_REVISION_RETAINED_KEY = "DISPATCH_TTYD_REVISION_6";
const FAKE_LINEAR_API_KEY = "panel-94-harness-fake-key-never-real";

const HEALTHY_ID = "panel94-healthy";
const HEALTHY2_ID = "panel94-healthy2";
const DONE_ID = "panel94-done";
const MEMBER_ID = "panel94-member";
const CLEANED_ID = "panel94-cleaned";
const LOST_ID = "panel94-lost";
const BRANCH_CONFLICT_ID = "panel94-branchconflict";
const DONE_SWITCHER_ID = "panel94-doneswitcher";

/**
 * `HEALTHY`'s identifier MUST satisfy `cards.route.ts`'s `^[A-Za-z0-9]+-\d+$` guard: criterion 4
 * (in-flight state) is proved by driving a REAL second-session saga against this exact card
 * through the real `POST /cards/:id/start` route (see criterion 4 below) — a pre-seeded
 * `provisioningStep` cannot be used instead, because `hydrateFromParsed`'s boot-time reconcile
 * unconditionally rewrites ANY persisted non-null `provisioningStep` into a `startError` with
 * `step: "interrupted"` (`board.store.ts:958`) — a stale-looking value from before this run ever
 * started. The other eight identifiers never touch that route, so they keep the descriptive,
 * non-route-shaped form.
 */
const HEALTHY = "PANEL94-1";
const HEALTHY2 = "PANEL94-HEALTHY2";
const DONE = "PANEL94-DONE";
const MEMBER = "PANEL94-MEMBER";
const CLEANED = "PANEL94-CLEANED";
const LOST = "PANEL94-LOST";
const BRANCH_CONFLICT = "PANEL94-BRANCHCONFLICT";
const DONE_SWITCHER = "PANEL94-DONESWITCHER";

/**
 * Identifiers the board is expected to RENDER. `MEMBER` is deliberately absent: a group member
 * card (`groupId != null`) is filtered out of every column by `Board.tsx:334`, so it never renders
 * as a board card at all and there is no panel to open on it. That exclusion is asserted separately
 * and more strongly by {@link assertMemberNeverRenders} — waiting for it here would hang on a
 * product behaviour that is correct.
 */
const ALL_IDENTIFIERS = [
  HEALTHY,
  HEALTHY2,
  DONE,
  CLEANED,
  LOST,
  BRANCH_CONFLICT,
  DONE_SWITCHER,
];

const BUTTON_TEXT = "Start another session";
const INFLIGHT_TEXT = "Starting…";
const INFLIGHT_REASON = "Starting another session…";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-94-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board — " +
        "refusing to start real tmux/ttyd or boot a sandbox server while the user's real service " +
        "is up (its boot-time reconcile pass sweeps ttyd machine-wide). Stop the launchd service " +
        "first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-94-LIVE"))
      throw err;
  }
}

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

let headBuild = null;

/** Unconditional full `build` (web + server) — this instrument reads rendered DOM. Never mtime-gated. */
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
      `refusing to run — \`npm run ${BUILD_SCRIPT}\` failed, so dist/ does not reflect src/:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `Missing ${DIST_ENTRY} after a successful \`npm run ${BUILD_SCRIPT}\`.`,
    );
  }
  headBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: built HEAD src/ -> dist/ via \`npm run ${BUILD_SCRIPT}\` in ${headBuild.durationMs}ms`,
  );
  return headBuild;
}

/**
 * `entry` is REALPATH'd before being handed to `node` — the macOS /var -> /private/var trap.
 * `pathPrefix`, when given, is prepended onto the child's `PATH` — the `session-liveness-v3.mjs`
 * `opts.pathPrefix` widening, used ONLY so criterion 4's real second-session saga resolves the
 * stub `claude` on {@link writeStubClaudeBinary} before any real install.
 */
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
 * Plant a stub `claude` executable at `<home>/bin/claude`. MUST branch on `--version`: boot itself
 * calls the resolved `claude` with `--version` via an untimeouted `checkHooksCapability()` probe
 * BEFORE the sandbox server ever starts listening (94-05's finding), so a stub that
 * unconditionally blocks would hang the server's own boot, not merely the saga.
 *
 * Any OTHER invocation prints an innocuous line that deliberately does NOT match `steps.ts`'s own
 * `READY`/`TRUST_DIALOG`/`BYPASS_DIALOG` regexes, then blocks forever. This is NOT
 * `session-liveness-v3.mjs`'s `writeStubClaudeBinary` (which prints a READY-matching line so
 * `awaitReplReady` succeeds quickly and the saga can complete) — criterion 4 needs the OPPOSITE:
 * `card.provisioningStep` to stay non-null for a long, reliably-observable window, not the few
 * hundred ms between READY-detection and `completeStart`. Never matching READY means
 * `awaitReplReady`'s own ~30s `READINESS_TIMEOUT_MS` is what eventually ends the saga (with a
 * `repl-timeout` failure) — comfortably after this criterion's read is done.
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
      "echo 'panel-94 stub claude — deliberately never ready'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
}

/**
 * Create a throwaway local git repo under the sandbox HOME (never a real project repo) with one
 * committed file, so `card.workspace.repos[0]` names a base `createWorktrees` can actually branch
 * from — the `session-liveness-v3.mjs` `seedFixtureRepo` recipe, copied for the one card
 * (`healthy`) that drives a real saga. `git config` is set LOCALLY only, never `--global`.
 */
async function seedFixtureRepo(home) {
  const repoPath = join(home, "repos", "alpha");
  mkdirSync(repoPath, { recursive: true });
  await execFileP("git", ["init"], { cwd: repoPath });
  await execFileP("git", ["config", "user.email", "harness@localhost"], {
    cwd: repoPath,
  });
  await execFileP("git", ["config", "user.name", "panel-94 harness"], {
    cwd: repoPath,
  });
  writeFileSync(join(repoPath, "README.md"), "fixture base\n");
  await execFileP("git", ["add", "README.md"], { cwd: repoPath });
  await execFileP("git", ["commit", "-m", "fixture base", "--no-gpg-sign"], {
    cwd: repoPath,
  });
  const { stdout } = await execFileP(
    "git",
    ["symbolic-ref", "--short", "HEAD"],
    { cwd: repoPath },
  );
  return { repoPath, repoBase: stdout.trim() };
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
      // Chrome debugging port not up yet — keep polling
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

// ---------------------------------------------------------------------------
// tmux / ttyd — copied wholesale from panel-mount-92.mjs, used ONLY for the `healthy` fixture.
// ---------------------------------------------------------------------------

async function tmuxNewSession(name, cwd) {
  mkdirSync(cwd, { recursive: true });
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
    // already gone — idempotent teardown
  }
}

async function tmuxListSessionNames() {
  try {
    const { stdout } = await execFileP("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
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
 * `lsof -nP -iTCP:<port> -sTCP:ESTABLISHED -Fpn` scoped to `pid` — THE SERVER-SIDE SIGNAL criterion
 * 6 depends on (see file header's TWO-HOP TRAP paragraph). Tolerant of lsof's non-zero exit on no
 * match.
 */
async function establishedCount(port, pid) {
  try {
    const { stdout } = await execFileP("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:ESTABLISHED",
      "-Fpn",
    ]);
    let currentPid = null;
    let count = 0;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) currentPid = Number(line.slice(1));
      else if (line.startsWith("n") && currentPid === pid) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

async function pollForEstablishedCount(port, pid, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    last = await establishedCount(port, pid);
    if (last === expected) return last;
    await sleep(50);
  }
  return last;
}

/** Spawn one real ttyd with the EXACT argv `spawnTtyd` (`ttyd.ts`) uses at the current runtime revision. */
function spawnTtyd(tmuxName, sessionId) {
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
        `=${tmuxName}`,
      ],
      { detached: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    let buf = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `ttyd port not reported within ${PORT_PARSE_TIMEOUT_MS}ms for ${tmuxName}`,
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
        new Error(`ttyd exited early (code ${code}) for ${tmuxName}: ${buf}`),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Fixture cards
// ---------------------------------------------------------------------------

function baseCard(id, identifier, extra) {
  const now = new Date().toISOString();
  return {
    id,
    issueId: `${id}-issue`,
    identifier,
    title: `panel-94 fixture card ${identifier}`,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: now,
    ...extra,
  };
}

function makeInertSession(home, slug, workspace, createdAtOffsetMs) {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - createdAtOffsetMs).toISOString();
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    tmuxSession: undefined,
    ttydPort: undefined,
    workspacePath: workspace
      ? join(home, "workspaces", `panel94-${slug}-${id.slice(0, 8)}`)
      : undefined,
  };
}

/** Mirror a session's six flat fields onto the card, exactly as `setActiveSession` would. */
function withActiveMirror(card, session) {
  card.sessions = [
    session,
    ...(card.sessions ?? []).filter((s) => s !== session),
  ];
  card.activeSessionId = session.id;
  card.tmuxSession = session.tmuxSession;
  card.ttydPort = session.ttydPort;
  card.workspacePath = session.workspacePath;
  card.workspace = session.workspace;
  return card;
}

function makeFixtures(home, healthySession) {
  const doneSession = makeInertSession(home, "done", true, 4000);
  const memberSession = makeInertSession(home, "member", true, 4000);
  const lostSession = makeInertSession(home, "lost", true, 4000);
  const branchConflictSession = makeInertSession(
    home,
    "branchconflict",
    true,
    4000,
  );
  const h2a = makeInertSession(home, "h2a", true, 5000);
  const h2b = makeInertSession(home, "h2b", true, 3000);
  const dsA = makeInertSession(home, "dsa", true, 5000);
  const dsB = makeInertSession(home, "dsb", true, 3000);

  const healthy = withActiveMirror(
    baseCard(HEALTHY_ID, HEALTHY, {
      column: "in_progress",
      groupId: undefined,
    }),
    healthySession,
  );

  const healthy2 = withActiveMirror(
    baseCard(HEALTHY2_ID, HEALTHY2, {
      column: "in_progress",
      groupId: undefined,
    }),
    h2a,
  );
  healthy2.sessions = [h2a, h2b];

  const done = withActiveMirror(
    baseCard(DONE_ID, DONE, { column: "done", groupId: undefined }),
    doneSession,
  );

  const member = withActiveMirror(
    baseCard(MEMBER_ID, MEMBER, {
      column: "in_progress",
      groupId: randomUUID(),
    }),
    memberSession,
  );

  const cleaned = baseCard(CLEANED_ID, CLEANED, {
    column: "in_progress",
    groupId: undefined,
    workspacePath: undefined,
  });

  const lost = withActiveMirror(
    baseCard(LOST_ID, LOST, {
      column: "in_progress",
      groupId: undefined,
      sessionLost: true,
    }),
    lostSession,
  );

  const branchConflict = withActiveMirror(
    baseCard(BRANCH_CONFLICT_ID, BRANCH_CONFLICT, {
      column: "in_progress",
      groupId: undefined,
      startError: {
        step: "starting claude",
        stderr: "",
        variant: "branch-conflict",
        newSession: true,
      },
    }),
    branchConflictSession,
  );

  const doneSwitcher = withActiveMirror(
    baseCard(DONE_SWITCHER_ID, DONE_SWITCHER, {
      column: "done",
      groupId: undefined,
    }),
    dsA,
  );
  doneSwitcher.sessions = [dsA, dsB];

  return [
    healthy,
    healthy2,
    done,
    member,
    cleaned,
    lost,
    branchConflict,
    doneSwitcher,
  ];
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema
 * (the panel-93.mjs / panel-mount-92.mjs seeding idiom, never a hand-duplicated schema), kill that
 * boot, then insert the fixture rows directly via `node:sqlite`.
 * @remarks This boot's own `reconcileSessions()` sweeps every ttyd process on the machine matching
 * Dispatch's fingerprint (an empty board spares none of them) — callers MUST NOT spawn a real
 * ttyd before calling this, or the sweep kills it before it is ever adopted (see the standup-order
 * comment in `main()`).
 * @remarks Live-caught flakiness: the warmup boot occasionally needs its own `KILL_TIMEOUT_MS`
 * SIGKILL escalation to actually exit (`exitCode=null signalCode=SIGTERM` rather than the graceful
 * `exitCode=0`), in which case the schema is never created and a bare retry — not a longer
 * timeout — is what actually recovers, because a SIGKILL'd process leaves nothing to wait longer
 * for. Bounded to 3 attempts; each attempt polls the port to actually go dark before opening the
 * db, since a schema check run while the OS is still releasing the old LISTEN socket can otherwise
 * observe a transient, misleading state.
 */
async function seedFixtureCards(home, fixtures) {
  const dbPath = join(home, ".dispatch", "board.db");
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const warmup = bootServerAt(home);
    try {
      await waitForReady(SANDBOX_PORT);
    } finally {
      await killAndWait(warmup);
    }
    const deadline = Date.now() + 5_000;
    while ((await isPortListening(SANDBOX_PORT)) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
    }
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
          `seedFixtureCards: schema not yet created after warmup attempt ${attempt}/${ATTEMPTS} ` +
            `(exitCode=${warmup.exitCode} signalCode=${warmup.signalCode}) — retrying`,
        );
        continue;
      }
      const insertCard = db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      );
      db.exec("BEGIN");
      for (const card of fixtures)
        insertCard.run(card.id, JSON.stringify(card));
      db.exec("COMMIT");
      return;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // a failed prepare/insert may never have opened a transaction to roll back
      }
      throw err;
    } finally {
      db.close();
    }
  }
  throw new Error(
    `seedFixtureCards: sqlite schema never appeared after ${ATTEMPTS} warmup-boot attempts`,
  );
}

/**
 * Patch an already-persisted fixture card's session in place — read, mutate, write back, via a
 * fresh `DatabaseSync` handle (the server is NOT running while this executes). Sets the SAME six
 * flat mirror fields `withActiveMirror` sets, so the patched row is byte-shape-identical to what
 * `setActiveSession` would have produced. Used ONLY for `healthy`, whose real tmux/ttyd must be
 * spawned AFTER `seedFixtureCards`'s own schema-creation boot (see that function's remarks).
 */
async function patchFixtureCardSession(home, cardId, sessionId, patch) {
  const dbPath = join(home, ".dispatch", "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare("SELECT data FROM cards WHERE id = ?").get(cardId);
    if (!row)
      throw new Error(`patchFixtureCardSession: no card row for ${cardId}`);
    const card = JSON.parse(row.data);
    const session = card.sessions?.find((s) => s.id === sessionId);
    if (!session)
      throw new Error(
        `patchFixtureCardSession: no session ${sessionId} on card ${cardId}`,
      );
    Object.assign(session, patch);
    if (card.activeSessionId === sessionId) {
      card.tmuxSession = session.tmuxSession;
      card.ttydPort = session.ttydPort;
      card.workspacePath = session.workspacePath;
      card.workspace = session.workspace;
    }
    db.prepare("UPDATE cards SET data = ? WHERE id = ?").run(
      JSON.stringify(card),
      cardId,
    );
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Navigation — the panel-92/93/mount-92 Orca/docked-mode idiom (avoids the Phase 55 click-outside
// backdrop trap that intercepts a raw Board-mode click once a DIFFERENT card's panel is open).
// ---------------------------------------------------------------------------

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
      // page mid-navigation — keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `initial board load never rendered every identifier within ${RENDER_TIMEOUT_MS}ms`,
  );
}

async function enableOrcaMode(cdp, sessionId, identifiers) {
  await waitForBoardRootLoaded(cdp, sessionId, identifiers);
  await evalValue(cdp, sessionId, `localStorage.setItem("dsp.view", "orca")`);
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const probe = `
    (function () {
      var nav = document.querySelector('nav[aria-label="Tickets"]');
      if (!nav) return false;
      var text = nav.textContent;
      return ${JSON.stringify(identifiers)}.every(function (id) { return text.indexOf(id) !== -1; });
    })()
  `;
  while (Date.now() < deadline) {
    try {
      if (await evalValue(cdp, sessionId, probe)) return;
    } catch {
      // execution context torn down mid-reload — keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Orca nav never rendered every identifier within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/**
 * Select a fixture's card in the Orca nav, matching its identifier on a WORD BOUNDARY.
 *
 * @remarks A plain `indexOf` is wrong here for the same structural reason `tmux`'s unprefixed `-t`
 * target is wrong (94-07): `PANEL94-HEALTHY` is a strict prefix of `PANEL94-HEALTHY2`, so a
 * substring match resolves onto TWO rows and the harness either throws or, with a `[0]` pick,
 * silently drives the wrong card. The trailing `(?![A-Za-z0-9])` makes the match exact-at-the-end
 * while still tolerating the surrounding chrome text ("Linear", the relative timestamp) that shares
 * the row's `textContent`.
 */
async function selectCardViaOrcaNav(cdp, sessionId, identifier) {
  const clickExpr = `
    (function () {
      var nav = document.querySelector('nav[aria-label="Tickets"]');
      if (!nav) throw new Error("Orca nav not found");
      var re = new RegExp("^${identifier}(?![A-Z0-9-])");
      var rows = Array.prototype.filter.call(
        nav.querySelectorAll('[role="button"]'),
        function (el) { return re.test(el.textContent); },
      );
      var all = Array.prototype.map.call(
        nav.querySelectorAll('[role="button"]'),
        function (el) { return (el.textContent || "").slice(0, 60); },
      );
      if (rows.length === 0) {
        throw new Error("no Orca nav row matched ${identifier} — rows present: " + JSON.stringify(all));
      }
      if (rows.length > 1) {
        var hits = Array.prototype.map.call(rows, function (el) {
          return (el.tagName || "?") + ":" + (el.textContent || "").slice(0, 60);
        });
        throw new Error("Orca nav row matched ${identifier} " + rows.length + " times: " + JSON.stringify(hits));
      }
      rows[0].click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, clickExpr);
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const probe = `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      if (!aside) return false;
      return new RegExp("${identifier}(?![A-Z0-9-])").test(aside.textContent);
    })()
  `;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `panel never showed ${identifier} within ${RENDER_TIMEOUT_MS}ms of selecting it`,
  );
}

// ---------------------------------------------------------------------------
// DOM read helpers — accessible-name search, never a class/test-id (this codebase ships none).
// ---------------------------------------------------------------------------

/**
 * Shared JS source: locate every button in the panel whose visible text, `aria-label`, or `title`
 * matches one of the "Start another session" family strings — returns full detail per button, not
 * just a boolean, so a copy regression degrades to a diagnosable MISMATCH rather than an opaque
 * "not found" (the `density-91.mjs` discovery-vs-validation discipline the plan calls out).
 */
const FIND_BUTTONS_SRC = `
  function panel94FindButtons() {
    var aside = document.querySelector('aside[aria-label="Ticket detail"]');
    if (!aside) throw new Error("ticket detail aside not found");
    var buttons = Array.prototype.slice.call(aside.querySelectorAll("button"));
    return buttons.map(function (b) {
      return {
        el: b,
        text: b.textContent.trim(),
        ariaLabel: b.getAttribute("aria-label"),
        title: b.getAttribute("title"),
        disabled: b.disabled,
      };
    });
  }
`;

async function readAllPanelButtons(cdp, sessionId) {
  return evalValue(
    cdp,
    sessionId,
    `${FIND_BUTTONS_SRC}
    (function () {
      return panel94FindButtons().map(function (b) {
        return { text: b.text, ariaLabel: b.ariaLabel, title: b.title, disabled: b.disabled };
      });
    })()`,
  );
}

/** Structural discovery: does ANY panel button carry the "Start another session" text/aria/title family? */
function matchesStartAnotherFamily(b) {
  return (
    b.text === BUTTON_TEXT ||
    b.text === INFLIGHT_TEXT ||
    b.ariaLabel === BUTTON_TEXT ||
    b.ariaLabel === INFLIGHT_REASON ||
    b.title === BUTTON_TEXT ||
    b.title === INFLIGHT_REASON
  );
}

async function evalReport(cdp, sessionId, violations, label, expr) {
  try {
    return await evalValue(cdp, sessionId, expr);
  } catch (err) {
    violations.push(`${label}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

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

/**
 * Fail-closed preflight, distinct from {@link assertNoLiveService}: a STALE sandbox process left
 * over from a prior, improperly-torn-down run of THIS file (crashed mid-run, killed by a tool
 * timeout, etc.) can already hold `SANDBOX_PORT`/`CDP_PORT`. Silently proceeding would make this
 * run's own warmup boot fail to bind (`EADDRINUSE`), while `waitForReady`'s poll still succeeds —
 * answered by the STALE process instead — so every subsequent read/write silently targets the
 * wrong board.db, producing exactly the incoherent, self-contradicting output this check exists to
 * prevent (live-caught in this plan's own development).
 */
async function assertSandboxPortsFree() {
  for (const port of [SANDBOX_PORT, CDP_PORT]) {
    if (await isPortListening(port)) {
      const { stdout } = await execFileP("lsof", [
        "-nP",
        `-iTCP:${port}`,
      ]).catch((err) => ({ stdout: err.stdout ?? "" }));
      throw new Error(
        `PANEL-94-STALE-PORT: :${port} is already held before this run started — a prior run of ` +
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

/**
 * Criterion 2's group-member leg has a SECOND enforcement point above the component, and this
 * asserts it separately from the panel-level check.
 *
 * `Board.tsx:334` filters `card.groupId == null` out of every board COLUMN, so a member card never
 * renders as a board card at all — independent of whether `StartAnotherSessionButton`'s own
 * `groupId == null` gate holds. (The Orca nav does list it, which is why the panel-level assertion
 * in criterion 2's loop is still both possible and worth making.)
 *
 * Asserting "no member card in the board columns" ALONE would be a dead instrument: it passes
 * identically if the fixture was never seeded. So the assertion is a PAIR — the card must be
 * present in the API payload carrying a `groupId`, AND absent from the rendered columns. Only both
 * together distinguish a deliberate filter from a missing record.
 */
async function assertMemberNeverRenders(cdp, sessionId, violations) {
  const res = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/board`);
  const board = await res.json();
  const cards = Array.isArray(board) ? board : (board?.cards ?? []);
  const memberCard = cards.find((c) => c.identifier === MEMBER);
  if (memberCard == null) {
    violations.push(
      `criterion-2 (member/board): the member fixture is absent from GET /api/board entirely — the column-absence assertion would pass vacuously, so this leg proves nothing`,
    );
    return;
  }
  if (memberCard.groupId == null) {
    violations.push(
      `criterion-2 (member/board): the member fixture carries no groupId on the wire (${JSON.stringify(memberCard.groupId)}) — it is not the case this leg is meant to exercise`,
    );
    return;
  }
  const inColumns = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var main = document.querySelector('main') || document.querySelector('#root');
      if (!main) return false;
      var nav = document.querySelector('nav[aria-label="Tickets"]');
      var text = "";
      Array.prototype.forEach.call(main.querySelectorAll('*'), function (el) {
        if (nav && nav.contains(el)) return;
        if (el.children.length === 0 && el.textContent) text += el.textContent + " ";
      });
      return new RegExp("${MEMBER}(?![A-Z0-9-])").test(text);
    })()`,
  );
  if (inColumns === true) {
    violations.push(
      `criterion-2 (member/board): the member card renders in a board column — Board.tsx:334's groupId filter is not holding`,
    );
    return;
  }
  console.log(
    `criterion 2 (member/board): present in /api/board with groupId=${memberCard.groupId}, absent from every board column — excluded above the component by Board.tsx:334, with App.tsx:232 refusing its start request besides`,
  );
}

function readFlag(argv, name) {
  return argv.includes(name);
}

async function main() {
  const argv = process.argv.slice(2);
  const n1Expect44 = readFlag(argv, "--n1-expect-44");
  // The self-check tests literally 44px (Phase 92's own N>=2-only figure, no border adjustment)
  // — it must be wrong by MORE than a rounding margin, not just re-derive the correct answer.
  const n1ExpectedHeight = n1Expect44 ? 44 : 48 + ROW_BOTTOM_BORDER_PX;

  await assertNoLiveService();
  await assertSandboxPortsFree();
  assertBuilt();

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  const violations = [];
  const findings = [];
  let server = null;
  let chromeChild = null;
  let cdp = null;
  let ttyd = null;
  let healthyTmuxName = null;
  let secondSessionTmuxNames = [];
  let portsHeld = false;

  try {
    const { repoPath, repoBase } = await seedFixtureRepo(home);
    console.log(
      `standup: fixture git repo — ${repoPath} (base branch ${repoBase})`,
    );
    const pathPrefix = writeStubClaudeBinary(home);
    console.log(`standup: stub claude planted — ${join(pathPrefix, "claude")}`);

    const healthySessionId = randomUUID();
    // `healthy`'s session record is seeded WITHOUT a live tmux/ttyd yet — see the standup-order
    // note below for why. `workspace` IS set now (real, cuts from `repoPath`/`repoBase`) so
    // criterion 4's real second-session POST doesn't 400 with "No workspace selected for this
    // ticket" once the server boots.
    const healthySession = {
      id: healthySessionId,
      createdAt: new Date(Date.now() - 4000).toISOString(),
      updatedAt: new Date(Date.now() - 4000).toISOString(),
      tmuxSession: undefined,
      ttydPort: undefined,
      workspacePath: join(home, "workspaces", "healthy"),
      workspace: {
        folder: join(home, "repos"),
        repos: [{ path: repoPath, base: repoBase }],
      },
    };

    const fixtures = makeFixtures(home, healthySession);
    // `seedFixtureCards` boots the server ONCE to create the sqlite schema (never skippable —
    // `board.db`'s tables don't exist until a real boot creates them) — and THAT boot's own
    // `reconcileSessions()` unconditionally SWEEPS every ttyd process on the machine matching
    // Dispatch's fingerprint, since an empty just-created board spares none of them
    // (`adoptAndSweep`'s `sparedPids` stays empty when `candidates` is empty). Spawning `healthy`'s
    // real tmux+ttyd BEFORE this call would get it killed by that very sweep — live-caught in this
    // plan's own development (a `[DEBUG-adopt] ... compatible=[]` boot log with the session's own
    // port already gone). So: seed first (schema + fixture ROWS, `healthy`'s row still session-
    // less), THEN spawn the real tmux+ttyd, THEN patch `healthy`'s already-persisted row with the
    // now-known tmux name/port via a direct `node:sqlite` UPDATE, THEN boot the REAL server — its
    // reconcile now sees `healthy` as a genuine candidate and adopts the (still-alive, never
    // swept) ttyd instead of orphaning it.
    await seedFixtureCards(home, fixtures);

    healthyTmuxName = `${TMUX_PREFIX}healthy`;
    await tmuxNewSession(healthyTmuxName, join(home, "workspaces", "healthy"));
    ttyd = await spawnTtyd(healthyTmuxName, healthySessionId);
    await waitForPortListening(ttyd.port);
    console.log(
      `standup: real tmux+ttyd for 'healthy' — tmux=${healthyTmuxName} ttyd.port=${ttyd.port}`,
    );
    await patchFixtureCardSession(home, HEALTHY_ID, healthySessionId, {
      tmuxSession: healthyTmuxName,
      ttydPort: ttyd.port,
    });

    const tmuxBeforeSaga = await tmuxListSessionNames();
    server = bootServerAt(home, pathPrefix);
    await waitForReady(SANDBOX_PORT);
    const serverPid = server.pid;
    console.log(
      `standup: sandbox server ready on :${SANDBOX_PORT}, pid=${serverPid}`,
    );

    chromeChild = spawn(
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

    cdp = await connectCDP();
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

    // Any uncaught page-side exception is surfaced immediately — a silent React crash must never
    // read as "still loading" to the poll below.
    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.exceptionThrown") {
        console.error(
          `page exception: ${JSON.stringify(msg.params.exceptionDetails)}`,
        );
      }
    });

    await enableOrcaMode(cdp, sessionId, ALL_IDENTIFIERS);
    console.log(
      "standup: Orca/docked mode enabled, every nav-reachable fixture rendered (member is deliberately excluded — see criterion 2)",
    );

    // =====================================================================
    // Criterion 1 — real <button>, keyboard-operable, focus ring keyboard-vs-mouse
    // =====================================================================
    console.log("\n--- criterion 1: keyboard path + focus ring ---");
    await selectCardViaOrcaNav(cdp, sessionId, HEALTHY);

    await evalValue(
      cdp,
      sessionId,
      `(function () {
        if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
        return true;
      })()`,
    );

    let tabCount = 0;
    let reachedViaTab = false;
    for (let i = 0; i < TAB_TRAVERSAL_CAP; i++) {
      await cdp.send(
        "Input.dispatchKeyEvent",
        {
          type: "rawKeyDown",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
        },
        sessionId,
      );
      await cdp.send(
        "Input.dispatchKeyEvent",
        { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
        sessionId,
      );
      tabCount++;
      const hit = await evalValue(
        cdp,
        sessionId,
        `(function () {
          var el = document.activeElement;
          if (!el || el.tagName !== "BUTTON") return false;
          return el.textContent.trim() === ${JSON.stringify(BUTTON_TEXT)};
        })()`,
      );
      if (hit) {
        reachedViaTab = true;
        break;
      }
    }
    console.log(
      `criterion 1: Tab traversal reached the button = ${reachedViaTab} (tabCount=${tabCount})`,
    );
    if (!reachedViaTab) {
      violations.push(
        `criterion-1: Tab traversal never reached "${BUTTON_TEXT}" within ${TAB_TRAVERSAL_CAP} tabs`,
      );
    } else {
      const keyboardOutline = await evalValue(
        cdp,
        sessionId,
        `(function () {
          var s = getComputedStyle(document.activeElement);
          return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle };
        })()`,
      );
      console.log(
        `criterion 1: keyboard-focus outline = ${JSON.stringify(keyboardOutline)}`,
      );
      const ringPresent =
        keyboardOutline.outlineWidth !== "0px" &&
        keyboardOutline.outlineStyle !== "none";
      if (!ringPresent) {
        violations.push(
          `criterion-1: expected a visible focus ring on keyboard focus, got ${JSON.stringify(keyboardOutline)}`,
        );
      }

      // Enter, dispatched as its own pass, real key events. Type MUST be "keyDown" (not
      // "rawKeyDown") for a key that produces text — Puppeteer's own Keyboard.down() makes this
      // exact distinction (`rawKeyDown` only for keys with no `text`, e.g. Tab/Escape). Using
      // "rawKeyDown" for Enter/Space live-reproduced as a silent no-op: Tab (no text) worked, but
      // Enter never opened the modal under "rawKeyDown".
      await cdp.send(
        "Input.dispatchKeyEvent",
        {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          text: "\r",
          unmodifiedText: "\r",
        },
        sessionId,
      );
      await cdp.send(
        "Input.dispatchKeyEvent",
        {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        },
        sessionId,
      );
      const enterOpened = await waitForModal(cdp, sessionId, true);
      console.log(`criterion 1: Enter opened the StartModal = ${enterOpened}`);
      if (!enterOpened)
        violations.push("criterion-1: Enter did not open the StartModal");
      await closeModal(cdp, sessionId);

      // Re-derive keyboard focus (fresh Tab pass) before Space, in a separate pass. This ALSO
      // catches a real product bug this instrument found live: `StartAnotherSessionButton` used
      // to set a local `pending` flag on click, cleared only once `card.provisioningStep`
      // transitioned to null — cancelling the modal without submitting left `provisioningStep`
      // null forever, so the button stayed permanently `disabled` (dropped from tab order) and
      // this exact re-Tab would have failed. Fixed in `bbb833f` (disabled now reads
      // `card.provisioningStep` alone, matching `PanelHeader`'s own "Start" button); this Tab pass
      // is what would catch a regression of that fix.
      await evalValue(
        cdp,
        sessionId,
        `(function () {
          if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
          }
          return true;
        })()`,
      );
      let reachedForSpace = false;
      for (let i = 0; i < TAB_TRAVERSAL_CAP; i++) {
        await cdp.send(
          "Input.dispatchKeyEvent",
          {
            type: "rawKeyDown",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9,
          },
          sessionId,
        );
        await cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
          sessionId,
        );
        const hit = await evalValue(
          cdp,
          sessionId,
          `(function () {
            var el = document.activeElement;
            if (!el || el.tagName !== "BUTTON") return false;
            return el.textContent.trim() === ${JSON.stringify(BUTTON_TEXT)};
          })()`,
        );
        if (hit) {
          reachedForSpace = true;
          break;
        }
      }
      if (!reachedForSpace) {
        violations.push(
          "criterion-1: could not re-reach the button via Tab for the Space pass",
        );
      } else {
        await cdp.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: " ",
            code: "Space",
            windowsVirtualKeyCode: 32,
            text: " ",
            unmodifiedText: " ",
          },
          sessionId,
        );
        await cdp.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 },
          sessionId,
        );
        const spaceOpened = await waitForModal(cdp, sessionId, true);
        console.log(
          `criterion 1: Space opened the StartModal = ${spaceOpened}`,
        );
        if (!spaceOpened)
          violations.push("criterion-1: Space did not open the StartModal");
        await closeModal(cdp, sessionId);
      }
    }

    // Mouse-click reading — a FRESH load, per the plan text, so Chrome's :focus-visible heuristic
    // carries no keyboard history over from the Tab passes above.
    await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
    await waitForBoardRootLoaded(cdp, sessionId, ALL_IDENTIFIERS);
    await selectCardViaOrcaNav(cdp, sessionId, HEALTHY);
    const buttonRect = await evalValue(
      cdp,
      sessionId,
      `(function () {
        var aside = document.querySelector('aside[aria-label="Ticket detail"]');
        var btn = Array.prototype.find.call(aside.querySelectorAll("button"), function (b) {
          return b.textContent.trim() === ${JSON.stringify(BUTTON_TEXT)};
        });
        if (!btn) throw new Error("button not found for mouse-click reading");
        var r = btn.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: buttonRect.x, y: buttonRect.y },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        x: buttonRect.x,
        y: buttonRect.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
      sessionId,
    );
    // Read the outline BETWEEN mousedown and mouseup, not after: a browser focuses an element on
    // mousedown, but the `click` event (and this button's own onClick, which opens the StartModal
    // and steals focus into its textarea) only fires on mouseup. Reading after mouseup would
    // observe the MODAL's focus state, not the button's own mouse-focus outline — confirmed live
    // (the first version of this check read `wrongElement: true`, i.e. the modal had already
    // stolen focus by the time it ran).
    const mouseOutline = await evalValue(
      cdp,
      sessionId,
      `(function () {
        var el = document.activeElement;
        if (!el || el.tagName !== "BUTTON") return { outlineWidth: null, outlineStyle: null, wrongElement: true, activeTag: el ? el.tagName : null };
        var s = getComputedStyle(el);
        return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle };
      })()`,
    );
    console.log(
      `criterion 1: mouse-click outline (fresh load, read between mousedown and mouseup) = ${JSON.stringify(mouseOutline)}`,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x: buttonRect.x,
        y: buttonRect.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
      sessionId,
    );
    await sleep(100);
    const mouseRingAbsent =
      mouseOutline.outlineWidth === "0px" ||
      mouseOutline.outlineStyle === "none";
    if (!mouseRingAbsent) {
      violations.push(
        `criterion-1: expected NO focus ring on a mouse click, got ${JSON.stringify(mouseOutline)}`,
      );
    }
    await closeModal(cdp, sessionId).catch(() => {});

    // =====================================================================
    // Criterion 2 — structural absence on all three excluded fixtures
    // =====================================================================
    console.log("\n--- criterion 2: structural absence ---");
    await assertMemberNeverRenders(cdp, sessionId, violations);
    for (const [label, identifier] of [
      ["done (column=done)", DONE],
      ["cleaned (workspacePath null)", CLEANED],
    ]) {
      await selectCardViaOrcaNav(cdp, sessionId, identifier);
      const buttons = await readAllPanelButtons(cdp, sessionId);
      const matches = buttons.filter(matchesStartAnotherFamily);
      console.log(
        `criterion 2 (${label}): panel buttons=${buttons.length}, start-another matches=${matches.length}`,
      );
      if (matches.length > 0) {
        violations.push(
          `criterion-2 (${label}): expected zero "Start another session" matches across textContent/aria-label/title, found ${JSON.stringify(matches)}`,
        );
      }
    }

    // =====================================================================
    // Criterion 3 — presence when the active session is lost
    // =====================================================================
    console.log("\n--- criterion 3: presence when lost ---");
    await selectCardViaOrcaNav(cdp, sessionId, LOST);
    const lostButtons = await readAllPanelButtons(cdp, sessionId);
    const lostMatch = lostButtons.find((b) => b.text === BUTTON_TEXT);
    console.log(
      `criterion 3: found=${lostMatch != null} disabled=${lostMatch?.disabled}`,
    );
    if (lostMatch == null) {
      violations.push(
        "criterion-3: button not found on the sessionLost fixture",
      );
    } else if (lostMatch.disabled) {
      violations.push(
        "criterion-3: button unexpectedly disabled on the sessionLost fixture",
      );
    }

    // Criterion 4 (in-flight state) is proved LATER, after criterion 6 — it needs a REAL
    // second-session saga against `healthy`, which must stay a clean N=1 card through criteria
    // 5 and 6 first (see criterion 4's own block below for why a pre-seeded `provisioningStep`
    // cannot be used).

    // =====================================================================
    // Criterion 5 — row geometry at four breakpoints
    // =====================================================================
    console.log("\n--- criterion 5: row geometry ---");
    const geometryFixtures = [
      {
        label: "healthy (N=1, button)",
        identifier: HEALTHY,
        expected: n1ExpectedHeight,
        mode: "button",
      },
      {
        label: "healthy2 (N>=2, button+switcher)",
        identifier: HEALTHY2,
        expected: 48 + ROW_BOTTOM_BORDER_PX,
        mode: "button",
      },
      {
        label: "doneSwitcher (N>=2, switcher only)",
        identifier: DONE_SWITCHER,
        expected: 44 + ROW_BOTTOM_BORDER_PX,
        mode: "switcher",
      },
    ];
    for (const bp of BREAKPOINTS) {
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: bp.width,
          height: bp.height,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId,
      );
      await sleep(RESIZE_SETTLE_MS);
      for (const gf of geometryFixtures) {
        await selectCardViaOrcaNav(cdp, sessionId, gf.identifier);
        const reading = await evalReport(
          cdp,
          sessionId,
          violations,
          `criterion-5 (${gf.label} @ ${bp.name})`,
          `${FIND_BUTTONS_SRC}
          (function () {
            var aside = document.querySelector('aside[aria-label="Ticket detail"]');
            if (!aside) throw new Error("ticket detail aside not found");
            var mode = ${JSON.stringify(gf.mode)};
            var rowEl = null;
            var structurallyPresent = false;
            if (mode === "button") {
              var buttons = panel94FindButtons();
              var match = buttons.find(function (b) {
                return b.text === ${JSON.stringify(BUTTON_TEXT)} || b.ariaLabel === ${JSON.stringify(BUTTON_TEXT)} || b.title === ${JSON.stringify(BUTTON_TEXT)};
              });
              structurallyPresent = match != null;
              rowEl = match ? match.el.parentElement : null;
            } else {
              var group = aside.querySelector('[role="group"][aria-label="Sessions"]');
              structurallyPresent = group !== null;
              rowEl = group ? group.parentElement : null;
            }
            if (!structurallyPresent || !rowEl) {
              return { structurallyPresent: structurallyPresent, height: null };
            }
            var rect = rowEl.getBoundingClientRect();
            return { structurallyPresent: true, height: rect.height };
          })()`,
        );
        console.log(
          `criterion 5 (${gf.label} @ ${bp.name}px): structurallyPresent=${reading?.structurallyPresent} height=${reading?.height} expected=${gf.expected}`,
        );
        if (reading == null) continue;
        if (!reading.structurallyPresent) {
          violations.push(
            `criterion-5 (${gf.label} @ ${bp.name}): structural node not found — a geometry read here would be blind`,
          );
          continue;
        }
        if (Math.abs(reading.height - gf.expected) > HEIGHT_TOLERANCE_PX) {
          violations.push(
            `criterion-5 (${gf.label} @ ${bp.name}): expected ~${gf.expected}px (tolerance ${HEIGHT_TOLERANCE_PX}px), got ${reading.height}px`,
          );
        }
      }
    }
    // Restore the standard measurement viewport for the remaining criteria.
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await sleep(RESIZE_SETTLE_MS);

    if (n1Expect44) {
      // Self-check-only run — the geometry loop above is the entire point; skip criteria 6-8.
      console.log("\n--n1-expect-44: self-check mode, skipping criteria 6-8");
    } else {
      // ===================================================================
      // Criterion 6 — zero new mount events (SERVER-SIDE socket count)
      // ===================================================================
      console.log(
        "\n--- criterion 6: zero new mount events (server-side socket count) ---",
      );
      console.log(
        "criterion 6: counting ESTABLISHED sockets to healthy's ttyd port SCOPED TO THE SANDBOX SERVER'S OWN PID " +
          `(pid=${serverPid}) — the socket to a ttyd port belongs to the dispatch server process ` +
          "(client -> Express -> ttyd, two hops), never the browser; a browser-side count reads a constant.",
      );
      await selectCardViaOrcaNav(cdp, sessionId, HEALTHY);
      await sleep(1500);
      const iframeDiag = await evalValue(
        cdp,
        sessionId,
        `(function () {
          var aside = document.querySelector('aside[aria-label="Ticket detail"]');
          var iframe = aside ? aside.querySelector("iframe") : null;
          return {
            asideFound: aside != null,
            iframeFound: iframe != null,
            iframeSrc: iframe ? iframe.src : null,
          };
        })()`,
      );
      console.log(`criterion 6 DIAG: iframe = ${JSON.stringify(iframeDiag)}`);
      const baselineEst = await pollForEstablishedCount(
        ttyd.port,
        serverPid,
        1,
        CONNECT_POLL_TIMEOUT_MS,
      );
      console.log(
        `criterion 6: baseline ESTABLISHED count on healthy's ttyd port = ${baselineEst}`,
      );
      if (baselineEst !== 1) {
        violations.push(
          `criterion-6: precondition violated — expected exactly 1 ESTABLISHED row on healthy's ttyd port ${ttyd.port} owned by pid ${serverPid} before measuring, actual ${baselineEst}. A 0 reading means the instrument itself is blind, not that the terminal never connected.`,
        );
      } else {
        await selectCardViaOrcaNav(cdp, sessionId, CLEANED);
        const afterCleaned = await pollForEstablishedCount(
          ttyd.port,
          serverPid,
          0,
          DISCONNECT_POLL_TIMEOUT_MS,
        );
        console.log(
          `criterion 6: after selecting 'cleaned' (row + button absent, no live session) — ESTABLISHED count = ${afterCleaned}`,
        );
        if (afterCleaned !== 0) {
          violations.push(
            `criterion-6: expected the healthy ttyd socket to close after switching away (row/button unmount), still ${afterCleaned} ESTABLISHED`,
          );
        }
        await selectCardViaOrcaNav(cdp, sessionId, HEALTHY);
        const afterBack = await pollForEstablishedCount(
          ttyd.port,
          serverPid,
          1,
          CONNECT_POLL_TIMEOUT_MS,
        );
        console.log(
          `criterion 6: after switching back to 'healthy' (row + button remount) — ESTABLISHED count = ${afterBack}`,
        );
        if (afterBack !== 1) {
          violations.push(
            `criterion-6: expected exactly 1 ESTABLISHED row after remounting, got ${afterBack} — either a leaked extra connection or a failed reconnect`,
          );
        }
      }

      // ===================================================================
      // Criterion 4 — in-flight disabled state, via a REAL second-session saga
      // ===================================================================
      console.log(
        "\n--- criterion 4: in-flight disabled state (real second-session saga) ---",
      );
      console.log(
        "criterion 4: driving a REAL POST /cards/:id/start against 'healthy' with a blocking " +
          "stub claude on PATH — a pre-seeded provisioningStep cannot be used, since " +
          "hydrateFromParsed's boot-time reconcile unconditionally rewrites any persisted " +
          "non-null provisioningStep into a startError (board.store.ts:958) before this build " +
          "ever gets a chance to read it back.",
      );
      const startRes = await fetch(
        `http://127.0.0.1:${SANDBOX_PORT}/api/cards/${HEALTHY_ID}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newSession: true }),
        },
      );
      console.log(`criterion 4: POST /start status=${startRes.status}`);
      if (startRes.status !== 202) {
        const body = await startRes.text().catch(() => "");
        violations.push(
          `criterion-4: POST /cards/${HEALTHY_ID}/start expected 202, got ${startRes.status}: ${body}`,
        );
      } else {
        await startRes.body?.cancel().catch(() => {});
        const sagaDeadline = Date.now() + 15_000;
        let sawInFlight = false;
        while (Date.now() < sagaDeadline) {
          const boardRes = await fetch(
            `http://127.0.0.1:${SANDBOX_PORT}/api/board`,
          );
          const board = await boardRes.json();
          const cards = Array.isArray(board) ? board : (board?.cards ?? []);
          const hc = cards.find((c) => c.id === HEALTHY_ID);
          if (hc?.provisioningStep != null) {
            sawInFlight = true;
            break;
          }
          if (hc?.startError != null) {
            violations.push(
              `criterion-4: the real saga failed before reaching an observable in-flight state: ${JSON.stringify(hc.startError)}`,
            );
            break;
          }
          await sleep(150);
        }
        console.log(
          `criterion 4: card.provisioningStep observed non-null = ${sawInFlight}`,
        );
        if (!sawInFlight) {
          violations.push(
            "criterion-4: card.provisioningStep never went non-null within 15s of the real POST",
          );
        } else {
          const tmuxAfterSaga = await tmuxListSessionNames();
          secondSessionTmuxNames = tmuxAfterSaga.filter(
            (n) => !tmuxBeforeSaga.includes(n) && n !== healthyTmuxName,
          );
          console.log(
            `criterion 4: new tmux session(s) from the saga (tracked for teardown) — ${JSON.stringify(secondSessionTmuxNames)}`,
          );

          const provButtons = await readAllPanelButtons(cdp, sessionId);
          const provMatch = provButtons.find(
            (b) =>
              b.text === INFLIGHT_TEXT ||
              b.ariaLabel === INFLIGHT_REASON ||
              b.title === INFLIGHT_REASON,
          );
          console.log(`criterion 4: ${JSON.stringify(provMatch)}`);
          if (provMatch == null) {
            violations.push(
              "criterion-4: in-flight button not found on 'healthy' while card.provisioningStep is non-null",
            );
          } else {
            if (!provMatch.disabled)
              violations.push("criterion-4: expected disabled=true");
            if (provMatch.text !== INFLIGHT_TEXT)
              violations.push(
                `criterion-4: expected text "${INFLIGHT_TEXT}", got ${JSON.stringify(provMatch.text)}`,
              );
            if (provMatch.text.includes(BUTTON_TEXT))
              violations.push(
                "criterion-4: text unexpectedly still contains the default label",
              );
            if (provMatch.ariaLabel !== INFLIGHT_REASON)
              violations.push(
                `criterion-4: expected aria-label "${INFLIGHT_REASON}", got ${JSON.stringify(provMatch.ariaLabel)}`,
              );
            if (provMatch.title !== INFLIGHT_REASON)
              violations.push(
                `criterion-4: expected title "${INFLIGHT_REASON}", got ${JSON.stringify(provMatch.title)}`,
              );
          }
          const hasSpinner = await evalValue(
            cdp,
            sessionId,
            `(function () {
              var aside = document.querySelector('aside[aria-label="Ticket detail"]');
              var btn = Array.prototype.find.call(aside.querySelectorAll("button"), function (b) {
                return b.textContent.trim() === ${JSON.stringify(INFLIGHT_TEXT)};
              });
              if (!btn) return null;
              var svg = btn.querySelector('svg[width="14"]');
              return svg !== null;
            })()`,
          );
          console.log(
            `criterion 4: Spinner (svg[width=14]) present inside button = ${hasSpinner}`,
          );
          if (hasSpinner)
            violations.push(
              "criterion-4: a Spinner node is rendered inside the in-flight button",
            );
        }
      }

      // ===================================================================
      // Criterion 7 — error placement, wire-shape + DOM half
      // ===================================================================
      console.log("\n--- criterion 7: error placement (wire shape + DOM) ---");
      const typesSrc = readFileSync(
        join(REPO_ROOT, "src", "shared", "types.ts"),
        "utf8",
      );
      const cardStartErrorCount = countFieldInInterface(
        typesSrc,
        "Card",
        "StartError",
      );
      const sessionStartErrorCount = countFieldInInterface(
        typesSrc,
        "Session",
        "StartError",
      );
      console.log(
        `criterion 7: wire shape — Card has ${cardStartErrorCount} StartError field(s), Session has ${sessionStartErrorCount}`,
      );
      if (cardStartErrorCount !== 1) {
        violations.push(
          `criterion-7: expected exactly 1 StartError field on Card, found ${cardStartErrorCount}`,
        );
      }
      if (sessionStartErrorCount !== 0) {
        violations.push(
          `criterion-7: expected 0 StartError fields on Session, found ${sessionStartErrorCount}`,
        );
      }

      // Card-face DOM half — the Notice+Retry block lives in CardView, which mounts only under
      // the traditional Board (App.tsx:383), never under OrcaView (App.tsx:371): Orca mode
      // replaces <Board> outright rather than hiding it, so a query against `#root` while docked
      // in Orca (this harness's standing mode since `enableOrcaMode`) finds zero Retry buttons no
      // matter what the fixture carries — live-reproduced (`count:0` even with a real
      // `startError` seeded). Switch to Board mode for this one read, then switch back to Orca
      // (`enableOrcaMode`) before criterion 8, which depends on `selectCardViaOrcaNav`.
      await evalValue(
        cdp,
        sessionId,
        `localStorage.setItem("dsp.view", "board")`,
      );
      await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
      await waitForBoardRootLoaded(cdp, sessionId, ALL_IDENTIFIERS);
      const cardFaceRetry = await evalValue(
        cdp,
        sessionId,
        `(function () {
          var root = document.getElementById("root");
          var retryButtons = Array.prototype.filter.call(root.querySelectorAll("button"), function (b) {
            return b.textContent.trim() === "Retry";
          });
          if (retryButtons.length !== 1) {
            return { count: retryButtons.length, attributedToFixture: false };
          }
          var container = retryButtons[0];
          for (var i = 0; i < 20 && container; i++) {
            if (container.textContent.indexOf(${JSON.stringify(BRANCH_CONFLICT)}) !== -1) break;
            container = container.parentElement;
          }
          return { count: 1, attributedToFixture: container != null && container.textContent.indexOf(${JSON.stringify(BRANCH_CONFLICT)}) !== -1 };
        })()`,
      );
      console.log(
        `criterion 7: card-face Retry = ${JSON.stringify(cardFaceRetry)}`,
      );
      if (cardFaceRetry.count !== 1) {
        violations.push(
          `criterion-7: expected exactly 1 "Retry" button on the board (branch-conflict fixture), found ${cardFaceRetry.count}`,
        );
      } else if (!cardFaceRetry.attributedToFixture) {
        violations.push(
          "criterion-7: the single Retry button could not be attributed to the branch-conflict fixture",
        );
      }

      await enableOrcaMode(cdp, sessionId, ALL_IDENTIFIERS);

      // Panel half — the button stays enabled with no error UI of its own.
      await selectCardViaOrcaNav(cdp, sessionId, BRANCH_CONFLICT);
      const panelBtns = await readAllPanelButtons(cdp, sessionId);
      const panelStartAnother = panelBtns.find((b) => b.text === BUTTON_TEXT);
      console.log(
        `criterion 7: panel button = ${JSON.stringify(panelStartAnother)}`,
      );
      if (panelStartAnother == null) {
        violations.push(
          "criterion-7: panel's Start another session button not found on the branch-conflict fixture",
        );
      } else if (panelStartAnother.disabled) {
        violations.push(
          "criterion-7: panel button unexpectedly disabled on the branch-conflict fixture",
        );
      }

      // ===================================================================
      // Criterion 8 — panel coherence with the lost-session panel
      // ===================================================================
      console.log(
        "\n--- criterion 8: panel coherence (Resume + Start another session) ---",
      );
      await selectCardViaOrcaNav(cdp, sessionId, LOST);
      const coherence = await evalValue(
        cdp,
        sessionId,
        `${FIND_BUTTONS_SRC}
        (function () {
          var aside = document.querySelector('aside[aria-label="Ticket detail"]');
          if (!aside) throw new Error("ticket detail aside not found");
          var buttons = panel94FindButtons();
          var resumeBtn = buttons.find(function (b) { return b.text === "Resume"; });
          var startAnotherBtn = buttons.find(function (b) { return b.text === ${JSON.stringify(BUTTON_TEXT)}; });
          var result = {
            resumeFound: resumeBtn != null,
            startAnotherFound: startAnotherBtn != null,
            distinctNames: resumeBtn != null && startAnotherBtn != null && resumeBtn.text !== startAnotherBtn.text,
          };
          if (resumeBtn && startAnotherBtn) {
            var rowEl = startAnotherBtn.el.parentElement;
            var children = Array.prototype.filter.call(aside.children, function (el) { return el.tagName === "DIV"; });
            var bodyWrapper = children.length > 0 ? children[children.length - 1] : null;
            result.rowContainsResume = rowEl ? rowEl.contains(resumeBtn.el) : null;
            result.bodyWrapperContainsStartAnother = bodyWrapper ? bodyWrapper.contains(startAnotherBtn.el) : null;
            result.bodyWrapperContainsResume = bodyWrapper ? bodyWrapper.contains(resumeBtn.el) : null;
            result.rowIsBodyWrapper = rowEl === bodyWrapper;
          }
          return result;
        })()`,
      );
      console.log(`criterion 8: ${JSON.stringify(coherence)}`);
      if (!coherence.resumeFound || !coherence.startAnotherFound) {
        violations.push(
          `criterion-8: expected BOTH Resume and "${BUTTON_TEXT}" to render on the lost-session fixture, got ${JSON.stringify(coherence)}`,
        );
      } else {
        if (!coherence.distinctNames) {
          findings.push(
            `criterion-8 FINDING: Resume and "${BUTTON_TEXT}" do not carry distinct accessible names`,
          );
        }
        const structurallySeparate =
          coherence.rowContainsResume === false &&
          coherence.bodyWrapperContainsStartAnother === false &&
          coherence.bodyWrapperContainsResume === true &&
          coherence.rowIsBodyWrapper === false;
        if (!structurallySeparate) {
          findings.push(
            `criterion-8 FINDING: the two controls are not in structurally separate zones (session row vs panel body) — ${JSON.stringify(coherence)}. Per 94-UI-SPEC.md this is a layout finding, not a mechanism blocker.`,
          );
        } else {
          console.log(
            "criterion 8: session row and panel body confirmed as distinct ancestor nodes",
          );
        }
      }
    }
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    await killAndWait(server);
    if (ttyd?.child) {
      try {
        ttyd.child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    await sleep(300);
    if (ttyd && (await isPortListening(ttyd.port))) {
      console.error(
        `teardown: ttyd on port ${ttyd.port} survived SIGTERM — forcing`,
      );
      try {
        const { stdout } = await execFileP("lsof", [
          "-nP",
          `-iTCP:${ttyd.port}`,
          "-sTCP:LISTEN",
          "-Fp",
        ]);
        for (const line of stdout.split("\n")) {
          if (line.startsWith("p"))
            process.kill(Number(line.slice(1)), "SIGKILL");
        }
      } catch {
        // nothing to kill
      }
    }
    if (healthyTmuxName) await tmuxKillSession(healthyTmuxName);
    for (const n of secondSessionTmuxNames) await tmuxKillSession(n);
    // Belt-and-suspenders beyond the before/after diff above: the diff is a SNAPSHOT taken the
    // instant `provisioningStep` first goes non-null, which can race the saga's OWN internal
    // ordering (worktree creation precedes `startClaude`'s tmux session, so a diff taken too early
    // can read `[]` even though the session is created moments later — live-caught in this plan's
    // own development). `dsp-${HEALTHY}` is a harness-minted, highly specific prefix — safe to kill
    // unconditionally, unlike a bare kill-all.
    for (const n of await tmuxListSessionNames()) {
      if (n.startsWith(`dsp-${HEALTHY}`)) await tmuxKillSession(n);
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`), {
      recursive: true,
      force: true,
    });
    portsHeld = await checkPortsHeld();
    const stillLive = await tmuxListSessionNames();
    const leakedTmux = stillLive.filter(
      (n) =>
        n.startsWith(TMUX_PREFIX) ||
        n.startsWith(`dsp-${HEALTHY}`) ||
        secondSessionTmuxNames.includes(n),
    );
    if (leakedTmux.length > 0) {
      console.error(
        `ASSERTION: leaked tmux sessions after teardown: ${leakedTmux.join(", ")}`,
      );
      portsHeld = true;
    }
    if (ttyd && (await isPortListening(ttyd.port))) {
      console.error(
        `ASSERTION: ttyd port ${ttyd.port} still LISTENING after teardown`,
      );
      portsHeld = true;
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

  if (findings.length > 0) {
    console.log(
      `\n${findings.length} FINDING(s) (non-gating, per 94-UI-SPEC.md criterion 8):`,
    );
    for (const f of findings) console.log(`  ${f}`);
  }

  if (portsHeld) {
    console.log(
      "\nFAIL: a sandbox resource (port/tmux/ttyd) was still held after teardown",
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`  ${v}`);
    process.exit(1);
  }

  console.log(n1Expect44 ? "\nPASS (--n1-expect-44 self-check)" : "\nPASS");
  process.exit(0);
}

/** Wait for `[role="dialog"][aria-label="Start session"]` to reach `present`. */
async function waitForModal(cdp, sessionId, present) {
  const probe = `document.querySelector('[role="dialog"][aria-label="Start session"]') !== null`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await evalValue(cdp, sessionId, probe)) === present) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/** Close the StartModal via a real Escape key event, then wait for its ~150ms close transition. */
async function closeModal(cdp, sessionId) {
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "rawKeyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    sessionId,
  );
  await sleep(300);
  await waitForModal(cdp, sessionId, false);
}

/**
 * Brace-scope `interfaceName`'s body from `src/shared/types.ts` fresh off disk and count
 * `: <fieldType>` field declarations inside it — the 94-07 `checkStartErrorWireShape` discipline,
 * re-implemented here so this file stays self-contained.
 */
function countFieldInInterface(source, interfaceName, fieldType) {
  const startMarker = `interface ${interfaceName} `;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1)
    throw new Error(`interface ${interfaceName} not found in types.ts`);
  const braceStart = source.indexOf("{", startIdx);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = source.slice(braceStart, i + 1);
  const re = new RegExp(`:\\s*${fieldType}\\b`, "g");
  const matches = body.match(re);
  return matches ? matches.length : 0;
}

main().catch((err) => {
  console.error(`panel-94 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
