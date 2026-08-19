/**
 * Phase 96 plan 08 UI measurement instrument (`KEEP-04`, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/ — the same category as panel-92/93/94/95.mjs.
 * It reads computed styles out of a real Chrome against a real sandboxed dispatch server and
 * compares them against `docs/standards/design-contract.md`'s named values, for the THREE surfaces
 * `96-01-SUMMARY.md` derived from reading this milestone's diff hunks (not the eleven-file census
 * verbatim, and not remembered): `DetailPanel.tsx`'s new session row, `SessionSwitcher.tsx`'s
 * radius vocabulary and accent usage, and `StartModal.tsx`'s `InheritToggleSection` type scale.
 *
 * Source inspection was explicitly rejected for this milestone's contract verdicts — it reads what
 * the code SAYS, not what the browser COMPUTES, and this milestone's own panel instruments have
 * repeatedly found the two disagreeing (the mono-sizing-rule and radius-bucket corrections recorded
 * in `design-contract.md` itself both came from a live read overturning a source-level assumption).
 *
 * The other eight files in the eleven-file `v2.9.0..HEAD` census carry NO verdict here, by design —
 * `96-01-SUMMARY.md` read every hunk and found each one either non-rendering (`card-attention.ts`,
 * `lib/api.ts`, `lib/start-request.ts`) or touching no contract-named value (`App.tsx`, `CardView.tsx`,
 * `StartAnotherSessionButton.tsx` — composes the unchanged `Button` primitive, `TerminalRegion.tsx`,
 * `CleanupModal.tsx`). The exclusion reason for each prints at standup, below, so "not measured" is
 * never silent.
 *
 * SAFETY — copied verbatim from this milestone's own precedent (panel-92/93/94/95.mjs headers).
 * Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via `adoptAndSweep`,
 * fingerprinted by argv shape, never by tmux session name or which board.db spawned it.
 * `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if anything answers
 * on :4700, before this script boots any server or spawns any real process.
 *
 * NO REAL TMUX, NO REAL TTYD, NO REAL SAGA. Every verdict measures DOM shape produced from a wire
 * payload the fixture seeds directly via `node:sqlite` (the `panel-93/94/95.mjs` idiom) — the one
 * fixture card never needs a live terminal. A stub `claude` binary is still planted on PATH as
 * defense-in-depth, branching on `--version` per the boot-hang trap `panel-94/95.mjs` already
 * document (`checkHooksCapability()` probes it, untimeouted, before the server ever listens).
 *
 * TRAP 1 — THE BLIND-GEOMETRY TRAP (Phase 92's third dead instrument, restated in `94/95-UI-SPEC.md`
 * and in this plan's own `<interfaces>` block). A `display:none` or absent node reads a false 0px
 * and a geometry-only check would call that "smaller, therefore correct" instead of "the wrong node
 * entirely." Every geometry/style read below is PAIRED with an independent structural existence
 * assertion on the same node.
 *
 * TRAP 2 — RADIUS BY ROLE, NOT BY CONSTANT. The contract ties radius to element ROLE via a measured
 * height threshold (up to ~19-27px -> `--radius-sm`; up to ~200px -> `--radius`; >=200px or a
 * dismissible float sharing `--shadow-float` -> `--radius-lg`). `expectedRadiusPx()` below derives
 * the expected bucket from each element's own LIVE `getBoundingClientRect().height`, never from a
 * copied per-element pixel constant — this is what would catch a switcher pill that took the wrong
 * bucket, which a hardcoded "segments are 4px" assertion could not.
 *
 * TRAP 3 (v2.9's dead instrument #9, promoted to standing guidance, directly relevant to this
 * plan's break) — A SELECTOR MUST NEVER KEY ON THE PROPERTY IT IS ABOUT TO MUTATE. The break below
 * overrides `border-radius`; every element lookup in this file (including inside the break) finds
 * its target by aria-label, role, or visible ordinal TEXT — never by radius, height, or any other
 * property a check might mutate. A radius-keyed selector would find nothing post-mutation and
 * report "element missing" instead of "value wrong" — a different, weaker assertion.
 *
 * DEAD INSTRUMENT #8's LESSON, applied to the break's restore leg: `el.style.setProperty()` on a
 * longhand OVERWRITES that property's existing inline value; a bare `removeProperty()` afterward
 * does not restore React's original `var(--radius-sm)` text — it just deletes the declaration,
 * falling back to a browser default (0px), not the token. The break therefore CAPTURES the live
 * `el.style.getPropertyValue('border-radius')` string (literally `"var(--radius-sm)"`) before
 * mutating, and restores that exact captured string, never a bare `removeProperty`.
 *
 * macOS TRAP, load-bearing here too: `dist`'s `main()` guard compares `import.meta.url` against an
 * UNRESOLVED `process.argv[1]`; `realpathSync(entry)` before spawn fixes it (see `bootServerAt`).
 *
 * Usage:
 *   node scripts/panel-96.mjs                the real run: all three KEEP-04 contract surfaces plus
 *                                             the KEEP-06 a11y leg (96-09) — SessionSwitcher's
 *                                             never-checked focus-ring leg, CleanupModal's three
 *                                             legs from zero, and research assumption A2 — exits
 *                                             non-zero on any violation.
 *   node scripts/panel-96.mjs --break-radius  96-08 Task 2's proven-mismatch self-check ONLY:
 *                                             overrides one session-switcher segment's border-radius
 *                                             to an off-contract 20px, confirms the SAME check
 *                                             function used by the real run reports the mismatch BY
 *                                             NAME with both the measured and expected values,
 *                                             restores the captured original inline value, and
 *                                             re-confirms PASS — all inside one Chrome tab, never
 *                                             touching a source file. Harness-only.
 *   node scripts/panel-96.mjs --break-a11y    96-09 Task 2's four a11y break legs ONLY (reachability,
 *                                             accessible name, focus-ring TRIP, focus-ring RESTORE)
 *                                             against SessionSwitcher's session pill 1 — every break
 *                                             reuses the SAME check function the real run uses,
 *                                             fires it, records verbatim FAIL output, reverts, and
 *                                             re-confirms PASS. Harness-only; touches no source file.
 *
 * Exit codes: 0 every check PASS (or, under `--break-radius`/`--break-a11y`, every break correctly
 * fired and every restore leg re-passed). 1 a live :4700, a failed build, a sandbox safety
 * violation, a DOM element the evaluate could not find, any measured-criterion violation, the real
 * board.db changing during the run, or a sandbox port still held after teardown.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
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
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const BUILD_SCRIPT = "build";

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair in this repo. */
const SANDBOX_PORT = 47869;
const CDP_PORT = 9371;
const SANDBOX_PREFIX = "dispatch-panel-96-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RESIZE_SETTLE_MS = 250;
const RENDER_TIMEOUT_MS = 15_000;
/** Sub-pixel tolerance for a live `getBoundingClientRect()`/computed-value read against a fixed integer. */
const PX_TOLERANCE = 0.5;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** `>=1600px`, `1024-1599px`, `768-1023px`, `<768px` — the four breakpoints the contract names. */
const BREAKPOINTS = [
  { name: "1600", width: 1600, height: 1000 },
  { name: "1280", width: 1280, height: 900 },
  { name: "900", width: 900, height: 800 },
  { name: "390", width: 390, height: 844 },
];

const FAKE_LINEAR_API_KEY = "panel-96-harness-fake-key-never-real";

const CARD_ID = "panel96-chain";
const IDENTIFIER = "PANEL96-CHAIN";
/** `KEEP-06` (96-09) — CleanupModal has never had a dedicated a11y verdict; two fixture cards give
 * it the confirm-copy path and the blocked/destructive-action-name path. */
const CLEANUP_CONFIRM_CARD_ID = "panel96-cleanup-confirm";
const CLEANUP_CONFIRM_IDENTIFIER = "PANEL96-CLEANUP-CONFIRM";
const CLEANUP_BLOCKED_CARD_ID = "panel96-cleanup-blocked";
const CLEANUP_BLOCKED_IDENTIFIER = "PANEL96-CLEANUP-BLOCKED";
const ALL_IDENTIFIERS = [
  IDENTIFIER,
  CLEANUP_CONFIRM_IDENTIFIER,
  CLEANUP_BLOCKED_IDENTIFIER,
];

/**
 * The eleven-file `v2.9.0..HEAD` census, read hunk-by-hunk by `96-01-SUMMARY.md`, and this run's
 * disposition for each — printed at standup so "not measured" is never silent (acceptance
 * criterion: "any surface deliberately excluded carries a stated reason in the output").
 */
const CENSUS_DISPOSITION = [
  {
    file: "src/web/App.tsx",
    measured: false,
    reason:
      "non-visual: 25-line diff is intent/state wiring only, no rendered value introduced",
  },
  {
    file: "src/web/features/board/CardView.tsx",
    measured: false,
    reason:
      "text/tooltip content and a startCard() arg only, no styling token touched",
  },
  {
    file: "src/web/features/board/card-attention.ts",
    measured: false,
    reason: "non-rendering module (JSDoc-only diff)",
  },
  {
    file: "src/web/features/detail/DetailPanel.tsx",
    measured: true,
    reason:
      "new session row: spacing scale + hairline border on a rendered container",
  },
  {
    file: "src/web/features/detail/SessionSwitcher.tsx",
    measured: true,
    reason: "wholly new: radius vocabulary + a new --accent consumer",
  },
  {
    file: "src/web/features/detail/StartAnotherSessionButton.tsx",
    measured: false,
    reason:
      "composes the unchanged Button primitive; invents no new visual treatment",
  },
  {
    file: "src/web/features/detail/TerminalRegion.tsx",
    measured: false,
    reason:
      "4-line diff is a data-source swap (session id/port); iframe style byte-identical",
  },
  {
    file: "src/web/features/modals/CleanupModal.tsx",
    measured: false,
    reason:
      "copy/iteration-logic diff only; reuses existing color token unchanged",
  },
  {
    file: "src/web/features/modals/StartModal.tsx",
    measured: true,
    reason:
      "new InheritToggleSection: type scale, --line-body, checkbox accentColor, focusRing()",
  },
  {
    file: "src/web/lib/api.ts",
    measured: false,
    reason: "non-rendering module (fetch/network code, no JSX or style object)",
  },
  {
    file: "src/web/lib/start-request.ts",
    measured: false,
    reason: "non-rendering module (type-only diff)",
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-96-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board — " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-96-LIVE"))
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

