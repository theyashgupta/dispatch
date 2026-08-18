/**
 * Phase 93 plan 09 cleanup-copy parity instrument (dev/ops tooling, NOT test code): imports no test
 * framework, asserts nothing via an assertion library, lives outside src/ — the same category as
 * check-invariants.mjs, density-91.mjs, panel-92.mjs, and downgrade-guard-v3.mjs. It closes criterion
 * 6: at exactly one session, the cleanup dialog copy, the countdown, the blocked notice and the
 * warning string are byte-identical to v2.9 — measured as strings, never eyeballed.
 *
 * THE BASELINE IS A REAL v2.9.0 TAG BUILD, NEVER THE LIVE :4700 SERVICE. `:4700` runs the globally
 * installed npm package (three releases stale as of this phase); a parity claim against it would be
 * vacuous. `--legacy` materializes the `v2.9.0` git tag (`fb75ede`) into a THROWAWAY git worktree
 * under `os.tmpdir()` (never inside any repo the board manages), builds it with its own `npm ci` +
 * `npm run build`, boots it, measures, and the caller removes the worktree afterward — the exact
 * technique `panel-92.mjs` established; this file reuses its shape rather than inventing a second
 * one.
 *
 * SAFETY — copied verbatim from panel-92.mjs's own header, load-bearing here too. Booting ANY
 * dispatch server (sandboxed or not, HEAD or the v2.9.0 comparison build) runs `reconcileSessions()`
 * at boot, which sweeps `ttyd` processes MACHINE-WIDE via `adoptAndSweep` — fingerprinted by argv
 * shape, NEVER by tmux session name or by which board.db spawned it. `assertNoLiveService()` is a
 * FAIL-CLOSED pre-flight: it throws (never warns) if anything answers on :4700, before this script
 * boots any server. This instrument itself spawns no real tmux/ttyd — every fixture session field is
 * an inert string, never a live process — but the guard exists anyway because a sandbox server's own
 * boot-time reconcile pass runs unconditionally. The two builds (legacy and HEAD) are NEVER booted
 * concurrently — two dispatch servers sweep each other's ttyd machine-wide.
 *
 * macOS TRAP, load-bearing here too: `os.tmpdir()` on macOS is `/var` -> `/private/var`, and
 * `dist`'s `main()` guard compares `import.meta.url` against an UNRESOLVED `process.argv[1]` — a
 * server booted from a raw tmpdir path exits 0 with ZERO output and never starts, which reads
 * identically to "still starting" until the ready-poll times out. `realpathSync(entry)` before spawn
 * fixes it; see {@link bootServerAt}'s remarks for the full mechanism.
 *
 * WHAT IS MEASURED — every string a user can see at N=1 (one session):
 *   - CleanupModal confirm copy, blocked heading, blocked entries, and button labels
 *   - the card-face countdown (`format-cleanup-countdown.ts`), blocked label, and warning notice
 *   - the panel's own cleanup-warning notice (`ReferenceBlocks.tsx`)
 * plus, on the CURRENT build only (v2.9.0 has no `sessionSummaries` concept), the N>=2 copy: the
 * confirm copy naming the session count, and a blocked entry naming `Session {ordinal}`. The N>=2
 * capture is RECORDED, never diffed against the legacy baseline, and is asserted to differ from its
 * N=1 counterpart — an N>=2 capture that happened to equal the N=1 string would mean session naming
 * was never actually wired, which would otherwise pass silently.
 *
 * THE MISSING-SUBJECT SENTINEL — what keeps this from being a dead instrument. A selector that stops
 * matching yields `null`/empty on both sides of a comparison; equality alone would call that a PASS
 * despite having measured nothing. Every field is asserted a non-empty string (or non-empty array of
 * non-empty strings) on BOTH sides BEFORE its equality is ever checked; missing on either side is a
 * hard violation naming the field, never a silently skipped comparison. `--compare`'s own break-proof
 * (documented in `93-09-SUMMARY.md`) demonstrates this sentinel is load-bearing: with it temporarily
 * removed, a selector broken identically on both sides reports a false PASS; restoring it turns that
 * same run into a FAIL naming the empty field.
 *
 * SELECTOR STRATEGY — card-face notices (`CardView.tsx`) are read directly out of Board (overlay)
 * mode's DOM with no click at all: each fixture card renders its notice unconditionally once seeded,
 * so there is nothing to select. The CleanupModal and the panel's own warning notice require opening
 * the detail panel, which — per the Phase 55 methodology trap panel-92.mjs's header documents — must
 * go through Orca/docked mode (`localStorage["dsp.view"] = "orca"` + a real `Page.reload`) and click
 * the Orca nav row, never a card in Board mode (a full-viewport click-outside backdrop there
 * intercepts a raw click at a card's coordinates before it lands). Every fixture card's identifier is
 * globally unique across the whole fixture set, so a leaf-text search — an element with zero DOM
 * children whose trimmed `textContent` exactly matches the fixed string under test — never needs to
 * be scoped to a particular card's subtree for the card-face reads; it throws if more than one leaf
 * matches, which would mean two fixtures produced the same rendered text and the capture can no
 * longer say which fixture it came from.
 *
 * CARD FIXTURES — three N=1 (one session) Done cards, one field of interest each (so no fixture's
 * notices can collide with another's in the leaf-text search): a countdown card (`cleanupDueAt` 5h30m
 * out — comfortably mid-bucket so the whole run's wall-clock drift can never cross an hour boundary),
 * a blocked card (`cleanupBlocked` on two repos, counts 1 and 3 — the singular/plural branch), and a
 * warning card (`cleanupWarning` a fixed harness string). Two more Done cards exist ONLY on the
 * current build: an N=2 confirm card (two clean sessions, to read the session-count copy) and an N=2
 * blocked card (only the SECOND, more-recently-created session blocked, to read the `Session 2 — ...`
 * naming). `Card.cleanup{DueAt,Warning,Blocked}` are flat MIRRORS of the active session's own field,
 * written only by production's mutation methods gated on `resolvedId === card.activeSessionId` — NOT
 * derived at read time — so seeding via a direct `node:sqlite` insert (bypassing those methods
 * entirely) must set the field on BOTH the session record AND the card's flat mirror to reproduce the
 * shape a real write would have produced. `CardView.tsx` and `CleanupModal.tsx` both read the flat
 * card-level fields at N=1 on EITHER build (`CleanupModal`'s `summaries == null` branch falls back to
 * `card.cleanupBlocked` exactly like v2.9.0 always did) — the "difference in HOW the value arrives"
 * the plan names is this write-time/read-time distinction, not a different render path at N=1.
 *
 * Usage:
 *   node scripts/panel-93.mjs --legacy [--json <path>]
 *                                                 Build+boot the v2.9.0 TAG in a throwaway worktree,
 *                                                 seed the three N=1 fixtures (v2.9.0 has no N>=2
 *                                                 concept), measure every N=1 field, remove the
 *                                                 worktree. Combine with --json to capture the BEFORE
 *                                                 snapshot --compare diffs against.
 *   node scripts/panel-93.mjs --compare <path>    HEAD run: seed all five fixtures, measure every N=1
 *                                                 field plus the N>=2 recording, diff the N=1 fields
 *                                                 against a previous --legacy JSON at ZERO tolerance
 *                                                 (after the missing-subject sentinel passes on both
 *                                                 sides), and assert the N>=2 capture differs from its
 *                                                 N=1 counterpart.
 *   node scripts/panel-93.mjs [--json <path>]     Plain HEAD run with no baseline: seed, measure,
 *                                                 print (or write) the capture.
 *
 * Exit codes: 0 every check PASS. 1 a live :4700, a failed build, a sandbox/worktree-safety
 * violation, a card the evaluate could not find, a missing-subject sentinel violation, any
 * `--compare` mismatch, an N>=2 capture that failed to differ from its N=1 counterpart, the real
 * board.db changing during the run, or a sandbox port still held after teardown.
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

/** Full `build` (web + server) — this instrument reads rendered DOM, so a server-only build is not enough. */
const BUILD_SCRIPT = "build";

