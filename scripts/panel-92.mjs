/**
 * Phase 92 plan 06 panel-parity instrument (UI-03, dev/ops tooling, NOT test code): imports no test
 * framework, asserts nothing via an assertion library, lives outside src/ — the same category as
 * check-invariants.mjs, density-91.mjs, and downgrade-guard-v3.mjs. It closes ROADMAP criterion 4:
 * at exactly one session the detail panel must be byte-identical to the shipped v2.9.0 release —
 * no switcher chrome, no extra control, no shifted geometry — MEASURED rather than eyeballed. It
 * also closes the UI-SPEC's lost-sibling assertion (switching the active pointer onto a dead
 * sibling must render `SessionLostSection`, never a blank panel) in the same instrument.
 *
 * SAFETY — copied verbatim from density-91.mjs's own header, load-bearing here too. Booting ANY
 * dispatch server (sandboxed or not, HEAD or the v2.9.0 comparison build) runs `reconcileSessions()`
 * at boot, which sweeps `ttyd` processes MACHINE-WIDE via `adoptAndSweep` — fingerprinted by argv
 * shape, NEVER by tmux session name or by which board.db spawned it. `assertNoLiveService()` is a
 * FAIL-CLOSED pre-flight: it throws (never warns) if anything answers on :4700, before this script
 * boots any server. This instrument itself spawns no real tmux/ttyd — every fixture session field is
 * an inert string, never a live process — but the guard exists anyway because a sandbox server's own
 * boot-time reconcile pass runs unconditionally.
 *
 * `assertSandboxSafe` is scoped to disk state (the sandbox HOME and the sandbox port), not to the
 * machine-wide ttyd sweep `assertNoLiveService` guards against. Only production builds are booted —
 * the Vite dev-server proxy hardcodes its targets to the user's real, live dispatch port and must
 * never be used here.
 *
 * THE BEFORE BUILD IS A REAL v2.9.0 TAG BUILD, NEVER THE LIVE :4700 SERVICE. `:4700` runs the
 * globally installed npm package (three releases stale as of this phase); a parity claim against it
 * would be vacuous. `--legacy` materializes the `v2.9.0` git tag (`fb75ede`) into a THROWAWAY git
 * worktree under `os.tmpdir()` (never inside any repo the board manages), builds it with its own
 * `npm ci` + `npm run build`, boots it, measures, and the caller removes the worktree afterward —
 * the technique Phase 91's residual closure established. The two builds are NEVER booted
 * concurrently — two dispatch servers sweep each other's ttyd machine-wide.
 *
 * SELECTOR STRATEGY — the panel header and the body wrapper carry no `aria-label`/`data-*` of their
 * own in EITHER build (grep-confirmed against both `HEAD` and the `v2.9.0` tag). Both builds render
 * the same three-node shape as direct children of `aside[aria-label="Ticket detail"]` in DOCKED
 * (Orca) mode, where the resize-handle sibling that exists in floating mode is never rendered:
 * `PanelHeader`'s root div is always the aside's FIRST child, and the body wrapper (`flex: "1 1
 * auto"`) is always its LAST child — true whether or not the switcher row (present only at N>=2 on
 * HEAD, never on v2.9.0) sits between them. Index-relative-to-the-fragment selectors, never a fixed
 * numeric index, so the same expression is valid for N=1 and N=2 fixtures on both builds.
 *
 * CARD SELECTION — per the Phase 55 methodology trap this plan inherits: in Board (overlay) mode a
 * full-viewport click-outside backdrop intercepts a raw click at a card's coordinates and closes the
 * panel before the click lands. This instrument therefore ALWAYS drives selection through Orca/docked
 * mode (`localStorage["dsp.view"] = "orca"` + a real `Page.reload`, the same technique
 * `density-91.mjs`'s `switchToOrcaView` established) and clicks the Orca nav row
 * (`nav[aria-label="Tickets"] [role="button"]`), never a card in the Board view.
 *
 * Usage:
 *   node scripts/panel-92.mjs                    HEAD run: seed SOLO/PAIR/LOST, validate every
 *                                                 absolute invariant (structural presence/absence,
 *                                                 PAIR button shape, keyboard order, lost-sibling
 *                                                 DOM), print the reading table.
 *   node scripts/panel-92.mjs --json <path>       HEAD run, write full raw readings as JSON.
 *   node scripts/panel-92.mjs --compare <path>    HEAD run, diff the SOLO geometry/structural fields
 *                                                 against a previous JSON at ZERO tolerance — one
 *                                                 line per mismatch. PAIR/keyboard/lost-sibling
 *                                                 fields are HEAD-only and are reported as such, never
 *                                                 silently skipped.
 *   node scripts/panel-92.mjs --legacy [--json <path>]
 *                                                 Build+boot the v2.9.0 TAG in a throwaway worktree
 *                                                 instead of HEAD, seed ONLY the SOLO fixture (v2.9.0
 *                                                 has no sessionSummaries/PAIR/LOST concept), measure,
 *                                                 remove the worktree. Combine with --json to capture
 *                                                 the BEFORE snapshot the plain HEAD run compares
 *                                                 against.
 *
 * Exit codes: 0 every check PASS. 1 a live :4700, a failed build, a sandbox/worktree-safety
 * violation, a card the evaluate could not find, any absolute-invariant violation, any --compare
 * mismatch, the real board.db changing during the run, or a sandbox port still held after teardown.
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

/** The published tag `--legacy` materializes and boots, matching `92-06-PLAN.md`'s instruction. */
const OLD_RELEASE_TAG = "v2.9.0";
const OLD_RELEASE_COMMIT = "fb75ede";