/** `entry` is REALPATH'd before being handed to `node` — the macOS /var -> /private/var trap. */
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
 * Plant a stub `claude` executable at `<home>/bin/claude` — defense in depth only, since this run
 * seeds all fixture state directly via `node:sqlite` and never drives a real saga. MUST branch on
 * `--version`: `checkHooksCapability()` probes it, untimeouted, before the sandbox server ever
 * starts listening (94-05's finding) — a stub blocking unconditionally hangs the boot.
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
      "echo 'panel-96 stub claude — deliberately never ready'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
}

/**
 * Create a throwaway local git repo under the sandbox HOME (never a real project repo) with one
 * committed file, then REGISTER it as a workspace folder via a real `POST /api/workspace-folders`
 * call — `StartModal`'s `useWorkspacePicker` reads the GLOBAL registered-folder list, never the
 * card's own `workspace` field, so this registration is what makes the modal's own "Start" button
 * reach an enabled state through real UI interaction. `git config` is set LOCALLY only.
 */
async function seedFixtureRepoAndRegister(home, port) {
  const repoPath = join(home, "repos", "alpha");
  mkdirSync(repoPath, { recursive: true });
  await execFileP("git", ["init"], { cwd: repoPath });
  await execFileP("git", ["config", "user.email", "harness@localhost"], {
    cwd: repoPath,
  });
  await execFileP("git", ["config", "user.name", "panel-96 harness"], {
    cwd: repoPath,
  });
  writeFileSync(join(repoPath, "README.md"), "fixture base\n");
  await execFileP("git", ["add", "README.md"], { cwd: repoPath });
  await execFileP("git", ["commit", "-m", "fixture base", "--no-gpg-sign"], {
    cwd: repoPath,
  });
  const folder = join(home, "repos");
  const res = await fetch(`http://127.0.0.1:${port}/api/workspace-folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: folder }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `POST /api/workspace-folders failed: ${res.status} ${body}`,
    );
  }
  await res.body?.cancel().catch(() => {});
  return { repoPath, folder };
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

async function evalReport(cdp, sessionId, violations, label, expr) {
  try {
    return await evalValue(cdp, sessionId, expr);
  } catch (err) {
    violations.push(`${label}: ${err.message}`);
    return null;
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

// ---------------------------------------------------------------------------
// Fixture card — one card, two sessions (session 2 built from session 1), a
// real registered workspace folder so BOTH SessionSwitcher AND
// StartAnotherSessionButton render in the same DetailPanel row.
// ---------------------------------------------------------------------------

function makeInertSession(slug, createdAtOffsetMs, extra) {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - createdAtOffsetMs).toISOString();
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    tmuxSession: undefined,
    ttydPort: undefined,
    workspacePath: undefined,
    ...extra,
  };
}

function makeFixture(workspacePath) {
  const s1 = makeInertSession("s1", 6000, { workspacePath });
  const s2 = makeInertSession("s2", 3000, { builtFrom: s1.id, workspacePath });
  const now = new Date().toISOString();
  return {
    id: CARD_ID,
    issueId: `${CARD_ID}-issue`,
    identifier: IDENTIFIER,
    title: "panel-96 fixture card",
    description: null,
    priority: 3,
    column: "in_progress",
    groupId: undefined,
    updatedAt: now,
    workspacePath,
    activeSessionId: s1.id,
    tmuxSession: undefined,
    sessions: [s1, s2],
  };
}

/**
 * `awaitingCleanup` (`PanelHeader.tsx:78-79`) needs `column === "done"` plus a truthy
 * `tmuxSession`/`workspacePath` — neither needs to point at anything real on disk, since this
 * fixture never opens a terminal or calls the cleanup route, only renders and drives the modal.
 * `blocked` mirrors `cleanupBlocked` onto the flat card field the way production's write-time
 * mirror does at N=1 (`panel-93.mjs`'s own `cardFor` does the identical hand-mirror for the same
 * reason: this seed bypasses every write-time method by going straight to `node:sqlite`).
 */
function makeCleanupFixture(id, identifier, home, blocked) {
  const s = makeInertSession(id, 4000, {
    workspacePath: join(home, "workspaces", `${id}-ws`),
  });
  if (blocked) s.cleanupBlocked = [{ repo: "alpha", count: 2 }];
  const now = new Date().toISOString();
  return {
    id,
    issueId: `${id}-issue`,
    identifier,
    title: "panel-96 cleanup fixture card",
    description: null,
    priority: 3,
    column: "done",
    groupId: undefined,
    updatedAt: now,
    workspacePath: s.workspacePath,
    activeSessionId: s.id,
    tmuxSession: undefined,
    cleanupBlocked: s.cleanupBlocked,
    sessions: [s],
  };
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93/94/95.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
 * every fixture row (`cards`, plural) directly via `node:sqlite` in the same pass.
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
          `seedFixtureCards: schema not yet created after warmup attempt ${attempt}/${ATTEMPTS} — retrying`,
        );
        continue;
      }
      const insert = db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
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

// ---------------------------------------------------------------------------
// Navigation — the panel-92/93/94/95 Orca/docked-mode idiom.
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
      if (rows.length === 0) {
        throw new Error("no Orca nav row matched ${identifier}");
      }
      if (rows.length > 1) {
        throw new Error("Orca nav row matched ${identifier} " + rows.length + " times");
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

/** Click a session pill by its visible ORDINAL DIGIT — never by radius, height, or any style property. */
async function clickSessionPill(cdp, sessionId, ordinal) {
  const ordinalStr = JSON.stringify(String(ordinal));
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside ? aside.querySelector('[role="group"][aria-label="Sessions"]') : null;
      if (!group) throw new Error("panel96: sessions group not found");
      var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
      var target = btns.find(function (b) { return b.textContent.trim() === ${ordinalStr}; });
      if (!target) throw new Error("panel96: session pill " + ${ordinalStr} + " not found");
      target.click();
      return true;
    })()`,
  );
  const probe = `(function () {
    var aside = document.querySelector('aside[aria-label="Ticket detail"]');
    var group = aside ? aside.querySelector('[role="group"][aria-label="Sessions"]') : null;
    if (!group) return false;
    var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
    var target = btns.find(function (b) { return b.textContent.trim() === ${ordinalStr}; });
    return target != null && target.getAttribute("aria-pressed") === "true";
  })()`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `session pill ${ordinal} never went aria-pressed=true within ${RENDER_TIMEOUT_MS}ms`,
  );
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

async function clickStartAnotherSession(cdp, sessionId) {
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var btns = Array.prototype.slice.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button'));
      var start = btns.find(function (b) {
        return b.textContent.trim() === "Start another session" ||
          b.getAttribute("aria-label") === "Start another session" ||
          b.getAttribute("title") === "Start another session";
      });
      if (!start) throw new Error("panel96: 'Start another session' button not found");
      start.click();
      return true;
    })()`,
  );
  const opened = await waitForModal(cdp, sessionId, true);
  if (!opened) {
    throw new Error("panel96: StartModal never opened");
  }
}

/**
 * Locate the inherit checkbox by SECTION SCOPE — never a positional `input[type=checkbox]` index,
 * per `panel-95.mjs`'s own lesson (`RepoRow` renders checkboxes too). Scoped by finding the
 * `<label>` whose text contains the locked primary-line copy `"Build on Session"`.
 */
const FIND_INHERIT_LABEL_SRC = `
  function panel96FindInheritLabel() {
    var dialog = document.querySelector('[role="dialog"][aria-label="Start session"]');
    if (!dialog) return null;
    var labels = Array.prototype.slice.call(dialog.querySelectorAll("label"));
    return labels.find(function (l) { return l.textContent.indexOf("Build on Session") !== -1; }) ?? null;
  }
`;

/**
 * Structurally locate the session row (the DetailPanel container with padding/gap/borderBottom),
 * the sessions group, and the StartAnotherSessionButton — all found by role/aria-label/text, never
 * by any CSS value. `group.parentElement` is `SessionSwitcher`'s own outer wrapper (95-04's caption
 * addition); `wrapper.parentElement` is the DetailPanel row div itself.
 */
const FIND_ROW_SRC = `
  function panel96FindRow() {
    var aside = document.querySelector('aside[aria-label="Ticket detail"]');
    if (!aside) return { aside: null, group: null, wrapper: null, row: null, startBtn: null };
    var group = aside.querySelector('[role="group"][aria-label="Sessions"]');
    var wrapper = group ? group.parentElement : null;
    var row = wrapper ? wrapper.parentElement : null;
    var btns = Array.prototype.slice.call(aside.querySelectorAll("button"));
    var startBtn = btns.find(function (b) {
      return b.textContent.trim() === "Start another session" ||
        b.getAttribute("aria-label") === "Start another session" ||
        b.getAttribute("title") === "Start another session";
    }) ?? null;
    return { aside: aside, group: group, wrapper: wrapper, row: row, startBtn: startBtn };
  }
`;

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
        `PANEL-96-STALE-PORT: :${port} is already held before this run started — a prior run of ` +
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

function readFlag(argv, name) {
  return argv.includes(name);
}

// ---------------------------------------------------------------------------
// Contract-value helpers
// ---------------------------------------------------------------------------

/**
 * Derives the expected radius TOKEN, in px, from a LIVE measured element height — the contract's
 * own role rule (`## Radius`), never a hardcoded per-element constant. `hasFloatShadow` overrides
 * the height bucket per the dismissible-float clause.
 */