/** The published tag `--legacy` materializes and boots. */
const OLD_RELEASE_TAG = "v2.9.0";
const OLD_RELEASE_COMMIT = "fb75ede";

/** Distinct from every other scripts/*.mjs sandbox port/CDP port pair in this repo (93-09-PLAN.md). */
const SANDBOX_PORT = 47866;
const CDP_PORT = 9368;
const SANDBOX_PREFIX = "dispatch-panel-93-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RESIZE_SETTLE_MS = 250;
const RENDER_TIMEOUT_MS = 15_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** A wide, non-narrow viewport throughout — keeps `PanelHeader`'s "Clean up now" button text-labelled. */
const VIEWPORT = { width: 1600, height: 1000 };

const N1_COUNTDOWN_ID = "PANEL93-N1-COUNTDOWN";
const N1_BLOCKED_ID = "PANEL93-N1-BLOCKED";
const N1_WARNING_ID = "PANEL93-N1-WARNING";
const N2_CONFIRM_ID = "PANEL93-N2-CONFIRM";
const N2_BLOCKED_ID = "PANEL93-N2-BLOCKED";

/** Comfortably mid-bucket: even a multi-minute run delay between seed and read cannot cross an hour boundary. */
const COUNTDOWN_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const WARNING_TEXT = "panel-93 harness: workspace cleanup left files behind";

const BLOCKED_LABEL_TEXT = "Uncommitted work — cleanup blocked";

const N1_BLOCKED_ENTRIES = [
  { repo: "api", count: 1 },
  { repo: "web", count: 3 },
];