const SANDBOX_PORT = 47864;
const CDP_PORT = 9367;
const SANDBOX_PREFIX = "dispatch-panel-92-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RESIZE_SETTLE_MS = 250;
const RENDER_TIMEOUT_MS = 15_000;
const TAB_TRAVERSAL_CAP = 60;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** The four UI-SPEC breakpoints, identical to density-91.mjs's own set (same lineage). */
const BREAKPOINTS = [
  { name: "1600", width: 1600, height: 1000 },
  { name: "1280", width: 1280, height: 900 },
  { name: "900", width: 900, height: 800 },
  { name: "390", width: 390, height: 844 },
];

const SOLO_IDENTIFIER = "PANEL-SOLO";
const PAIR_IDENTIFIER = "PANEL-PAIR";
const LOST_IDENTIFIER = "PANEL-LOST";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. A
 * `PANEL-92-LIVE` token is embedded so the reason a run aborted is greppable from stderr alone. Only
 * a fetch rejection (ECONNREFUSED — nothing listening) is the safe path; that rejection is swallowed
 * here, everything else re-thrown.
 */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-92-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board — " +
        "refusing to boot a sandbox server while the user's real service is up (its boot-time " +
        "reconcile pass sweeps ttyd machine-wide). Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-92-LIVE"))
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
const FAKE_LINEAR_API_KEY = "panel-92-harness-fake-key-never-real";

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
 * mtime-gated — `tsc` can leave an output file untouched when its emitted text is unchanged, and
 * this repo is comment-dense enough that a comment-only edit would trip an mtime guard no rebuild
 * could clear), matching density-91.mjs's own {@link assertBuilt} precedent and rationale.
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
  return { treeRoot, entry };
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
 * @remarks `entry` is REALPATH'd before being handed to `node` as `argv[1]`. The bootstrap's own
 * `main()` guard is `import.meta.url === pathToFileURL(process.argv[1]).href` — Node's module
 * loader resolves `import.meta.url` through the filesystem's real path, but `pathToFileURL` does
 * NOT resolve symlinks in `argv[1]`. `os.tmpdir()` on macOS is `/var/folders/...`, and `/var` is
 * itself a symlink to `/private/var`, so an un-resolved worktree entry path makes the two sides of
 * that equality permanently disagree — the guard evaluates false, `main()` is never called, and the
 * process exits 0 with ZERO output, which reads identically to "still starting" until the ready-poll
 * times out. Confirmed by direct repro: `node /tmp/x.mjs` (argv1 unresolved) prints `match? false`;
 * `node /private/tmp/x.mjs` (already the real path) prints `match? true`. HEAD's own `DIST_ENTRY`
 * never hit this because it lives under the repo root, which has no symlinked ancestor — only
 * `--legacy`'s worktree-under-`tmpdir()` entry does.
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