function expectedRadiusPx(heightPx, hasFloatShadow) {
  if (hasFloatShadow || heightPx >= 200) return 10; // --radius-lg
  if (heightPx <= 27) return 4; // --radius-sm
  return 6; // --radius (workhorse)
}

/** Read a CSS custom property's resolved value via a disposable, immediately-removed probe node. */
async function readCustomProperty(cdp, sessionId, name) {
  return evalValue(
    cdp,
    sessionId,
    `(function () {
      var probe = document.createElement("span");
      probe.style.color = "var(${name})";
      document.body.appendChild(probe);
      var value = getComputedStyle(probe).color;
      document.body.removeChild(probe);
      return value;
    })()`,
  );
}

// ---------------------------------------------------------------------------
// Surface 1 — DetailPanel's new session row (spacing scale + hairline border)
// ---------------------------------------------------------------------------

async function measureDetailPanelRow(cdp, sessionId, violations, verdicts) {
  console.log("\n--- surface: DetailPanel session row ---");
  const before = violations.length;
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);

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
    const reading = await evalReport(
      cdp,
      sessionId,
      violations,
      `DetailPanel row (@ ${bp.name})`,
      `${FIND_ROW_SRC}
      (function () {
        var r = panel96FindRow();
        var structurallyPresent = r.row != null && r.group != null && r.startBtn != null;
        if (!structurallyPresent) {
          return { structurallyPresent: false, found: { row: r.row != null, group: r.group != null, startBtn: r.startBtn != null } };
        }
        var cs = getComputedStyle(r.row);
        return {
          structurallyPresent: true,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          paddingRight: cs.paddingRight,
          paddingLeft: cs.paddingLeft,
          gap: cs.gap,
          borderBottomWidth: cs.borderBottomWidth,
          borderBottomStyle: cs.borderBottomStyle,
          borderBottomColor: cs.borderBottomColor,
          boxShadow: cs.boxShadow,
          transitionDuration: cs.transitionDuration,
          height: r.row.getBoundingClientRect().height,
        };
      })()`,
    );
    console.log(`DetailPanel row (@ ${bp.name}px): ${JSON.stringify(reading)}`);
    if (reading == null) continue;
    if (!reading.structurallyPresent) {
      violations.push(
        `DetailPanel row (@ ${bp.name}): structural preconditions not met — ${JSON.stringify(reading.found)}`,
      );
      continue;
    }
    const borderColor = await readCustomProperty(cdp, sessionId, "--border");
    const expectations = [
      ["paddingTop", "8px"], // --space-sm
      ["paddingBottom", "8px"], // --space-sm
      ["paddingRight", "16px"], // --space-lg
      ["paddingLeft", "24px"], // --space-xl (explicit paddingLeft override)
      ["gap", "8px"], // --space-sm
      ["borderBottomWidth", "1px"],
      ["borderBottomStyle", "solid"],
    ];
    for (const [key, expected] of expectations) {
      if (reading[key] !== expected) {
        violations.push(
          `DetailPanel row (@ ${bp.name}): ${key} expected ${expected}, got ${reading[key]}`,
        );
      }
    }
    if (reading.borderBottomColor !== borderColor) {
      violations.push(
        `DetailPanel row (@ ${bp.name}): borderBottomColor expected the live --border value (${borderColor}), got ${reading.borderBottomColor}`,
      );
    }
    if (reading.boxShadow !== "none") {
      violations.push(
        `DetailPanel row (@ ${bp.name}): elevation invariant — expected boxShadow "none" (no new shadow value introduced), got ${reading.boxShadow}`,
      );
    }
    if (reading.transitionDuration !== "0s") {
      violations.push(
        `DetailPanel row (@ ${bp.name}): motion invariant — expected no transition (this milestone adds none), got transitionDuration=${reading.transitionDuration}`,
      );
    }
  }

  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await sleep(RESIZE_SETTLE_MS);

  const added = violations.slice(before);
  verdicts.push({
    surface: "src/web/features/detail/DetailPanel.tsx — session row",
    pass: added.length === 0,
    violations: added,
  });
}

// ---------------------------------------------------------------------------
// Surface 2 — SessionSwitcher (radius vocabulary by role + accent-role measurement)
// ---------------------------------------------------------------------------