const N2_BLOCKED_ENTRIES = [{ repo: "api", count: 2 }];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. A
 * `PANEL-93-LIVE` token is embedded so the reason a run aborted is greppable from stderr alone. Only
 * a fetch rejection (ECONNREFUSED — nothing listening) is the safe path; that rejection is swallowed
 * here, everything else re-thrown.
 */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-93-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board — " +
        "refusing to boot a sandbox server while the user's real service is up (its boot-time " +
        "reconcile pass sweeps ttyd machine-wide). Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-93-LIVE"))
      throw err;
  }
}

/** Scoped to disk state only (the sandbox HOME and the sandbox port) — see the file header. */
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

/** The throwaway-worktree equivalent of {@link assertSandboxSafe} — path safety, never process safety. */
function assertWorktreeSafe(path) {
  if (path === REPO_ROOT) {
    throw new Error(
      "comparison worktree path must never equal the repo root itself.",
    );
  }
  if (!path.startsWith(tmpdir())) {
    throw new Error(
      `comparison worktree ${path} must live under ${tmpdir()} — refusing to proceed.`,
    );
  }
  if (!basename(path).startsWith(`${SANDBOX_PREFIX}worktree-`)) {
    throw new Error(
      `comparison worktree ${path} must have a basename starting with "${SANDBOX_PREFIX}worktree-" — refusing to proceed.`,
    );
  }
}

/** Obviously-fake placeholder Linear key, clearing the first-run gate without ever touching a real key. */
const FAKE_LINEAR_API_KEY = "panel-93-harness-fake-key-never-real";

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

/** Memoized HEAD build result — see {@link assertBuilt}. */
let headBuild = null;

/**
 * Build HEAD's web bundle and server, then confirm the entry point exists. Unconditional (never
 * mtime-gated), matching panel-92.mjs's own {@link assertBuilt} precedent and rationale.
 */
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
 * Materialize the `v2.9.0` tag into a throwaway `git worktree` under `os.tmpdir()`, `npm ci` +
 * `npm run build` it, and return its server entry point. NEVER reused inside the main repo's own
 * checkout, NEVER touches the main repo's working tree or index (`git worktree add --detach`).
 * Caller is responsible for {@link removeOldReleaseWorktree} once done measuring.
 */
function buildOldReleaseWorktree() {
  const treeRoot = join(
    tmpdir(),
    `${SANDBOX_PREFIX}worktree-${OLD_RELEASE_TAG}-${process.pid}`,
  );
  assertWorktreeSafe(treeRoot);
  rmSync(treeRoot, { recursive: true, force: true });
  const startedAt = Date.now();
  try {
    execFileSync(
      "git",
      ["worktree", "add", "--detach", treeRoot, OLD_RELEASE_TAG],
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `could not create a worktree at ${OLD_RELEASE_TAG} (${OLD_RELEASE_COMMIT}) — the comparison ` +
        `build needs the published tag, this refuses to substitute a stand-in:\n${detail || err.message}`,
    );
  }
  const headCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: treeRoot,
  })
    .toString()
    .trim();
  if (
    !OLD_RELEASE_COMMIT.startsWith(headCommit) &&
    !headCommit.startsWith(OLD_RELEASE_COMMIT)
  ) {
    throw new Error(
      `worktree at ${treeRoot} resolved to ${headCommit}, expected ${OLD_RELEASE_COMMIT} (${OLD_RELEASE_TAG}) — refusing to measure the wrong build.`,
    );
  }
  try {
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: treeRoot,
      stdio: "pipe",
    });
    execFileSync("npm", ["run", BUILD_SCRIPT], {
      cwd: treeRoot,
      stdio: "pipe",
    });
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `could not build ${OLD_RELEASE_TAG} in the throwaway worktree (npm ci may need network on a cold cache):\n${detail || err.message}`,
    );
  }
  const entry = join(treeRoot, "dist", "server", "bootstrap", "index.js");
  if (!existsSync(entry)) {
    throw new Error(
      `Missing ${entry} after building ${OLD_RELEASE_TAG} at ${treeRoot}.`,
    );
  }
  console.log(
    `preflight: built ${OLD_RELEASE_TAG} (${headCommit}) in a throwaway worktree in ${Date.now() - startedAt}ms -> ${entry}`,
  );
  return { treeRoot, entry, resolvedCommit: headCommit };
}