/**
 * Build one session record. `tmuxSession: null` (rather than omitting the key) mints the LOST
 * shape `redactCard` reads via `s.tmuxSession == null` — {@link SessionSummary}'s exact contract.
 */
function makeSession(home, tmuxSession, ttydPort, createdAtOffsetMs) {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - createdAtOffsetMs).toISOString();
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    tmuxSession: tmuxSession ?? undefined,
    ttydPort: ttydPort ?? undefined,
    workspacePath: join(
      home,
      "workspaces",
      basename(home) + "-" + id.slice(0, 8),
    ),
  };
}

/**
 * The three modern (HEAD-shape) fixture cards: SOLO (one session, no `sessionSummaries` on the
 * wire), PAIR (two live-shaped sessions), LOST-SIBLING (two sessions, the second/non-first has no
 * `tmuxSession`, exercising the branch 92-04 fixed). Seeded on `column: "done"` — the same reason
 * density-91.mjs's fixtures are: `reconcileSessions()` and the watcher's 3-strike detector never
 * touch a todo/done card whose claimed tmux session isn't live, so nothing mutates these fields
 * mid-measurement even though no real tmux server is running at all.
 */
function makeModernFixtures(home) {
  const now = new Date().toISOString();
  const title =
    "Panel-92 fixture card for the N=1 parity + lost-sibling instrument";

  const soloSession = makeSession(home, "dsp-panel-solo", 42101, 3000);

  const pairA = makeSession(home, "dsp-panel-pair-a", 42102, 4000);
  const pairB = makeSession(home, "dsp-panel-pair-b", 42103, 2000);

  const lostA = makeSession(home, "dsp-panel-lost-a", 42104, 4000);
  const lostB = makeSession(home, null, null, 2000);
  lostB.workspacePath = join(home, "workspaces", "panel-lost-b");

  return [
    {
      id: "panel-solo",
      issueId: "panel-solo-issue",
      identifier: SOLO_IDENTIFIER,
      title,
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      sessions: [soloSession],
      activeSessionId: soloSession.id,
      tmuxSession: soloSession.tmuxSession,
      ttydPort: soloSession.ttydPort,
      workspacePath: soloSession.workspacePath,
    },
    {
      id: "panel-pair",
      issueId: "panel-pair-issue",
      identifier: PAIR_IDENTIFIER,
      title,
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      sessions: [pairA, pairB],
      activeSessionId: pairA.id,
      tmuxSession: pairA.tmuxSession,
      ttydPort: pairA.ttydPort,
      workspacePath: pairA.workspacePath,
    },
    {
      id: "panel-lost",
      issueId: "panel-lost-issue",
      identifier: LOST_IDENTIFIER,
      title,
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      sessions: [lostA, lostB],
      activeSessionId: lostA.id,
      tmuxSession: lostA.tmuxSession,
      ttydPort: lostA.ttydPort,
      workspacePath: lostA.workspacePath,
    },
  ];
}

/**
 * The single legacy (v2.9.0-shape) fixture card: flat `tmuxSession`/`ttydPort`/`workspacePath`
 * fields directly on the card, matching that release's `Card` interface (`git show
 * v2.9.0:src/shared/types.ts` — grep-confirmed no `sessions` array, no `activeSessionId`, no
 * `sessionSummaries` exist in that shape). A `sessions` array on a v2.9.0-read card would be inert
 * unknown JSON, never rendered — the BEFORE fixture must look like a card that build actually knew
 * how to produce, not a modern card handed to an old reader.
 */