/** The check function itself — reused verbatim by the real run AND by `--break-radius`. */
async function checkSegmentRadius(cdp, sessionId, ordinal, violations, label) {
  const reading = await evalReport(
    cdp,
    sessionId,
    violations,
    label,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside ? aside.querySelector('[role="group"][aria-label="Sessions"]') : null;
      if (!group) return { structurallyPresent: false };
      var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
      var target = btns.find(function (b) { return b.textContent.trim() === ${JSON.stringify(String(ordinal))}; });
      if (!target) return { structurallyPresent: false };
      var cs = getComputedStyle(target);
      var r = target.getBoundingClientRect();
      return {
        structurallyPresent: true,
        height: r.height,
        borderRadius: cs.borderRadius,
      };
    })()`,
  );
  if (reading == null || !reading.structurallyPresent) {
    violations.push(`${label}: session pill ${ordinal} not found structurally`);
    return null;
  }
  const expectedPx = expectedRadiusPx(reading.height, false);
  const measuredPx = parseFloat(reading.borderRadius);
  if (Math.abs(measuredPx - expectedPx) > PX_TOLERANCE) {
    violations.push(
      `${label}: session pill ${ordinal} height=${reading.height}px derives expected radius ${expectedPx}px, but computed border-radius is ${reading.borderRadius}`,
    );
  }
  return { ...reading, expectedPx, measuredPx };
}

async function measureSessionSwitcher(cdp, sessionId, violations, verdicts) {
  console.log("\n--- surface: SessionSwitcher ---");
  const before = violations.length;
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  await clickSessionPill(cdp, sessionId, 2); // active session with a parent, for the accent read

  const accentToken = await readCustomProperty(cdp, sessionId, "--accent");

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

    // Container: role-derived radius bucket (28px tall -> workhorse --radius, per the coded height).
    const containerReading = await evalReport(
      cdp,
      sessionId,
      violations,
      `SessionSwitcher container (@ ${bp.name})`,
      `(function () {
        var aside = document.querySelector('aside[aria-label="Ticket detail"]');
        var group = aside ? aside.querySelector('[role="group"][aria-label="Sessions"]') : null;
        if (!group) return { structurallyPresent: false };
        var cs = getComputedStyle(group);
        var r = group.getBoundingClientRect();
        return { structurallyPresent: true, height: r.height, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, transitionDuration: cs.transitionDuration };
      })()`,
    );
    console.log(
      `SessionSwitcher container (@ ${bp.name}px): ${JSON.stringify(containerReading)}`,
    );
    if (containerReading != null) {
      if (!containerReading.structurallyPresent) {
        violations.push(
          `SessionSwitcher container (@ ${bp.name}): [role=group][aria-label=Sessions] not found`,
        );
      } else {
        const expectedPx = expectedRadiusPx(containerReading.height, false);
        const measuredPx = parseFloat(containerReading.borderRadius);
        if (Math.abs(measuredPx - expectedPx) > PX_TOLERANCE) {
          violations.push(
            `SessionSwitcher container (@ ${bp.name}): height=${containerReading.height}px derives expected radius ${expectedPx}px, but computed border-radius is ${containerReading.borderRadius}`,
          );
        }
        if (containerReading.boxShadow !== "none") {
          violations.push(
            `SessionSwitcher container (@ ${bp.name}): elevation invariant — expected boxShadow "none", got ${containerReading.boxShadow}`,
          );
        }
        if (containerReading.transitionDuration !== "0s") {
          violations.push(
            `SessionSwitcher container (@ ${bp.name}): motion invariant — expected no transition, got ${containerReading.transitionDuration}`,
          );
        }
      }
    }

    // Segments (pills): role-derived radius bucket (24px tall -> --radius-sm).
    for (const ordinal of [1, 2]) {
      await checkSegmentRadius(
        cdp,
        sessionId,
        ordinal,
        violations,
        `SessionSwitcher segment ${ordinal} (@ ${bp.name})`,
      );
    }

    // Accent measurement (raw value only — Task 2 adjudicates against the contract's job list).
    const accentReading = await evalReport(
      cdp,
      sessionId,
      violations,
      `SessionSwitcher accent (@ ${bp.name})`,
      `(function () {
        var aside = document.querySelector('aside[aria-label="Ticket detail"]');
        var group = aside ? aside.querySelector('[role="group"][aria-label="Sessions"]') : null;
        if (!group) return { structurallyPresent: false };
        var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
        var active = btns.find(function (b) { return b.getAttribute("aria-pressed") === "true"; });
        if (!active) return { structurallyPresent: false };
        var cs = getComputedStyle(active);
        return { structurallyPresent: true, color: cs.color, backgroundColor: cs.backgroundColor };
      })()`,
    );
    console.log(
      `SessionSwitcher accent (@ ${bp.name}px): ${JSON.stringify(accentReading)} (live --accent token = ${accentToken})`,
    );
    if (accentReading != null) {
      if (!accentReading.structurallyPresent) {
        violations.push(
          `SessionSwitcher accent (@ ${bp.name}): active session pill not found structurally`,
        );
      } else {
        if (accentReading.color !== accentToken) {
          violations.push(
            `SessionSwitcher accent (@ ${bp.name}): active pill color expected the live --accent value (${accentToken}), got ${accentReading.color}`,
          );
        }
        if (
          accentReading.backgroundColor === "transparent" ||
          accentReading.backgroundColor === "rgba(0, 0, 0, 0)"
        ) {
          violations.push(
            `SessionSwitcher accent (@ ${bp.name}): active pill background expected a non-transparent tint, got ${accentReading.backgroundColor}`,
          );
        }
      }
    }
  }

  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await sleep(RESIZE_SETTLE_MS);

  const added = violations.slice(before);
  verdicts.push({
    surface: "src/web/features/detail/SessionSwitcher.tsx",
    pass: added.length === 0,
    violations: added,
    accentToken,
  });
  return { accentToken };
}

// ---------------------------------------------------------------------------
// Surface 3 — StartModal's InheritToggleSection (type scale + --line-body + accentColor + focusRing)
// ---------------------------------------------------------------------------

async function measureStartModal(cdp, sessionId, violations, verdicts) {
  console.log("\n--- surface: StartModal InheritToggleSection ---");
  const before = violations.length;
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  await clickStartAnotherSession(cdp, sessionId);

  const accentToken = await readCustomProperty(cdp, sessionId, "--accent");

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
    const reading = await evalReport(
      cdp,
      sessionId,
      violations,
      `StartModal InheritToggleSection (@ ${bp.name})`,
      `${FIND_INHERIT_LABEL_SRC}
      (function () {
        var label = panel96FindInheritLabel();
        if (!label) return { structurallyPresent: false };
        var input = label.querySelector('input[type="checkbox"]');
        var spans = label.querySelectorAll("span > span");
        var primary = spans[0] ?? null;
        var helper = spans[1] ?? null;
        if (!input || !primary || !helper) {
          return { structurallyPresent: false, found: { input: input != null, primary: primary != null, helper: helper != null } };
        }
        var primaryCs = getComputedStyle(primary);
        var helperCs = getComputedStyle(helper);
        var inputCs = getComputedStyle(input);
        return {
          structurallyPresent: true,
          primaryFontSize: primaryCs.fontSize,
          primaryLineHeight: primaryCs.lineHeight,
          helperFontSize: helperCs.fontSize,
          helperLineHeight: helperCs.lineHeight,
          accentColor: inputCs.accentColor,
          boxShadow: primaryCs.boxShadow,
          transitionDuration: primaryCs.transitionDuration,
        };
      })()`,
    );
    console.log(
      `StartModal InheritToggleSection (@ ${bp.name}px): ${JSON.stringify(reading)}`,
    );
    if (reading == null) continue;
    if (!reading.structurallyPresent) {
      violations.push(
        `StartModal InheritToggleSection (@ ${bp.name}): structural preconditions not met — ${JSON.stringify(reading.found)}`,
      );
      continue;
    }
    if (reading.primaryFontSize !== "13px") {
      violations.push(
        `StartModal InheritToggleSection (@ ${bp.name}): primary line font-size expected 13px (--font-body), got ${reading.primaryFontSize}`,
      );
    }
    // --line-body is 1.6 inside .reading-surface (Modal.Body's own scope), not the global 1.5 —
    // 13px * 1.6 = 20.8px. A regression here (line-height computing to 19.5px, i.e. 13*1.5) would
    // mean the section rendered OUTSIDE the reading-surface scope, a real structural defect.
    const primaryLineHeightPx = parseFloat(reading.primaryLineHeight);
    if (Math.abs(primaryLineHeightPx - 13 * 1.6) > PX_TOLERANCE) {
      violations.push(
        `StartModal InheritToggleSection (@ ${bp.name}): primary line line-height expected ~${(13 * 1.6).toFixed(2)}px (--line-body=1.6 inside .reading-surface), got ${reading.primaryLineHeight}`,
      );
    }
    if (reading.helperFontSize !== "12px") {
      violations.push(
        `StartModal InheritToggleSection (@ ${bp.name}): helper line font-size expected 12px (--font-label), got ${reading.helperFontSize}`,
      );
    }
    const helperLineHeightPx = parseFloat(reading.helperLineHeight);
    if (Math.abs(helperLineHeightPx - 12 * 1.4) > PX_TOLERANCE) {
      violations.push(
        `StartModal InheritToggleSection (@ ${bp.name}): helper line line-height expected ~${(12 * 1.4).toFixed(2)}px (--line-label=1.4), got ${reading.helperLineHeight}`,
      );
    }
    if (reading.accentColor !== accentToken) {
      violations.push(
        `StartModal InheritToggleSection (@ ${bp.name}): checkbox accent-color expected the live --accent value (${accentToken}), got ${reading.accentColor}`,
      );
    }
    if (reading.boxShadow !== "none") {
      violations.push(
        `StartModal InheritToggleSection (@ ${bp.name}): elevation invariant — expected boxShadow "none", got ${reading.boxShadow}`,
      );
    }
    if (reading.transitionDuration !== "0s") {
      violations.push(
        `StartModal InheritToggleSection (@ ${bp.name}): motion invariant — expected no transition, got ${reading.transitionDuration}`,
      );
    }
  }

  // Focus ring — real Tab traversal to the checkbox, checked once (interaction-gated, not a
  // breakpoint-varying geometry value; the contract's own "How values were checked" section
  // measured this via real keyboard input, not swept per-breakpoint either).
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await sleep(RESIZE_SETTLE_MS);
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      return true;
    })()`,
  );
  let reachedViaTab = false;
  for (let i = 0; i < 40; i++) {
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
    const hit = await evalValue(
      cdp,
      sessionId,
      `${FIND_INHERIT_LABEL_SRC}
      (function () {
        var label = panel96FindInheritLabel();
        var input = label ? label.querySelector('input[type="checkbox"]') : null;
        return input != null && document.activeElement === input;
      })()`,
    );
    if (hit) {
      reachedViaTab = true;
      break;
    }
  }
  console.log(
    `StartModal focus ring: reached checkbox via Tab = ${reachedViaTab}`,
  );
  if (!reachedViaTab) {
    violations.push(
      "StartModal InheritToggleSection: Tab traversal never reached the inherit checkbox",
    );
  } else {
    const outline = await evalValue(
      cdp,
      sessionId,
      `(function () {
        var s = getComputedStyle(document.activeElement);
        return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, outlineColor: s.outlineColor, outlineOffset: s.outlineOffset };
      })()`,
    );
    console.log(`StartModal focus ring: ${JSON.stringify(outline)}`);
    if (outline.outlineWidth !== "2px" || outline.outlineStyle !== "solid") {
      violations.push(
        `StartModal InheritToggleSection: expected outline "2px solid", got width=${outline.outlineWidth} style=${outline.outlineStyle}`,
      );
    }
    if (outline.outlineColor !== accentToken) {
      violations.push(
        `StartModal InheritToggleSection: expected outline color to be the live --accent value (${accentToken}), got ${outline.outlineColor}`,
      );
    }
    if (outline.outlineOffset !== "2px") {
      violations.push(
        `StartModal InheritToggleSection: expected outline-offset 2px, got ${outline.outlineOffset}`,
      );
    }
  }

  await evalValue(
    cdp,
    sessionId,
    `(function () {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      return true;
    })()`,
  );
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
  await waitForModal(cdp, sessionId, false).catch(() => {});

  const added = violations.slice(before);
  verdicts.push({
    surface: "src/web/features/modals/StartModal.tsx — InheritToggleSection",
    pass: added.length === 0,
    violations: added,
  });
}

// ---------------------------------------------------------------------------
// Surface 4/5 — KEEP-06 a11y leg (96-09). SessionSwitcher's never-checked focus-ring
// leg, and CleanupModal's three legs measured from zero. Every leg reports
// reachable/operable, focus visibly painted, and accessible name announced
// SEPARATELY, per this plan's own must_haves.
// ---------------------------------------------------------------------------

/** Paired `rawKeyDown` + `keyUp` CDP dispatch (`panel-92.mjs:830-836`'s proven shape) — a `Tab`
 * with no `text` payload, so `rawKeyDown` is correct here (unlike Enter/Space below). */
async function dispatchTab(cdp, sessionId, shift = false) {
  const modifiers = shift ? 8 : 0;
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "rawKeyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      modifiers,
    },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      modifiers,
    },
    sessionId,
  );
}

/** Enter is a TEXT-producing key — `keyDown` (never `rawKeyDown`) is required or the dispatch is a
 * silent no-op, the exact trap `panel-94.mjs:1373-1377` recorded live. */
async function dispatchEnter(cdp, sessionId) {
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
    { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    sessionId,
  );
}

async function dispatchEscape(cdp, sessionId) {
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
}

async function blurActiveElement(cdp, sessionId) {
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
}

async function readActiveOutline(cdp, sessionId) {
  return evalValue(
    cdp,
    sessionId,
    `(function () {
      var s = getComputedStyle(document.activeElement);
      return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle };
    })()`,
  );
}

/**
 * Reads the BROWSER-COMPUTED accessible name via the CDP `Accessibility` domain (not a DOM
 * attribute read) — closes research assumption A2, which explicitly requires the two to be
 * independently checkable since they can disagree. `returnByValue: false` yields an `objectId`,
 * `DOM.requestNode` resolves it to a `nodeId`, `Accessibility.getPartialAXTree` reads the
 * browser's own accessible-name computation for that node.
 */
async function readAccessibleName(cdp, sessionId, expression) {
  await cdp.send("DOM.enable", {}, sessionId);
  await cdp.send("Accessibility.enable", {}, sessionId);
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: false, awaitPromise: false },
    sessionId,
  );
  if (exceptionDetails) {
    throw new Error(
      `readAccessibleName eval failed: ${exceptionDetails.text}\n--- expression ---\n${expression}`,
    );
  }
  if (!result.objectId) {
    return {
      name: null,
      role: null,
      error: "expression did not resolve to an element",
    };
  }
  // `Accessibility.queryAXTree` accepts an `objectId` DIRECTLY — no `DOM.requestNode` hop, which
  // (live-caught in this plan's own development) threw "Could not find node with given id" even
  // after `DOM.enable`/`DOM.getDocument`, apparently because this objectId's backend node was never
  // pushed into the DOM domain's own tracked tree (the element was never queried via `DOM.*`, only
  // ever touched via `Runtime.evaluate`). `queryAXTree` resolves the accessibility node straight
  // from the JS object reference, sidestepping that gap entirely.
  const { nodes } = await cdp.send(
    "Accessibility.queryAXTree",
    { objectId: result.objectId },
    sessionId,
  );
  const node = nodes && nodes[0];
  return { name: node?.name?.value ?? null, role: node?.role?.value ?? null };
}

/** Locate a session pill by its visible ORDINAL DIGIT — never by any style property (dead
 * instrument #9), matching `clickSessionPill`'s own selector shape. */