/** Remove the throwaway worktree via `git worktree remove` + `git worktree prune`, never `rm -rf` alone. */
function removeOldReleaseWorktree(treeRoot) {
  assertWorktreeSafe(treeRoot);
  try {
    execFileSync("git", ["worktree", "remove", "--force", treeRoot], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch (err) {
    console.error(
      `WARNING: \`git worktree remove\` failed for ${treeRoot}: ${err.message} — attempting rmSync + prune`,
    );
    rmSync(treeRoot, { recursive: true, force: true });
  }
  execFileSync("git", ["worktree", "prune"], { cwd: REPO_ROOT, stdio: "pipe" });
}

/**
 * Boot a server entry point (HEAD's or the legacy worktree's) against `home`. Only ever production
 * builds.
 * @remarks `entry` is REALPATH'd before being handed to `node` as `argv[1]` — see panel-92.mjs's
 * identically-named function for the full macOS-symlink mechanism this guards against.
 */
function bootServerAt(entry, home) {
  return spawn("node", [realpathSync(entry)], {
    env: { ...process.env, HOME: home, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "ignore"],
  });
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

async function evalValue(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: false },
    sessionId,
  );
  if (exceptionDetails) {
    throw new Error(
      `Runtime.evaluate failed: ${exceptionDetails.text} — ${expression}`,
    );
  }
  return result.value;
}

/** Build one session record with `tmuxSession`/`workspacePath` set — `awaitingCleanup` needs at least one truthy. */
function makeSession(home, slug, createdAtOffsetMs) {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - createdAtOffsetMs).toISOString();
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    tmuxSession: `dsp-panel93-${slug}`,
    ttydPort: undefined,
    workspacePath: join(
      home,
      "workspaces",
      `panel93-${slug}-${id.slice(0, 8)}`,
    ),
  };
}

const FIXTURE_TITLE =
  "Panel-93 fixture card for the N=1 cleanup-copy parity instrument";

/**
 * The five modern (HEAD-shape) fixture cards. `cardFor`'s cleanup-field mirror onto the flat card
 * fields is done HERE, by hand, because production only performs that mirror at WRITE time (gated on
 * `resolvedId === card.activeSessionId`) — never derived at read time — and this seed goes straight
 * to `node:sqlite`, bypassing every write-time method entirely. See the file header's CARD FIXTURES
 * paragraph for why this is the correct fixture shape rather than a workaround.
 */
function makeModernFixtures(home) {
  const now = new Date().toISOString();
  const dueAt = Date.now() + COUNTDOWN_OFFSET_MS;

  const countdownSession = makeSession(home, "countdown", 4000);
  countdownSession.cleanupDueAt = dueAt;

  const blockedSession = makeSession(home, "blocked", 4000);
  blockedSession.cleanupBlocked = N1_BLOCKED_ENTRIES;

  const warningSession = makeSession(home, "warning", 4000);
  warningSession.cleanupWarning = WARNING_TEXT;
  /** `DetailPanel.tsx`'s `hasLiveSession = !!(tmuxSession && !sessionLost)` gates `ReferenceBlocks` — the
   * panel's own cleanup-warning notice — behind a collapsed `detailsExpanded` toggle when true. Leaving
   * `tmuxSession` unset (still `workspacePath`-truthy, so `awaitingCleanup` is untouched) keeps
   * `hasLiveSession` false, so the notice renders unconditionally without an extra click. */
  warningSession.tmuxSession = undefined;

  const n2ConfirmA = makeSession(home, "n2confirm-a", 5000);
  const n2ConfirmB = makeSession(home, "n2confirm-b", 3000);

  const n2BlockedA = makeSession(home, "n2blocked-a", 5000);
  const n2BlockedB = makeSession(home, "n2blocked-b", 3000);
  n2BlockedB.cleanupBlocked = N2_BLOCKED_ENTRIES;

  function cardFor(id, identifier, activeSession, siblingSessions = []) {
    return {
      id,
      issueId: `${id}-issue`,
      identifier,
      title: FIXTURE_TITLE,
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      sessions: [activeSession, ...siblingSessions],
      activeSessionId: activeSession.id,
      tmuxSession: activeSession.tmuxSession,
      ttydPort: activeSession.ttydPort,
      workspacePath: activeSession.workspacePath,
      cleanupDueAt: activeSession.cleanupDueAt,
      cleanupWarning: activeSession.cleanupWarning,
      cleanupBlocked: activeSession.cleanupBlocked,
    };
  }

  return [
    cardFor("panel93-n1-countdown", N1_COUNTDOWN_ID, countdownSession),
    cardFor("panel93-n1-blocked", N1_BLOCKED_ID, blockedSession),
    cardFor("panel93-n1-warning", N1_WARNING_ID, warningSession),
    cardFor("panel93-n2-confirm", N2_CONFIRM_ID, n2ConfirmA, [n2ConfirmB]),
    cardFor("panel93-n2-blocked", N2_BLOCKED_ID, n2BlockedA, [n2BlockedB]),
  ];
}

/**
 * The three legacy (v2.9.0-shape) fixture cards: flat `tmuxSession`/`workspacePath`/`cleanupDueAt`/
 * `cleanupWarning`/`cleanupBlocked` fields directly on the card, matching that release's `Card`
 * interface (`git show v2.9.0:src/shared/types.ts` — grep-confirmed no `sessions` array exists in
 * that shape). No N>=2 fixture: v2.9.0 has no `sessionSummaries` concept to produce one from.
 */