function makeLegacyFixtures(home) {
  const now = new Date().toISOString();
  const workspacePath = join(home, "workspaces", "panel-solo-legacy");
  return [
    {
      id: "panel-solo",
      issueId: "panel-solo-issue",
      identifier: SOLO_IDENTIFIER,
      title:
        "Panel-92 fixture card for the N=1 parity + lost-sibling instrument",
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      tmuxSession: "dsp-panel-solo",
      ttydPort: 42101,
      workspacePath,
    },
  ];
}

/**
 * Boot once against the empty sandbox home so the store creates the real schema, kill that boot,
 * then insert the fixture rows directly via `node:sqlite` — the migration-diff-v3.mjs /
 * density-91.mjs seeding idiom, never a hand-duplicated schema. `entry` selects which build does the
 * schema-creating warmup boot, so a legacy-shape board is always created by the legacy build itself.
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
 * Poll until the initial (Board-mode) load has actually reached the app's own `localStorage`
 * origin and rendered every fixture identifier somewhere in `#root`.
 * @remarks Load-bearing ordering fix: `Target.createTarget` does not wait for navigation to finish,
 * so writing `localStorage["dsp.view"]` immediately after attaching can land on `about:blank`'s
 * separate origin rather than the app's — a write that is silently lost the moment the real
 * navigation completes, after which the reload this function's caller triggers reloads back into
 * Board mode, and the Orca nav probe waits out its own timeout for a nav that was never enabled.
 * Confirmed by reproduction against a real board (fixture present in `/api/board`, absent from the
 * Orca nav) before this wait was added.
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
 * poke — `App.tsx`'s `viewMode` lazily reads `localStorage["dsp.view"]` once on mount, same
 * technique density-91.mjs's `switchToOrcaView` established), then poll until the Orca nav renders
 * every identifier in `identifiers`.
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
 * Click the Orca nav row (`[role="button"]` inside `nav[aria-label="Tickets"]`) whose text contains
 * `identifier`, via a real `.click()` on the resolved DOM node — safe in docked/Orca mode because,
 * unlike Board/overlay mode, there is no full-viewport click-outside backdrop to intercept it (the
 * Phase 55 methodology trap this plan's brief names explicitly). Throws if zero or more than one row
 * matches. Polls afterward until the panel's `aside` reflects the selected card.
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
 * The structural + geometry expression for the currently-open panel. THROWS if the aside, its
 * header (first direct child), or its body wrapper (last direct child) cannot be resolved, or if
 * header and body resolve to the SAME node — a reading that silently reports one element twice is
 * the wrong-subject failure this instrument must be immune to. `structuralPresent` is the PRIMARY
 * check (presence/absence, cannot false-pass on a `display:none` node); `headerBottom`/`bodyTop`/
 * `gap` are the raw numbers so a BEFORE/AFTER diff has something concrete to compare, not just a
 * derived boolean.
 */
const PANEL_MEASURE_EXPR = `
(function () {
  var aside = document.querySelector('aside[aria-label="Ticket detail"]');
  if (!aside) throw new Error("ticket detail aside not found");
  var children = Array.prototype.filter.call(aside.children, function (el) {
    return el.tagName === "DIV";
  });
  if (children.length < 2) throw new Error("aside has fewer than 2 direct div children — header/body could not both resolve");
  var header = children[0];
  var body = children[children.length - 1];
  if (header === body) throw new Error("panel header and body wrapper resolved to the SAME node");
  var group = aside.querySelector('[role="group"][aria-label="Sessions"]');
  var hRect = header.getBoundingClientRect();
  var bRect = body.getBoundingClientRect();
  return {
    structuralPresent: group !== null,
    headerBottom: hRect.bottom,
    bodyTop: bRect.top,
    gap: bRect.top - hRect.bottom,
  };
})()
`;

/**
 * The PAIR-card structural expression: the switcher group must be non-null, carry exactly one
 * `<button>` per fixture session, each button carrying `aria-pressed` and a distinct `aria-label`,
 * and the container itself carrying `role="group"` `aria-label="Sessions"`.
 */