const FIND_SESSION_PILL_SRC = `
  function panel96FindSessionPill(ordinal) {
    var aside = document.querySelector('aside[aria-label="Ticket detail"]');
    var group = aside ? aside.querySelector('[role="group"][aria-label="Sessions"]') : null;
    if (!group) return null;
    var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
    return btns.find(function (b) { return b.textContent.trim() === String(ordinal); }) ?? null;
  }
`;

/**
 * The RE-CONFIRMED legs (cited from `panel-92.mjs`'s `assertKeyboardTraversal`, 800-861): DOM-order
 * Tab traversal, per-pill `aria-label`, and the container's `role="group"` / `aria-label="Sessions"`.
 * Reused verbatim by both the real run and every `--break-a11y` leg below (the 96-08 idiom: the
 * SAME check function both proves the real behaviour and proves it can fail).
 */
async function checkSessionSwitcherTraversalAndNames(
  cdp,
  sessionId,
  violations,
  label,
) {
  const groupMeta = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside ? aside.querySelector('[role="group"][aria-label="Sessions"]') : null;
      if (!group) return { present: false };
      return {
        present: true,
        role: group.getAttribute("role"),
        ariaLabel: group.getAttribute("aria-label"),
        allLabels: Array.prototype.map.call(group.querySelectorAll("button"), function (b) {
          return b.getAttribute("aria-label");
        }),
      };
    })()`,
  );
  if (!groupMeta.present) {
    violations.push(
      `${label}: [role=group][aria-label=Sessions] container not found`,
    );
    return { visited: [], missing: [], allLabels: [] };
  }
  if (groupMeta.role !== "group" || groupMeta.ariaLabel !== "Sessions") {
    violations.push(
      `${label}: expected role="group" aria-label="Sessions", got role=${groupMeta.role} aria-label=${JSON.stringify(groupMeta.ariaLabel)}`,
    );
  }

  await blurActiveElement(cdp, sessionId);
  const visited = [];
  for (let i = 0; i < 20; i++) {
    await dispatchTab(cdp, sessionId);
    const info = await evalValue(
      cdp,
      sessionId,
      `(function () {
        var aside = document.querySelector('aside[aria-label="Ticket detail"]');
        var group = aside ? aside.querySelector('[role="group"][aria-label="Sessions"]') : null;
        var el = document.activeElement;
        var inside = group ? group.contains(el) : false;
        return { inside: inside, ariaLabel: el ? el.getAttribute("aria-label") : null };
      })()`,
    );
    if (info.inside) visited.push(info.ariaLabel);
    else if (visited.length > 0) break;
  }
  const missing = groupMeta.allLabels.filter((l) => !visited.includes(l));
  console.log(
    `${label}: pills=${JSON.stringify(groupMeta.allLabels)}, Tab-visited(DOM order)=${JSON.stringify(visited)}, missing=${JSON.stringify(missing)}`,
  );
  if (missing.length > 0) {
    violations.push(
      `${label}: session pill(s) not reachable via Tab: ${JSON.stringify(missing)}`,
    );
  }
  if (visited.length !== groupMeta.allLabels.length && missing.length === 0) {
    violations.push(
      `${label}: Tab traversal visited ${visited.length} pill(s), expected ${groupMeta.allLabels.length}`,
    );
  }
  if (visited.some((l) => l == null || l.trim() === "")) {
    violations.push(
      `${label}: one or more Tab-reached session pills had no aria-label — visited=${JSON.stringify(visited)}`,
    );
  }
  return { visited, missing, allLabels: groupMeta.allLabels };
}

/** Reachable AND operable — Enter on a focused, Tab-reached pill must switch the active session
 * (an observed `aria-pressed` state change), not merely move focus onto it. */
async function checkSessionSwitcherOperability(
  cdp,
  sessionId,
  violations,
  label,
) {
  await blurActiveElement(cdp, sessionId);
  let reached = false;
  for (let i = 0; i < 20; i++) {
    await dispatchTab(cdp, sessionId);
    const hit = await evalValue(
      cdp,
      sessionId,
      `${FIND_SESSION_PILL_SRC} document.activeElement === panel96FindSessionPill(1)`,
    );
    if (hit) {
      reached = true;
      break;
    }
  }
  console.log(`${label}: Tab reached session pill 1 = ${reached}`);
  if (!reached) {
    violations.push(`${label}: Tab traversal never reached session pill 1`);
    return;
  }
  const beforePressed = await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC} panel96FindSessionPill(1).getAttribute("aria-pressed")`,
  );
  await dispatchEnter(cdp, sessionId);
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let afterPressed = null;
  while (Date.now() < deadline) {
    afterPressed = await evalValue(
      cdp,
      sessionId,
      `${FIND_SESSION_PILL_SRC} panel96FindSessionPill(1).getAttribute("aria-pressed")`,
    );
    if (afterPressed === "true") break;
    await sleep(POLL_INTERVAL_MS);
  }
  console.log(
    `${label}: session pill 1 aria-pressed ${beforePressed} -> ${afterPressed} on Enter`,
  );
  if (afterPressed !== "true") {
    violations.push(
      `${label}: Enter on a focused, Tab-reachable session pill did not switch the active session (aria-pressed stayed ${JSON.stringify(afterPressed)}) — reachable but not operable`,
    );
  }
}

/** The GAP this plan exists to close, trip half: keyboard Tab to pill 1, read the outline, expect
 * a visible 2px solid ring per the design contract's `focus-ring` role. */
async function checkSessionSwitcherFocusRingKeyboard(
  cdp,
  sessionId,
  violations,
  label,
) {
  await blurActiveElement(cdp, sessionId);
  let reached = false;
  for (let i = 0; i < 20; i++) {
    await dispatchTab(cdp, sessionId);
    const hit = await evalValue(
      cdp,
      sessionId,
      `${FIND_SESSION_PILL_SRC} document.activeElement === panel96FindSessionPill(1)`,
    );
    if (hit) {
      reached = true;
      break;
    }
  }
  if (!reached) {
    violations.push(
      `${label}: Tab traversal never reached session pill 1 for the focus-ring read`,
    );
    return null;
  }
  const outline = await readActiveOutline(cdp, sessionId);
  console.log(`${label}: keyboard focus outline = ${JSON.stringify(outline)}`);
  if (outline.outlineWidth !== "2px" || outline.outlineStyle !== "solid") {
    violations.push(
      `${label}: expected a visible 2px solid focus ring on keyboard focus, got ${JSON.stringify(outline)}`,
    );
  }
  return outline;
}

/** The GAP this plan exists to close, restore half: a GENUINELY fresh page load (Chrome's
 * `:focus-visible` heuristic carries keyboard history over otherwise), a real mouse click, outline
 * read BETWEEN mousedown and mouseup (`panel-94.mjs:1522-1527`'s lesson — the click's own onClick
 * fires only on mouseup and could steal focus by then). */
async function checkSessionSwitcherFocusRingMouse(
  cdp,
  sessionId,
  violations,
  label,
) {
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitForBoardRootLoaded(cdp, sessionId, ALL_IDENTIFIERS);
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  const rect = await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC}
    (function () {
      var target = panel96FindSessionPill(1);
      if (!target) throw new Error("panel96: session pill 1 not found for mouse-click reading");
      var r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: rect.x, y: rect.y },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    },
    sessionId,
  );
  const outline = await evalValue(
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
    `${label}: mouse-click outline (fresh load, read between mousedown and mouseup) = ${JSON.stringify(outline)}`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    },
    sessionId,
  );
  await sleep(100);
  const ringAbsent =
    outline.outlineWidth === "0px" || outline.outlineStyle === "none";
  if (!ringAbsent) {
    violations.push(
      `${label}: expected NO focus ring on a mouse click, got ${JSON.stringify(outline)}`,
    );
  }
  return outline;
}

async function measureSessionSwitcherA11y(
  cdp,
  sessionId,
  violations,
  verdicts,
) {
  console.log("\n--- a11y: SessionSwitcher (KEEP-06) ---");
  const before = violations.length;
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  await clickSessionPill(cdp, sessionId, 2);

  await checkSessionSwitcherTraversalAndNames(
    cdp,
    sessionId,
    violations,
    "SessionSwitcher a11y — Tab order + aria-label + group role (RE-CONFIRMED, cited panel-92.mjs assertKeyboardTraversal)",
  );
  await checkSessionSwitcherOperability(
    cdp,
    sessionId,
    violations,
    "SessionSwitcher a11y — reachable AND operable (Enter switches the active session)",
  );
  await checkSessionSwitcherFocusRingKeyboard(
    cdp,
    sessionId,
    violations,
    "SessionSwitcher a11y — focus ring, keyboard TRIP (the never-checked leg)",
  );
  await checkSessionSwitcherFocusRingMouse(
    cdp,
    sessionId,
    violations,
    "SessionSwitcher a11y — focus ring, mouse RESTORE (the never-checked leg)",
  );

  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await sleep(RESIZE_SETTLE_MS);

  const added = violations.slice(before);
  verdicts.push({
    surface: "src/web/features/detail/SessionSwitcher.tsx — a11y (KEEP-06)",
    pass: added.length === 0,
    violations: added,
  });
}

// ---------------------------------------------------------------------------
// CleanupModal — ZERO dedicated a11y verdict anywhere in panel-92/93/94/95.mjs. All
// three legs measured from scratch, on the confirm-copy path and the blocked
// (destructive-action) path.
// ---------------------------------------------------------------------------

async function waitForCleanupDialog(cdp, sessionId, present) {
  const probe = `document.querySelector('[role="dialog"][aria-label="Clean up workspace"]') !== null`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await evalValue(cdp, sessionId, probe)) === present) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/** Reuses `panel-93.mjs`'s own opening path (`openCleanupModal`, 788-804) — the Orca nav then the
 * panel's "Clean up now" button — rather than inventing a new one. */