function makeLegacyFixtures(home) {
  const now = new Date().toISOString();
  const dueAt = Date.now() + COUNTDOWN_OFFSET_MS;

  function legacyCard(id, identifier, extra) {
    return {
      id,
      issueId: `${id}-issue`,
      identifier,
      title: FIXTURE_TITLE,
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      tmuxSession: `dsp-panel93-legacy-${id}`,
      ttydPort: undefined,
      workspacePath: join(home, "workspaces", `panel93-legacy-${id}`),
      ...extra,
    };
  }

  return [
    legacyCard("panel93-n1-countdown", N1_COUNTDOWN_ID, {
      cleanupDueAt: dueAt,
    }),
    legacyCard("panel93-n1-blocked", N1_BLOCKED_ID, {
      cleanupBlocked: N1_BLOCKED_ENTRIES,
    }),
    legacyCard("panel93-n1-warning", N1_WARNING_ID, {
      cleanupWarning: WARNING_TEXT,
      tmuxSession: undefined,
    }),
  ];
}

/**
 * Boot once against the empty sandbox home so the store creates the real schema, kill that boot,
 * then insert the fixture rows directly via `node:sqlite` — the panel-92.mjs / migration-diff-v3.mjs
 * seeding idiom, never a hand-duplicated schema. `entry` selects which build does the schema-creating
 * warmup boot, so a legacy-shape board is always created by the legacy build itself.
 */