const PAIR_MEASURE_EXPR = `
(function () {
  var aside = document.querySelector('aside[aria-label="Ticket detail"]');
  if (!aside) throw new Error("ticket detail aside not found");
  var group = aside.querySelector('[role="group"][aria-label="Sessions"]');
  if (!group) return { present: false };
  var buttons = Array.prototype.slice.call(group.querySelectorAll("button"));
  var labels = buttons.map(function (b) { return b.getAttribute("aria-label"); });
  var pressedOk = buttons.every(function (b) { return b.hasAttribute("aria-pressed"); });
  return {
    present: true,
    count: buttons.length,
    labels: labels,
    pressedOk: pressedOk,
    distinctLabels: new Set(labels).size === labels.length,
    role: group.getAttribute("role"),
    ariaLabel: group.getAttribute("aria-label"),
  };
})()
`;

/**
 * Reset focus to a neutral baseline (blur whatever is currently focused, so `document.body` — or
 * nothing — is the starting point), then dispatch real `Tab` key events through CDP's `Input`
 * domain (the browser's own input pipeline, the same mechanism Puppeteer's `keyboard.press` uses —
 * NOT a synthetic JS event a React handler could fake-satisfy) and record the DOM-order sequence of
 * distinct `aria-label`s the focus passes through inside the Sessions group, until every expected
 * label has been seen or the cap is hit.
 */
async function assertKeyboardTraversal(cdp, sessionId) {
  const expected = await evalValue(
    cdp,
    sessionId,
    `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside && aside.querySelector('[role="group"][aria-label="Sessions"]');
      if (!group) throw new Error("switcher group not found for keyboard check");
      return Array.prototype.map.call(group.querySelectorAll("button"), function (b) {
        return b.getAttribute("aria-label");
      });
    })()
  `,
  );

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

  const seen = [];
  for (let i = 0; i < TAB_TRAVERSAL_CAP && seen.length < expected.length; i++) {
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
      sessionId,
    );
    const label = await evalValue(
      cdp,
      sessionId,
      `(function () {
        var el = document.activeElement;
        if (!el) return null;
        var group = el.closest('[role="group"][aria-label="Sessions"]');
        if (!group) return null;
        return el.getAttribute("aria-label");
      })()`,
    );
    if (label && (seen.length === 0 || seen[seen.length - 1] !== label)) {
      seen.push(label);
    }
  }

  return {
    expected,
    observed: seen,
    ok: JSON.stringify(expected) === JSON.stringify(seen),
  };
}

/**
 * Click the switcher segment whose `aria-label` matches `label` via `.click()` on the resolved
 * button — safe here for the same reason {@link selectCardViaOrcaNav} is (docked mode, no backdrop).
 */
async function clickSwitcherSegment(cdp, sessionId, label) {
  const expr = `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside && aside.querySelector('[role="group"][aria-label="Sessions"]');
      if (!group) throw new Error("switcher group not found to click");
      var btn = Array.prototype.find.call(group.querySelectorAll("button"), function (b) {
        return b.getAttribute("aria-label") === ${JSON.stringify(label)};
      });
      if (!btn) throw new Error("no segment with aria-label ${label}");
      btn.click();
      return true;
    })()
  `;
  await evalValue(cdp, sessionId, expr);
}

/**
 * Poll until `SessionLostSection`'s "Session lost" `Notice` is present in the currently-open panel,
 * a DOM-presence assertion (never a screenshot) — this is the check that would have failed on the
 * pre-92-04 blank panel, where both the terminal branch and the lost-session branch evaluated false
 * simultaneously.
 */