async function openCleanupModalByIdentifier(cdp, sessionId, identifier) {
  await selectCardViaOrcaNav(cdp, sessionId, identifier);
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      if (!aside) throw new Error("panel96: ticket detail aside not found for " + ${JSON.stringify(identifier)});
      var btn = Array.prototype.find.call(aside.querySelectorAll("button"), function (b) {
        return b.textContent.trim() === "Clean up now";
      });
      if (!btn) throw new Error("panel96: 'Clean up now' button not found for " + ${JSON.stringify(identifier)});
      btn.click();
      return true;
    })()`,
  );
  const opened = await waitForCleanupDialog(cdp, sessionId, true);
  if (!opened)
    throw new Error(`panel96: CleanupModal never opened for ${identifier}`);
}

/** Dialog accessible name (non-empty `aria-label`, `aria-modal="true"`) and the destructive
 * action's own name — must describe what it does, never a bare "Confirm". */
async function checkCleanupModalAccessibleName(
  cdp,
  sessionId,
  violations,
  label,
  expectDestructive,
) {
  const reading = await evalReport(
    cdp,
    sessionId,
    violations,
    label,
    `(function () {
      var dlg = document.querySelector('[role="dialog"][aria-label="Clean up workspace"]');
      if (!dlg) return { structurallyPresent: false };
      var btns = Array.prototype.slice.call(dlg.querySelectorAll("button"));
      var action = btns.find(function (b) {
        return b.textContent.trim() !== "Keep workspace" && b.getAttribute("aria-label") !== "Close";
      });
      return {
        structurallyPresent: true,
        dialogAriaLabel: dlg.getAttribute("aria-label"),
        ariaModal: dlg.getAttribute("aria-modal"),
        actionName: action ? (action.getAttribute("aria-label") || action.textContent.trim()) : null,
      };
    })()`,
  );
  if (reading == null) return;
  if (!reading.structurallyPresent) {
    violations.push(
      `${label}: [role=dialog][aria-label="Clean up workspace"] not found structurally`,
    );
    return;
  }
  console.log(`${label}: ${JSON.stringify(reading)}`);
  if (!reading.dialogAriaLabel || reading.dialogAriaLabel.trim() === "") {
    violations.push(
      `${label}: dialog aria-label expected non-empty, got ${JSON.stringify(reading.dialogAriaLabel)}`,
    );
  }
  if (reading.ariaModal !== "true") {
    violations.push(
      `${label}: expected aria-modal="true" on the dialog, got ${reading.ariaModal}`,
    );
  }
  const bare =
    reading.actionName != null &&
    reading.actionName.trim().toLowerCase() === "confirm";
  if (bare) {
    violations.push(
      `${label}: destructive action's accessible name is a bare "Confirm" (${JSON.stringify(reading.actionName)}), not descriptive`,
    );
  }
  if (
    expectDestructive &&
    !(reading.actionName && /discard|clean ?up/i.test(reading.actionName))
  ) {
    violations.push(
      `${label}: expected the blocked-variant action name to describe discarding/cleaning up, got ${JSON.stringify(reading.actionName)}`,
    );
  }
}

/** Reachable/operable, INCLUDING the two never-independently-confirmed pieces of `Modal.tsx`'s own
 * wiring this modal inherits: initial focus landing on "Keep workspace" and Escape-to-close. Also
 * measures whether Tab is CONTAINED inside the dialog — `Modal.tsx` implements no focus trap by
 * source (confirmed by reading it), so this leg is expected to be a genuine finding, not assumed
 * one; it is measured here regardless and reported honestly either way. */
async function checkCleanupModalReachability(
  cdp,
  sessionId,
  violations,
  label,
) {
  const initial = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var el = document.activeElement;
      return { tag: el ? el.tagName : null, text: el ? el.textContent.trim() : null };
    })()`,
  );
  console.log(`${label}: initial focus = ${JSON.stringify(initial)}`);
  if (!(initial.tag === "BUTTON" && initial.text === "Keep workspace")) {
    violations.push(
      `${label}: expected initial focus on "Keep workspace" (Modal.tsx's initialFocusRef), got ${JSON.stringify(initial)}`,
    );
  }

  await dispatchTab(cdp, sessionId, true); // Shift+Tab backward from initial focus -> Close (X)
  const backward = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var el = document.activeElement;
      return { tag: el ? el.tagName : null, ariaLabel: el ? el.getAttribute("aria-label") : null };
    })()`,
  );
  console.log(
    `${label}: Shift+Tab from initial focus = ${JSON.stringify(backward)}`,
  );
  if (!(backward.tag === "BUTTON" && backward.ariaLabel === "Close")) {
    violations.push(
      `${label}: expected Shift+Tab from initial focus to reach the Close (X) button, got ${JSON.stringify(backward)}`,
    );
  }

  await dispatchTab(cdp, sessionId); // forward -> back to Keep workspace
  const backToKeep = await evalValue(
    cdp,
    sessionId,
    `(function () { var el = document.activeElement; return el ? el.textContent.trim() : null; })()`,
  );
  console.log(`${label}: Tab from Close (X) = ${JSON.stringify(backToKeep)}`);
  if (backToKeep !== "Keep workspace") {
    violations.push(
      `${label}: expected Tab from Close (X) to return to "Keep workspace", got ${JSON.stringify(backToKeep)}`,
    );
  } else {
    // The focus-ring KEYBOARD TRIP leg, read right here — a REAL Tab keypress just landed on this
    // element, unambiguously "keyboard modality." Reading the ring on the modal's raw INITIAL
    // (programmatic `initialFocusRef.current.focus()`) open state was tried first and was WRONG:
    // that focus follows a synthetic `.click()` open, and Chrome's `:focus-visible` heuristic
    // inherits "mouse" input modality from the immediately-preceding click, painting no ring even
    // though the SAME element correctly paints one when a real Tab keypress reaches it (confirmed
    // live: initial-focus read outlineStyle "none", this real-Tab read outlineStyle "solid").
    const ringLabel = `${label} :: focus ring, keyboard TRIP`;
    const outline = await readActiveOutline(cdp, sessionId);
    console.log(
      `${ringLabel}: outline on Tab-reached "Keep workspace" = ${JSON.stringify(outline)}`,
    );
    if (outline.outlineWidth !== "2px" || outline.outlineStyle !== "solid") {
      violations.push(
        `${ringLabel}: expected a visible 2px solid focus ring on keyboard focus, got ${JSON.stringify(outline)}`,
      );
    }
  }

  await dispatchTab(cdp, sessionId); // forward -> the primary/danger action
  const action = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var dlg = document.querySelector('[role="dialog"][aria-label="Clean up workspace"]');
      var el = document.activeElement;
      return { insideDialog: dlg ? dlg.contains(el) : false, text: el ? el.textContent.trim() : null };
    })()`,
  );
  console.log(`${label}: Tab from Keep workspace = ${JSON.stringify(action)}`);
  if (!action.insideDialog) {
    violations.push(
      `${label}: Tab from "Keep workspace" left the dialog, expected the primary/danger action — got ${JSON.stringify(action)}`,
    );
  }

  // Containment — does Tab past the LAST focusable control stay inside the dialog?
  await dispatchTab(cdp, sessionId);
  const afterLast = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var dlg = document.querySelector('[role="dialog"][aria-label="Clean up workspace"]');
      var el = document.activeElement;
      return {
        insideDialog: dlg ? dlg.contains(el) : false,
        tag: el ? el.tagName : null,
        ariaLabel: el ? el.getAttribute("aria-label") : null,
        text: el ? el.textContent.trim().slice(0, 60) : null,
      };
    })()`,
  );
  console.log(
    `${label}: Tab past the last dialog control (containment check) = ${JSON.stringify(afterLast)}`,
  );
  if (!afterLast.insideDialog) {
    violations.push(
      `${label}: focus escaped the dialog after Tabbing past its last control — Modal.tsx implements no focus trap; landed on ${JSON.stringify(afterLast)} (KEEP-06 finding for 96-11)`,
    );
  }

  await dispatchEscape(cdp, sessionId);
  const closed = await waitForCleanupDialog(cdp, sessionId, false);
  console.log(`${label}: Escape closed the modal = ${closed}`);
  if (!closed) {
    violations.push(`${label}: Escape did not close CleanupModal`);
  }
}

async function checkCleanupModalFocusRingMouse(
  cdp,
  sessionId,
  violations,
  label,
) {
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitForBoardRootLoaded(cdp, sessionId, ALL_IDENTIFIERS);
  await openCleanupModalByIdentifier(
    cdp,
    sessionId,
    CLEANUP_CONFIRM_IDENTIFIER,
  );
  // "Keep workspace" is ALREADY focused (Modal.tsx's initialFocusRef) the instant the modal opens —
  // a mousedown on an already-focused element fires no NEW focus event, so React's onFocus handler
  // (the thing that recomputes `:focus-visible` into the `focused` state) never re-runs and the
  // ring painted by the earlier programmatic focus would survive untested. Blur first so the click
  // below produces a genuine, freshly-observed mouse-triggered focus.
  await blurActiveElement(cdp, sessionId);
  const rect = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var dlg = document.querySelector('[role="dialog"][aria-label="Clean up workspace"]');
      var btns = Array.prototype.slice.call(dlg.querySelectorAll("button"));
      var target = btns.find(function (b) { return b.textContent.trim() === "Keep workspace"; });
      if (!target) throw new Error("panel96: Keep workspace button not found for mouse-click reading");
      var r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: rect.x, y: rect.y },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    },
    sessionId,
  );
  const outline = await evalValue(
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
    `${label}: mouse-click outline (fresh load, read between mousedown and mouseup) = ${JSON.stringify(outline)}`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    },
    sessionId,
  );
  await sleep(100);
  const ringAbsent =
    outline.outlineWidth === "0px" || outline.outlineStyle === "none";
  if (!ringAbsent) {
    violations.push(
      `${label}: expected NO focus ring on a mouse click, got ${JSON.stringify(outline)}`,
    );
  }
  await dispatchEscape(cdp, sessionId);
  await waitForCleanupDialog(cdp, sessionId, false).catch(() => {});
  return outline;
}

async function measureCleanupModalA11y(cdp, sessionId, violations, verdicts) {
  console.log("\n--- a11y: CleanupModal (KEEP-06, zero prior verdict) ---");
  const before = violations.length;

  await openCleanupModalByIdentifier(
    cdp,
    sessionId,
    CLEANUP_CONFIRM_IDENTIFIER,
  );
  await checkCleanupModalAccessibleName(
    cdp,
    sessionId,
    violations,
    "CleanupModal a11y (confirm) — accessible name",
    false,
  );
  // checkCleanupModalReachability's own real Tab traversal reads the focus-ring keyboard TRIP leg
  // inline (right after a genuine Tab keypress lands back on "Keep workspace") — reading the
  // ring on the modal's raw INITIAL open state was tried first and was wrong, see that function's
  // own inline comment.
  await checkCleanupModalReachability(
    cdp,
    sessionId,
    violations,
    "CleanupModal a11y (confirm) — reachable/operable + Escape + containment",
  );

  await checkCleanupModalFocusRingMouse(
    cdp,
    sessionId,
    violations,
    "CleanupModal a11y (confirm) — focus ring, mouse RESTORE",
  );

  await openCleanupModalByIdentifier(
    cdp,
    sessionId,
    CLEANUP_BLOCKED_IDENTIFIER,
  );
  await checkCleanupModalAccessibleName(
    cdp,
    sessionId,
    violations,
    "CleanupModal a11y (blocked) — destructive action's accessible name",
    true,
  );
  await dispatchEscape(cdp, sessionId);
  await waitForCleanupDialog(cdp, sessionId, false).catch(() => {});

  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await sleep(RESIZE_SETTLE_MS);

  const added = violations.slice(before);
  verdicts.push({
    surface:
      "src/web/features/modals/CleanupModal.tsx — a11y (KEEP-06, measured from zero)",
    pass: added.length === 0,
    violations: added,
  });
}

/**
 * Research assumption A2: is the `StartModal` inherit checkbox's accessible NAME an explicit
 * `aria-label`/`aria-labelledby`, or does it rely on visible-label association only (native
 * `<label>`-wrapping)? Closed by BOTH a markup grep AND a CDP-computed accessible-name read,
 * since the two can disagree.
 */
async function closeAssumptionA2(cdp, sessionId, violations, verdicts) {
  console.log(
    "\n--- research assumption A2: StartModal inherit toggle's accessible name ---",
  );
  const before = violations.length;
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  await clickStartAnotherSession(cdp, sessionId);
  const markup = await evalValue(
    cdp,
    sessionId,
    `${FIND_INHERIT_LABEL_SRC}
    (function () {
      var label = panel96FindInheritLabel();
      if (!label) return { present: false };
      var input = label.querySelector('input[type="checkbox"]');
      return {
        present: true,
        inputHasAriaLabel: input ? input.hasAttribute("aria-label") : null,
        inputHasAriaLabelledby: input ? input.hasAttribute("aria-labelledby") : null,
        wrappedByLabel: input ? input.closest("label") === label : null,
      };
    })()`,
  );
  console.log(`A2 markup grep (CDP-read): ${JSON.stringify(markup)}`);
  if (!markup.present) {
    violations.push("A2: inherit checkbox label not found structurally");
  } else {
    const ax = await readAccessibleName(
      cdp,
      sessionId,
      `${FIND_INHERIT_LABEL_SRC} panel96FindInheritLabel().querySelector('input[type="checkbox"]')`,
    );
    console.log(`A2 CDP computed accessible name: ${JSON.stringify(ax)}`);
    if (!ax.name || ax.name.trim() === "") {
      violations.push(
        `A2: inherit checkbox's CDP-computed accessible name is empty — ${JSON.stringify(ax)}`,
      );
    }
    const mechanism =
      markup.inputHasAriaLabel || markup.inputHasAriaLabelledby
        ? "explicit aria-label/aria-labelledby"
        : markup.wrappedByLabel
          ? "native <label>-wrapping association (visible-label only, no explicit aria-label/aria-labelledby)"
          : "unknown — neither an explicit attribute nor label-wrapping detected";
    console.log(
      `A2 verdict: name supplied by ${mechanism}; CDP-computed name = ${JSON.stringify(ax.name)}`,
    );
  }
  await dispatchEscape(cdp, sessionId);
  await waitForModal(cdp, sessionId, false).catch(() => {});
  const added = violations.slice(before);
  verdicts.push({
    surface:
      "src/web/features/modals/StartModal.tsx — inherit toggle accessible name (research assumption A2)",
    pass: added.length === 0,
    violations: added,
  });
}