async function seedFixtureCards(entry, home, fixtures) {
  const warmup = bootServerAt(entry, home);
  try {
    await waitForReady(SANDBOX_PORT);
  } finally {
    await killAndWait(warmup);
  }

  const dbPath = join(home, ".dispatch", "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    const insertCard = db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    );
    db.exec("BEGIN");
    for (const card of fixtures) {
      insertCard.run(card.id, JSON.stringify(card));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

/**
 * Poll until the initial (Board-mode) load has actually reached the app's own origin and rendered
 * every fixture identifier somewhere in `#root` — the panel-92.mjs precedent, unchanged.
 */
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
    `initial board load never rendered every identifier ${identifiers.join(", ")} within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/**
 * Flip the already-loaded page to Orca/docked mode via a real reload (never a synthetic React state
 * poke), then poll until the Orca nav renders every identifier — the panel-92.mjs precedent,
 * unchanged.
 */
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
    `Orca nav never rendered every identifier ${identifiers.join(", ")} within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/**
 * Click the Orca nav row whose text contains `identifier`, via a real `.click()` — safe in
 * docked/Orca mode because there is no full-viewport click-outside backdrop to intercept it (the
 * Phase 55 methodology trap). Throws if zero or more than one row matches. Polls afterward until the
 * panel's `aside` reflects the selected card.
 */
async function selectCardViaOrcaNav(cdp, sessionId, identifier) {
  const clickExpr = `
    (function () {
      var nav = document.querySelector('nav[aria-label="Tickets"]');
      if (!nav) throw new Error("Orca nav not found");
      var rows = Array.prototype.filter.call(
        nav.querySelectorAll('[role="button"]'),
        function (el) { return el.textContent.indexOf("${identifier}") !== -1; },
      );
      if (rows.length === 0) throw new Error("no Orca nav row matched ${identifier}");
      if (rows.length > 1) throw new Error("Orca nav row matched ${identifier} " + rows.length + " times");
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
      return aside.textContent.indexOf("${identifier}") !== -1;
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

/**
 * Board-mode (no click, no selection) card-face capture. Every element with zero DOM children whose
 * trimmed text exactly matches (or, for the countdown, starts with) one of the fixed strings under
 * test — throws if more than one leaf matches a given search, since the fixture set is designed so
 * each notice's text is globally unique across the whole rendered board.
 */
async function captureCardFace(cdp, sessionId) {
  const expr = `
    (function () {
      var leaves = Array.prototype.filter.call(
        document.querySelectorAll("#root *"),
        function (el) { return el.children.length === 0; },
      ).map(function (el) { return el.textContent.trim(); }).filter(function (t) { return t !== ""; });
      var countdown = leaves.filter(function (t) { return t.indexOf("cleans in ") === 0; });
      var blockedLabel = leaves.filter(function (t) { return t === ${JSON.stringify(BLOCKED_LABEL_TEXT)}; });
      var warning = leaves.filter(function (t) { return t === ${JSON.stringify(WARNING_TEXT)}; });
      if (countdown.length > 1) throw new Error("more than one countdown leaf found: " + JSON.stringify(countdown));
      if (blockedLabel.length > 1) throw new Error("more than one blocked-label leaf found: " + JSON.stringify(blockedLabel));
      if (warning.length > 1) throw new Error("more than one card-face warning leaf found: " + JSON.stringify(warning));
      return {
        cardCountdown: countdown[0] ?? null,
        cardBlockedLabel: blockedLabel[0] ?? null,
        cardWarning: warning[0] ?? null,
      };
    })()
  `;
  return evalValue(cdp, sessionId, expr);
}

/** Select `identifier` via the Orca nav, then click the panel's "Clean up now" button and wait for the modal. */
async function openCleanupModal(cdp, sessionId, identifier) {
  await selectCardViaOrcaNav(cdp, sessionId, identifier);
  const clickExpr = `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      if (!aside) throw new Error("ticket detail aside not found");
      var btn = Array.prototype.find.call(aside.querySelectorAll("button"), function (b) {
        return b.textContent.trim() === "Clean up now";
      });
      if (!btn) throw new Error("no 'Clean up now' button found for ${identifier}");
      btn.click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, clickExpr);
  await waitForDialog(cdp, sessionId, true);
}

/** Click "Keep workspace" to dismiss the modal without triggering cleanup, and wait for it to unmount. */
async function closeCleanupModal(cdp, sessionId) {
  const clickExpr = `
    (function () {
      var dlg = document.querySelector('[role="dialog"][aria-label="Clean up workspace"]');
      if (!dlg) throw new Error("cleanup modal not found to close");
      var btn = Array.prototype.find.call(dlg.querySelectorAll("button"), function (b) {
        return b.textContent.trim() === "Keep workspace";
      });
      if (!btn) throw new Error("no Keep workspace button found");
      btn.click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, clickExpr);
  await waitForDialog(cdp, sessionId, false);
}

async function waitForDialog(cdp, sessionId, present) {
  const probe = `document.querySelector('[role="dialog"][aria-label="Clean up workspace"]') !== null`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await evalValue(cdp, sessionId, probe)) === present) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `cleanup dialog did not reach present=${present} within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/**
 * Read the currently-open CleanupModal's body. `Modal.Body`'s single child is either the confirm-copy
 * div (a text leaf) or the blocked-list div (a heading div followed by one entry div per blocked
 * repo) — the same JSX shape family on both builds, N=1's branch held literal by 93-04. Distinguishes
 * the two by DIV-child count rather than by reading any class name, so it survives a styling change
 * that never touches the copy itself.
 */
async function captureCleanupModal(cdp, sessionId) {
  const expr = `
    (function () {
      var dlg = document.querySelector('[role="dialog"][aria-label="Clean up workspace"]');
      if (!dlg) throw new Error("cleanup modal not found");
      var bodyWrap = dlg.querySelector(".reading-surface");
      if (!bodyWrap) throw new Error("modal body wrapper not found");
      var container = bodyWrap.firstElementChild;
      if (!container) throw new Error("modal body has no content");
      var innerDivs = Array.prototype.filter.call(container.children, function (el) { return el.tagName === "DIV"; });
      var buttons = Array.prototype.map
        .call(dlg.querySelectorAll("button"), function (b) { return b.textContent.trim(); })
        .filter(function (t) { return t !== ""; });
      if (innerDivs.length === 0) {
        return { kind: "confirm", confirmText: container.textContent.trim(), buttons: buttons };
      }
      return {
        kind: "blocked",
        heading: innerDivs[0].textContent.trim(),
        entries: innerDivs.slice(1).map(function (el) { return el.textContent.trim(); }),
        buttons: buttons,
      };
    })()
  `;
  return evalValue(cdp, sessionId, expr);
}

/** Read `ReferenceBlocks.tsx`'s own cleanup-warning notice out of the currently-open panel `aside`. */
async function capturePanelWarning(cdp, sessionId) {
  const expr = `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      if (!aside) throw new Error("ticket detail aside not found");
      var leaves = Array.prototype.filter.call(aside.querySelectorAll("*"), function (el) { return el.children.length === 0; })
        .map(function (el) { return el.textContent.trim(); })
        .filter(function (t) { return t !== ""; });
      var matches = leaves.filter(function (t) { return t === ${JSON.stringify(WARNING_TEXT)}; });
      if (matches.length > 1) throw new Error("more than one panel-warning leaf found: " + JSON.stringify(matches));
      return matches[0] ?? null;
    })()
  `;
  return evalValue(cdp, sessionId, expr);
}

async function runMeasurement(cdp, sessionId, legacy) {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { ...VIEWPORT, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await sleep(RESIZE_SETTLE_MS);

  const identifiers = legacy
    ? [N1_COUNTDOWN_ID, N1_BLOCKED_ID, N1_WARNING_ID]
    : [
        N1_COUNTDOWN_ID,
        N1_BLOCKED_ID,
        N1_WARNING_ID,
        N2_CONFIRM_ID,
        N2_BLOCKED_ID,
      ];

  await waitForBoardRootLoaded(cdp, sessionId, identifiers);
  const cardFace = await captureCardFace(cdp, sessionId);

  await enableOrcaMode(cdp, sessionId, identifiers);

  await openCleanupModal(cdp, sessionId, N1_COUNTDOWN_ID);
  const confirmCapture = await captureCleanupModal(cdp, sessionId);
  await closeCleanupModal(cdp, sessionId);

  await openCleanupModal(cdp, sessionId, N1_BLOCKED_ID);
  const blockedCapture = await captureCleanupModal(cdp, sessionId);
  await closeCleanupModal(cdp, sessionId);

  await selectCardViaOrcaNav(cdp, sessionId, N1_WARNING_ID);
  const panelWarning = await capturePanelWarning(cdp, sessionId);

  const n1 = {
    confirmText:
      confirmCapture.kind === "confirm" ? confirmCapture.confirmText : null,
    confirmButtons:
      confirmCapture.kind === "confirm" ? confirmCapture.buttons : null,
    blockedHeading:
      blockedCapture.kind === "blocked" ? blockedCapture.heading : null,
    blockedEntries:
      blockedCapture.kind === "blocked" ? blockedCapture.entries : null,
    blockedButtons:
      blockedCapture.kind === "blocked" ? blockedCapture.buttons : null,
    cardCountdown: cardFace.cardCountdown,
    cardBlockedLabel: cardFace.cardBlockedLabel,
    cardWarning: cardFace.cardWarning,
    panelWarning,
  };

  if (legacy) return { n1, n2: null };

  await openCleanupModal(cdp, sessionId, N2_CONFIRM_ID);
  const n2ConfirmCapture = await captureCleanupModal(cdp, sessionId);
  await closeCleanupModal(cdp, sessionId);

  await openCleanupModal(cdp, sessionId, N2_BLOCKED_ID);
  const n2BlockedCapture = await captureCleanupModal(cdp, sessionId);
  await closeCleanupModal(cdp, sessionId);

  const n2 = {
    confirmText:
      n2ConfirmCapture.kind === "confirm" ? n2ConfirmCapture.confirmText : null,
    blockedHeading:
      n2BlockedCapture.kind === "blocked" ? n2BlockedCapture.heading : null,
    blockedEntries:
      n2BlockedCapture.kind === "blocked" ? n2BlockedCapture.entries : null,
  };

  return { n1, n2 };
}

/** Every N=1 field compared at zero tolerance, string-valued fields listed separately from array-valued ones. */
const N1_STRING_FIELDS = [
  "confirmText",
  "blockedHeading",
  "cardCountdown",
  "cardBlockedLabel",
  "cardWarning",
  "panelWarning",
];
const N1_ARRAY_FIELDS = ["confirmButtons", "blockedEntries", "blockedButtons"];

/**
 * THE MISSING-SUBJECT SENTINEL. A selector that stopped matching yields `null`/`""` — this refuses
 * to let that read as a match. Always pushes a violation on failure rather than silently skipping the
 * field; the caller decides whether to also run the equality check based on this function's return.
 */
function assertNonEmptyString(value, label, violations) {
  if (typeof value !== "string" || value.trim() === "") {
    violations.push(
      `MISSING-SUBJECT ${label}: expected a non-empty string, got ${JSON.stringify(value)}`,
    );
    return false;
  }
  return true;
}

/** The array-valued counterpart of {@link assertNonEmptyString} — every element must itself be non-empty. */
function assertNonEmptyArray(value, label, violations) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((v) => typeof v !== "string" || v.trim() === "")
  ) {
    violations.push(
      `MISSING-SUBJECT ${label}: expected a non-empty array of non-empty strings, got ${JSON.stringify(value)}`,
    );
    return false;
  }
  return true;
}

/**
 * Diff every N=1 field at zero tolerance, sentinel-gated per {@link assertNonEmptyString}/
 * {@link assertNonEmptyArray}. `disableSentinel` exists ONLY for the vacuous-comparison break-proof
 * documented in `93-09-SUMMARY.md` — production use (both `--compare` invocations in this file's own
 * `main()`) always leaves it `false`.
 */
function compareN1(before, after, disableSentinel = false) {
  const violations = [];
  for (const field of N1_STRING_FIELDS) {
    const b = before.n1[field];
    const a = after.n1[field];
    if (disableSentinel) {
      if (b !== a)
        violations.push(
          `MISMATCH n1.${field}: legacy=${JSON.stringify(b)} current=${JSON.stringify(a)}`,
        );
      continue;
    }
    const bOk = assertNonEmptyString(b, `n1.${field} (legacy)`, violations);
    const aOk = assertNonEmptyString(a, `n1.${field} (current)`, violations);
    if (bOk && aOk && b !== a) {
      violations.push(
        `MISMATCH n1.${field}: legacy=${JSON.stringify(b)} current=${JSON.stringify(a)}`,
      );
    }
  }
  for (const field of N1_ARRAY_FIELDS) {
    const b = before.n1[field];
    const a = after.n1[field];
    if (disableSentinel) {
      if (JSON.stringify(b) !== JSON.stringify(a))
        violations.push(
          `MISMATCH n1.${field}: legacy=${JSON.stringify(b)} current=${JSON.stringify(a)}`,
        );
      continue;
    }
    const bOk = assertNonEmptyArray(b, `n1.${field} (legacy)`, violations);
    const aOk = assertNonEmptyArray(a, `n1.${field} (current)`, violations);
    if (bOk && aOk && JSON.stringify(b) !== JSON.stringify(a)) {
      violations.push(
        `MISMATCH n1.${field}: legacy=${JSON.stringify(b)} current=${JSON.stringify(a)}`,
      );
    }
  }
  return violations;
}

/**
 * Record (never diff against the legacy baseline — v2.9.0 cannot produce this) and assert the N>=2
 * copy actually differs from its N=1 counterpart. An N>=2 capture that happened to equal N=1 would
 * mean session naming was never wired at all, which would otherwise pass silently (93-09-PLAN.md
 * criterion D).
 */
function checkN2Distinct(after) {
  const violations = [];
  if (!after.n2) {
    violations.push("N2-MISSING: current build produced no n2 capture");
    return violations;
  }
  assertNonEmptyString(after.n2.confirmText, "n2.confirmText", violations);
  assertNonEmptyString(
    after.n2.blockedHeading,
    "n2.blockedHeading",
    violations,
  );
  assertNonEmptyArray(after.n2.blockedEntries, "n2.blockedEntries", violations);
  if (after.n2.confirmText === after.n1.confirmText) {
    violations.push(
      `N2-NOT-DISTINCT n2.confirmText equals n1.confirmText: ${JSON.stringify(after.n2.confirmText)}`,
    );
  }
  if (
    JSON.stringify(after.n2.blockedEntries) ===
    JSON.stringify(after.n1.blockedEntries)
  ) {
    violations.push(
      `N2-NOT-DISTINCT n2.blockedEntries equals n1.blockedEntries: ${JSON.stringify(after.n2.blockedEntries)}`,
    );
  }
  return violations;
}

function readFlag(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  const val = argv[idx + 1];
  if (!val) {
    console.error(`${name} requires a path argument`);
    process.exit(1);
  }
  return val;
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

/** Warn-and-report (never throw) whether either sandbox port is still held after teardown. */
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

async function main() {
  const argv = process.argv.slice(2);
  const jsonPath = readFlag(argv, "--json");
  const comparePath = readFlag(argv, "--compare");
  const legacy = argv.includes("--legacy");
  const disableSentinel = argv.includes(
    "--disable-sentinel-for-break-proof-only",
  );

  await assertNoLiveService();

  let entry;
  let worktreeToRemove = null;
  let resolvedCommit = null;
  if (legacy) {
    const built = buildOldReleaseWorktree();
    entry = built.entry;
    worktreeToRemove = built.treeRoot;
    resolvedCommit = built.resolvedCommit;
  } else {
    assertBuilt();
    entry = DIST_ENTRY;
  }

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(
    `${legacy ? "legacy" : "head"}-run-${process.pid}`,
  );
  let server = null;
  let chromeChild = null;
  let cdp = null;
  let readings = null;
  let portsHeld = false;

  try {
    const fixtures = legacy
      ? makeLegacyFixtures(home)
      : makeModernFixtures(home);
    await seedFixtureCards(entry, home, fixtures);

    server = bootServerAt(entry, home);
    await waitForReady(SANDBOX_PORT);

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

    {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let up = false;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
          await res.body?.cancel();
          if (res.status === 200) {
            up = true;
            break;
          }
        } catch {
          // Chrome debugging port not up yet — keep polling
        }
        await sleep(POLL_INTERVAL_MS);
      }
      if (!up)
        throw new Error(`Chrome debugging port :${CDP_PORT} did not come up`);
    }

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

    readings = await runMeasurement(cdp, sessionId, legacy);
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    await killAndWait(server);
    rmSync(home, { recursive: true, force: true });
    rmSync(join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`), {
      recursive: true,
      force: true,
    });
    portsHeld = await checkPortsHeld();
    if (worktreeToRemove) {
      removeOldReleaseWorktree(worktreeToRemove);
      console.log(`teardown: removed comparison worktree ${worktreeToRemove}`);
    }
  }

  const realAfter = statRealBoardDb();
  console.log(`LIVE ${realAfter.path} AFTER: ${fmtStat(realAfter)}`);
  if (
    realBefore.exists !== realAfter.exists ||
    realBefore.mtimeMs !== realAfter.mtimeMs ||
    realBefore.size !== realAfter.size
  ) {
    console.log(
      `FAIL: the real ${realAfter.path} changed during this run — this must never happen. before=${fmtStat(realBefore)} after=${fmtStat(realAfter)}`,
    );
    process.exit(1);
  }

  if (resolvedCommit) {
    console.log(
      `legacy build resolved to ${OLD_RELEASE_TAG} @ ${resolvedCommit}`,
    );
  }

  const output = { legacy, resolvedCommit, n1: readings.n1, n2: readings.n2 };
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(output, null, 2) + "\n");
    console.log(`wrote readings to ${jsonPath}`);
  }

  let violations = [];
  if (comparePath) {
    const before = JSON.parse(readFileSync(comparePath, "utf8"));
    violations = violations.concat(compareN1(before, output, disableSentinel));
    if (!legacy) violations = violations.concat(checkN2Distinct(output));
    for (const v of violations) console.log(v);
  } else if (!jsonPath) {
    console.log("\n" + JSON.stringify(output, null, 2));
  }

  if (portsHeld) {
    console.log("FAIL: sandbox port(s) still held after teardown");
    process.exit(1);
  }

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} violation(s)`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`panel-93 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