async function waitForSessionLostSection(cdp, sessionId) {
  const probe = `
    (function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      if (!aside) return null;
      var notices = Array.prototype.filter.call(aside.querySelectorAll("*"), function (el) {
        return el.children.length === 0 && el.textContent.trim() === "Session lost";
      });
      var bodyChildren = Array.prototype.filter.call(aside.children, function (el) { return el.tagName === "DIV"; });
      var body = bodyChildren[bodyChildren.length - 1];
      return {
        present: notices.length > 0,
        bodyTextLength: body ? body.textContent.trim().length : 0,
      };
    })()
  `;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalValue(cdp, sessionId, probe);
    if (last && last.present) return last;
    await sleep(POLL_INTERVAL_MS);
  }
  return last ?? { present: false, bodyTextLength: 0 };
}

async function runMeasurement(cdp, sessionId, legacy) {
  const readings = {};
  let clickedLostSegment = false;

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

    await selectCardViaOrcaNav(cdp, sessionId, SOLO_IDENTIFIER);
    const solo = await evalValue(cdp, sessionId, PANEL_MEASURE_EXPR);

    if (legacy) {
      readings[bp.name] = { solo };
      continue;
    }

    await selectCardViaOrcaNav(cdp, sessionId, PAIR_IDENTIFIER);
    const pair = await evalValue(cdp, sessionId, PAIR_MEASURE_EXPR);
    const keyboard = await assertKeyboardTraversal(cdp, sessionId);

    await selectCardViaOrcaNav(cdp, sessionId, LOST_IDENTIFIER);
    if (!clickedLostSegment) {
      await clickSwitcherSegment(cdp, sessionId, "Session 2 — lost");
      clickedLostSegment = true;
    }
    const lostSibling = await waitForSessionLostSection(cdp, sessionId);

    readings[bp.name] = { solo, pair, keyboard, lostSibling };
  }
  return readings;
}

/**
 * Diff only the fields that exist on BOTH sides at ZERO tolerance — the SOLO structural/geometry
 * numbers. Fields the `before` snapshot lacks (PAIR/keyboard/lostSibling, absent from a `--legacy`
 * snapshot by construction — v2.9.0 has no sessionSummaries) are reported as AFTER-only rather than
 * silently skipped, per the plan's explicit instruction.
 */
function compareReadings(before, after) {
  const violations = [];
  const notes = [];
  for (const bp of BREAKPOINTS) {
    const b = before[bp.name];
    const a = after[bp.name];
    if (!b || !a) {
      violations.push(
        `${bp.name}: missing reading in ${!b ? "baseline" : "fresh run"}`,
      );
      continue;
    }
    for (const field of [
      "structuralPresent",
      "headerBottom",
      "bodyTop",
      "gap",
    ]) {
      if (b.solo?.[field] !== a.solo?.[field]) {
        violations.push(
          `${bp.name}.solo.${field}: expected ${b.solo?.[field]}, got ${a.solo?.[field]}`,
        );
      }
    }
    if (b.pair === undefined && a.pair !== undefined) {
      notes.push(
        `${bp.name}.pair: AFTER-only, no BEFORE counterpart (v2.9.0 has no sessionSummaries)`,
      );
    }
    if (b.keyboard === undefined && a.keyboard !== undefined) {
      notes.push(`${bp.name}.keyboard: AFTER-only, no BEFORE counterpart`);
    }
    if (b.lostSibling === undefined && a.lostSibling !== undefined) {
      notes.push(`${bp.name}.lostSibling: AFTER-only, no BEFORE counterpart`);
    }
  }
  return { violations, notes };
}