// ---------------------------------------------------------------------------
// --break-a11y: four independent breaks (reachability, accessible name, focus-ring
// TRIP, focus-ring RESTORE) proving the a11y leg's own assertions are not dead
// instruments. All against SessionSwitcher's session pill 1 — never a source edit,
// every selector keyed on role/aria-label/text, never on the property mutated.
// ---------------------------------------------------------------------------

async function runA11yBreakReachability(cdp, sessionId) {
  console.log("\n--break-a11y: reachability leg");
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  const hadTabindex = await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC} panel96FindSessionPill(1).hasAttribute("tabindex")`,
  );
  console.log(
    `--break-a11y: session pill 1 had an explicit tabindex before the break = ${hadTabindex}`,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC} panel96FindSessionPill(1).tabIndex = -1`,
  );
  const tripViolations = [];
  await checkSessionSwitcherTraversalAndNames(
    cdp,
    sessionId,
    tripViolations,
    "break (reachability leg)",
  );
  console.log(
    `--break-a11y REACHABILITY leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some((v) =>
    v.includes("not reachable via Tab"),
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC}
    (function () {
      var t = panel96FindSessionPill(1);
      if (${JSON.stringify(hadTabindex)}) t.tabIndex = 0;
      else t.removeAttribute("tabindex");
      return true;
    })()`,
  );
  const restoreViolations = [];
  await checkSessionSwitcherTraversalAndNames(
    cdp,
    sessionId,
    restoreViolations,
    "break (reachability leg, restore)",
  );
  console.log(
    `--break-a11y REACHABILITY leg RESTORE: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return { tripFired, restoreClean: restoreViolations.length === 0 };
}

async function runA11yBreakName(cdp, sessionId) {
  console.log("\n--break-a11y: accessible-name leg");
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  const original = await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC} panel96FindSessionPill(1).getAttribute("aria-label")`,
  );
  console.log(
    `--break-a11y: captured original aria-label = ${JSON.stringify(original)}`,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC} panel96FindSessionPill(1).removeAttribute("aria-label")`,
  );
  const tripViolations = [];
  await checkSessionSwitcherTraversalAndNames(
    cdp,
    sessionId,
    tripViolations,
    "break (name leg)",
  );
  console.log(
    `--break-a11y NAME leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const nameFired = tripViolations.some((v) => v.includes("had no aria-label"));
  const stillReachable = !tripViolations.some((v) =>
    v.includes("not reachable via Tab"),
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC} panel96FindSessionPill(1).setAttribute("aria-label", ${JSON.stringify(original)})`,
  );
  const restoreViolations = [];
  await checkSessionSwitcherTraversalAndNames(
    cdp,
    sessionId,
    restoreViolations,
    "break (name leg, restore)",
  );
  console.log(
    `--break-a11y NAME leg RESTORE: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    nameFired,
    stillReachable,
    restoreClean: restoreViolations.length === 0,
  };
}

async function runA11yBreakRingTrip(cdp, sessionId) {
  console.log("\n--break-a11y: focus-ring TRIP leg");
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  await blurActiveElement(cdp, sessionId);
  for (let i = 0; i < 20; i++) {
    await dispatchTab(cdp, sessionId);
    const hit = await evalValue(
      cdp,
      sessionId,
      `${FIND_SESSION_PILL_SRC} document.activeElement === panel96FindSessionPill(1)`,
    );
    if (hit) break;
  }
  // The selector below keys on FOCUS STATE (document.activeElement), never on the outline property
  // the break is about to mutate — dead instrument #9.
  const original = await evalValue(
    cdp,
    sessionId,
    `document.activeElement.style.getPropertyValue("outline")`,
  );
  console.log(
    `--break-a11y: captured original inline outline = ${JSON.stringify(original)}`,
  );
  await evalValue(
    cdp,
    sessionId,
    `document.activeElement.style.setProperty("outline", "none")`,
  );
  const tripOutline = await readActiveOutline(cdp, sessionId);
  console.log(
    `--break-a11y RING TRIP leg FAIL output: keyboard focus outline = ${JSON.stringify(tripOutline)}`,
  );
  const tripFired =
    tripOutline.outlineWidth !== "2px" || tripOutline.outlineStyle !== "solid";
  await evalValue(
    cdp,
    sessionId,
    `document.activeElement.style.setProperty("outline", ${JSON.stringify(original)})`,
  );
  const restoreOutline = await readActiveOutline(cdp, sessionId);
  console.log(
    `--break-a11y RING TRIP leg RESTORE: ${JSON.stringify(restoreOutline)}`,
  );
  const restoreClean =
    restoreOutline.outlineWidth === "2px" &&
    restoreOutline.outlineStyle === "solid";
  return { tripFired, restoreClean };
}

/** Proves the RESTORE leg is independently load-bearing (dead instrument #7's shape) — forces a
 * ring to paint on MOUSE focus and confirms the restore assertion fires, distinctly from the trip
 * leg above. Reverts via a fresh page load (discards the forced inline style entirely) and
 * re-verifies clean through the SAME check function the real run uses. */