/** Absolute invariants that hold regardless of any BEFORE baseline — validated on every HEAD run. */
function assertAbsoluteInvariants(readings, legacy) {
  const violations = [];
  for (const bp of BREAKPOINTS) {
    const r = readings[bp.name];
    if (!r) {
      violations.push(`${bp.name}: no reading captured`);
      continue;
    }
    if (r.solo.structuralPresent !== false) {
      violations.push(
        `${bp.name}: SOLO structural check expected null/absent, querySelector returned a node`,
      );
    }
    if (r.solo.gap !== 0) {
      violations.push(
        `${bp.name}: SOLO geometry gap expected 0, got ${r.solo.gap} (header.bottom=${r.solo.headerBottom}, body.top=${r.solo.bodyTop})`,
      );
    }
    if (legacy) continue;

    if (r.pair?.present !== true) {
      violations.push(
        `${bp.name}: PAIR structural check expected the switcher group present, got absent`,
      );
    } else {
      if (r.pair.count !== 2) {
        violations.push(
          `${bp.name}: PAIR expected 2 buttons, got ${r.pair.count}`,
        );
      }
      if (r.pair.pressedOk !== true) {
        violations.push(
          `${bp.name}: PAIR expected every button to carry aria-pressed`,
        );
      }
      if (r.pair.distinctLabels !== true) {
        violations.push(
          `${bp.name}: PAIR expected distinct aria-labels, got ${JSON.stringify(r.pair.labels)}`,
        );
      }
      if (r.pair.role !== "group" || r.pair.ariaLabel !== "Sessions") {
        violations.push(
          `${bp.name}: PAIR group expected role="group" aria-label="Sessions", got role=${r.pair.role} aria-label=${r.pair.ariaLabel}`,
        );
      }
    }
    if (r.keyboard?.ok !== true) {
      violations.push(
        `${bp.name}: keyboard traversal expected ${JSON.stringify(r.keyboard?.expected)}, observed ${JSON.stringify(r.keyboard?.observed)}`,
      );
    }
    if (r.lostSibling?.present !== true) {
      violations.push(
        `${bp.name}: lost-sibling SessionLostSection expected present, was absent (bodyTextLength=${r.lostSibling?.bodyTextLength})`,
      );
    }
    if ((r.lostSibling?.bodyTextLength ?? 0) === 0) {
      violations.push(
        `${bp.name}: lost-sibling panel body is EMPTY — the pre-92-04 blank-panel defect`,
      );
    }
  }
  return violations;
}

function printTable(readings, legacy) {
  console.log(
    "\nbreakpoint  solo.structural  solo.gap  " +
      (legacy
        ? ""
        : "pair.count  pair.distinct  keyboard.ok  lostSibling.present"),
  );
  for (const bp of BREAKPOINTS) {
    const r = readings[bp.name];
    const line = [
      bp.name.padEnd(12),
      String(r.solo.structuralPresent).padEnd(17),
      String(r.solo.gap).padEnd(10),
    ];
    if (!legacy) {
      line.push(
        String(r.pair?.count).padEnd(12),
        String(r.pair?.distinctLabels).padEnd(15),
        String(r.keyboard?.ok).padEnd(13),
        String(r.lostSibling?.present),
      );
    }
    console.log(line.join(""));
  }
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

  await assertNoLiveService();

  let entry;
  let worktreeToRemove = null;
  if (legacy) {
    const built = buildOldReleaseWorktree();
    entry = built.entry;
    worktreeToRemove = built.treeRoot;
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

    const identifiers = legacy
      ? [SOLO_IDENTIFIER]
      : [SOLO_IDENTIFIER, PAIR_IDENTIFIER, LOST_IDENTIFIER];
    await enableOrcaMode(cdp, sessionId, identifiers);

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

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(readings, null, 2) + "\n");
    console.log(`wrote readings to ${jsonPath}`);
  }

  const invariantViolations = assertAbsoluteInvariants(readings, legacy);
  for (const v of invariantViolations) console.log(`INVARIANT VIOLATION ${v}`);

  let compareViolations = [];
  if (comparePath) {
    const before = JSON.parse(readFileSync(comparePath, "utf8"));
    const { violations, notes } = compareReadings(before, readings);
    for (const n of notes) console.log(`NOTE ${n}`);
    for (const v of violations) console.log(`MISMATCH ${v}`);
    compareViolations = violations;
  }

  if (!jsonPath && !comparePath) {
    printTable(readings, legacy);
  }

  if (portsHeld) {
    console.log("FAIL: sandbox port(s) still held after teardown");
    process.exit(1);
  }

  const total = invariantViolations.length + compareViolations.length;
  if (total > 0) {
    console.log(`\nFAIL: ${total} violation(s)/mismatch(es)`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`panel-92 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