async function runA11yBreakRingRestore(cdp, sessionId) {
  console.log("\n--break-a11y: focus-ring RESTORE-leg load-bearing check");
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitForBoardRootLoaded(cdp, sessionId, ALL_IDENTIFIERS);
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  const rect = await evalValue(
    cdp,
    sessionId,
    `${FIND_SESSION_PILL_SRC}
    (function () {
      var t = panel96FindSessionPill(1);
      var r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: rect.x, y: rect.y },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    },
    sessionId,
  );
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var el = document.activeElement;
      if (el && el.tagName === "BUTTON") el.style.setProperty("outline", "2px solid rgb(94, 106, 210)");
      return true;
    })()`,
  );
  const forcedOutline = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var el = document.activeElement;
      if (!el || el.tagName !== "BUTTON") return { outlineWidth: null, outlineStyle: null, wrongElement: true };
      var s = getComputedStyle(el);
      return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle };
    })()`,
  );
  console.log(
    `--break-a11y RING RESTORE leg FAIL output: mouse-click outline (forced) = ${JSON.stringify(forcedOutline)}`,
  );
  const restoreLegFired = !(
    forcedOutline.outlineWidth === "0px" ||
    forcedOutline.outlineStyle === "none"
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    },
    sessionId,
  );
  await sleep(100);

  const reVerifyViolations = [];
  await checkSessionSwitcherFocusRingMouse(
    cdp,
    sessionId,
    reVerifyViolations,
    "break (ring-restore leg) re-verify",
  );
  console.log(
    `--break-a11y RING RESTORE leg RESTORE: ${reVerifyViolations.length === 0 ? "PASS" : `FAIL:\n${reVerifyViolations.join("\n")}`}`,
  );
  return { restoreLegFired, restoreClean: reVerifyViolations.length === 0 };
}

async function runBreakA11y(cdp, sessionId) {
  const reachability = await runA11yBreakReachability(cdp, sessionId);
  const name = await runA11yBreakName(cdp, sessionId);
  const ringTrip = await runA11yBreakRingTrip(cdp, sessionId);
  const ringRestore = await runA11yBreakRingRestore(cdp, sessionId);
  return { reachability, name, ringTrip, ringRestore };
}

// ---------------------------------------------------------------------------
// --break-radius: proves checkSegmentRadius can report a mismatch by name, both
// values printed, then restores the CAPTURED original inline value and re-passes.
// ---------------------------------------------------------------------------

async function runBreakRadius(cdp, sessionId) {
  console.log(
    "\n--break-radius: proving checkSegmentRadius() can report a mismatch, then restoring",
  );
  await selectCardViaOrcaNav(cdp, sessionId, IDENTIFIER);
  await clickSessionPill(cdp, sessionId, 2);

  const original = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside.querySelector('[role="group"][aria-label="Sessions"]');
      var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
      var target = btns.find(function (b) { return b.textContent.trim() === "1"; });
      if (!target) throw new Error("panel96: session pill 1 not found for the break");
      return target.style.getPropertyValue("border-radius");
    })()`,
  );
  console.log(
    `--break-radius: captured original inline value = ${JSON.stringify(original)}`,
  );

  // Trip leg: override to an off-contract 20px. Selector below finds the pill by its ORDINAL TEXT,
  // never by radius — dead instrument #9.
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside.querySelector('[role="group"][aria-label="Sessions"]');
      var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
      var target = btns.find(function (b) { return b.textContent.trim() === "1"; });
      target.style.setProperty("border-radius", "20px");
      return true;
    })()`,
  );
  const tripViolations = [];
  await checkSegmentRadius(
    cdp,
    sessionId,
    1,
    tripViolations,
    "break (trip leg)",
  );
  console.log(
    `--break-radius TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired =
    tripViolations.length > 0 &&
    tripViolations.some((v) => v.includes("20px") && v.includes("4px"));

  // Restore leg: the CAPTURED original string, never a bare removeProperty (dead instrument #8).
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var group = aside.querySelector('[role="group"][aria-label="Sessions"]');
      var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
      var target = btns.find(function (b) { return b.textContent.trim() === "1"; });
      target.style.setProperty("border-radius", ${JSON.stringify(original)});
      return true;
    })()`,
  );
  const restoreViolations = [];
  await checkSegmentRadius(
    cdp,
    sessionId,
    1,
    restoreViolations,
    "break (restore leg)",
  );
  console.log(
    `--break-radius RESTORE leg: ${restoreViolations.length === 0 ? "PASS (no violations)" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  const restoreClean = restoreViolations.length === 0;

  return { tripFired, restoreClean, tripViolations };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const breakRadius = readFlag(argv, "--break-radius");
  const breakA11y = readFlag(argv, "--break-a11y");

  console.log("Census disposition (v2.9.0..HEAD, src/web/):");
  for (const c of CENSUS_DISPOSITION) {
    console.log(
      `  ${c.measured ? "MEASURED" : "excluded"}: ${c.file} — ${c.reason}`,
    );
  }

  await assertNoLiveService();
  await assertSandboxPortsFree();
  assertBuilt();

  const realBefore = statRealBoardDb();
  console.log(`\nLIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  const violations = [];
  const verdicts = [];
  let server = null;
  let chromeChild = null;
  let cdp = null;
  let portsHeld = false;
  let breakResult = null;

  try {
    const pathPrefix = writeStubClaudeBinary(home);
    console.log(`standup: stub claude planted — ${join(pathPrefix, "claude")}`);

    await seedFixtureCards(home, [
      makeFixture(undefined),
      makeCleanupFixture(
        CLEANUP_CONFIRM_CARD_ID,
        CLEANUP_CONFIRM_IDENTIFIER,
        home,
        false,
      ),
      makeCleanupFixture(
        CLEANUP_BLOCKED_CARD_ID,
        CLEANUP_BLOCKED_IDENTIFIER,
        home,
        true,
      ),
    ]);

    server = bootServerAt(home, pathPrefix);
    await waitForReady(SANDBOX_PORT);
    console.log(
      `standup: sandbox server ready on :${SANDBOX_PORT}, pid=${server.pid}`,
    );

    const { folder } = await seedFixtureRepoAndRegister(home, SANDBOX_PORT);
    console.log(
      `standup: fixture repo registered as a workspace folder — ${folder}`,
    );

    // Re-seed with a real workspacePath now that the folder is known (StartAnotherSessionButton's
    // gate needs card.workspacePath != null, and StartModal's picker needs a real registered path).
    // The two cleanup fixtures don't depend on the registered folder — they stay as seeded above.
    await killAndWait(server);
    const db = new DatabaseSync(join(home, ".dispatch", "board.db"));
    try {
      db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      ).run(CARD_ID, JSON.stringify(makeFixture(folder)));
    } finally {
      db.close();
    }
    server = bootServerAt(home, pathPrefix);
    await waitForReady(SANDBOX_PORT);
    console.log(
      `standup: sandbox server re-booted with real fixture, pid=${server.pid}`,
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

    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.exceptionThrown") {
        console.error(
          `page exception: ${JSON.stringify(msg.params.exceptionDetails)}`,
        );
      }
    });

    await enableOrcaMode(cdp, sessionId, ALL_IDENTIFIERS);
    console.log("standup: Orca/docked mode enabled, fixture rendered");

    if (breakRadius) {
      breakResult = await runBreakRadius(cdp, sessionId);
    } else if (breakA11y) {
      breakResult = await runBreakA11y(cdp, sessionId);
    } else {
      await measureDetailPanelRow(cdp, sessionId, violations, verdicts);
      await measureSessionSwitcher(cdp, sessionId, violations, verdicts);
      await measureStartModal(cdp, sessionId, violations, verdicts);
      await measureSessionSwitcherA11y(cdp, sessionId, violations, verdicts);
      await measureCleanupModalA11y(cdp, sessionId, violations, verdicts);
      await closeAssumptionA2(cdp, sessionId, violations, verdicts);
    }
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

  if (breakRadius) {
    console.log(
      `\n--break-radius summary: tripFired=${breakResult.tripFired} restoreClean=${breakResult.restoreClean}`,
    );
    if (!breakResult.tripFired) {
      console.log(
        "FAIL (self-check): the trip leg did NOT report a violation naming both the measured (20px) and expected (4px) values — checkSegmentRadius() is a dead instrument.",
      );
      process.exit(1);
    }
    if (!breakResult.restoreClean) {
      console.log(
        "FAIL (self-check): the restore leg still reports a violation after restoring the captured original inline value.",
      );
      process.exit(1);
    }
    console.log(
      "PASS (--break-radius self-check): trip leg correctly reported the mismatch by name with both values, restore leg re-passed clean.",
    );
    process.exit(0);
  }

  if (breakA11y) {
    const r = breakResult;
    console.log(
      `\n--break-a11y summary: reachability.tripFired=${r.reachability.tripFired} reachability.restoreClean=${r.reachability.restoreClean} ` +
        `name.nameFired=${r.name.nameFired} name.stillReachable=${r.name.stillReachable} name.restoreClean=${r.name.restoreClean} ` +
        `ringTrip.tripFired=${r.ringTrip.tripFired} ringTrip.restoreClean=${r.ringTrip.restoreClean} ` +
        `ringRestore.restoreLegFired=${r.ringRestore.restoreLegFired} ringRestore.restoreClean=${r.ringRestore.restoreClean}`,
    );
    const allGood =
      r.reachability.tripFired &&
      r.reachability.restoreClean &&
      r.name.nameFired &&
      r.name.stillReachable &&
      r.name.restoreClean &&
      r.ringTrip.tripFired &&
      r.ringTrip.restoreClean &&
      r.ringRestore.restoreLegFired &&
      r.ringRestore.restoreClean;
    if (!allGood) {
      console.log(
        "FAIL (--break-a11y self-check): one or more a11y break legs did not fire or did not restore clean — a dead instrument.",
      );
      process.exit(1);
    }
    console.log(
      "PASS (--break-a11y self-check): all four a11y break legs (reachability, name, focus-ring trip, focus-ring restore) fired correctly and restored clean.",
    );
    process.exit(0);
  }

  console.log("\n--- verdicts ---");
  for (const v of verdicts) {
    console.log(`VERDICT ${v.surface}: ${v.pass ? "PASS" : "FAIL"}`);
    if (!v.pass) for (const item of v.violations) console.log(`  - ${item}`);
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
  console.error(`panel-96 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
