/**
 * Phase 98 plan 07 UI measurement instrument (PRLINK-01/02/03/06, dev/ops tooling, NOT test code):
 * no test framework, no assertion library, lives outside src/, the same category as
 * panel-92/93/94/95/96.mjs. It reads computed DOM out of a real headless Chrome against a real
 * sandboxed dispatch server seeded with five fixture cards, proving the browser actually renders
 * the four claims plan 98-07's own `<objective>` names: a PR entry per repo with its repo name on
 * a ticket spanning two repos, both sessions' PRs on a ticket with two sessions, one PR row and
 * zero PR chips under member rows on a group card, and a complete PR list with state/CI/link in the
 * detail panel for both a single ticket and a group, plus the KEEP-06 a11y leg every prior panel
 * harness in this family carries.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-96.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on :4700, before this script boots any server or spawns any real process, and
 * there is no override flag.
 *
 * NO REAL TMUX, NO REAL TTYD, NO REAL SAGA. Every verdict measures DOM shape produced from a wire
 * payload the fixtures seed directly via `node:sqlite` (the panel-93/94/95/96.mjs idiom); none of
 * the five fixture cards ever needs a live terminal. A stub `claude` binary is still planted on
 * PATH as defense in depth, branching on `--version` per the boot-hang trap panel-94/95/96.mjs
 * already document (`checkHooksCapability()` probes it, untimeouted, before the server ever
 * listens).
 *
 * TRAP 1, THE BLIND-GEOMETRY TRAP (Phase 92's third dead instrument). A `display:none` or absent
 * node reads a false 0px/0-count and a geometry/count-only check would call that "correct" instead
 * of "the wrong node entirely." Every DOM read below pairs a geometry/count assertion with an
 * independent structural existence assertion on the same node.
 *
 * TRAP 3 (v2.9's dead instrument #9), A SELECTOR MUST NEVER KEY ON THE PROPERTY IT IS ABOUT TO
 * MUTATE. Every element lookup in this file finds its target by aria-label, role, visible ordinal
 * text, or fixture identifier text, never by a style/attribute value a check or break is about to
 * read or change.
 *
 * DEAD INSTRUMENT #8's LESSON, applied to every break's restore leg: a captured inline value is
 * restored via the CAPTURED string, never a bare `removeProperty`/`removeAttribute`, the two are
 * not equivalent when the original element already carried an inline value.
 *
 * macOS TRAP, load-bearing here too: `dist`'s `main()` guard compares `import.meta.url` against an
 * UNRESOLVED `process.argv[1]`; `realpathSync(entry)` before spawn fixes it (see `bootServerAt`).
 *
 * Usage:
 *   node scripts/panel-98.mjs                       every one of the five checks below, exits
 *                                                     non-zero on any violation.
 *   node scripts/panel-98.mjs --check <name>         one named check only, <name> one of
 *                                                     repo-tagging | multi-session-prs |
 *                                                     group-pr-list | pr-list-detail | a11y.
 *
 * Exit codes: 0 every requested check PASS. 1 a live :4700, a failed build, a sandbox safety
 * violation, a DOM node the evaluate could not resolve, any violated criterion, the real board.db
 * changing during the run, or a sandbox port still held after teardown.
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
/** Every verdict here reads DOM served out of `dist/web`, a server-only build would measure a
 * stale bundle, so this is the full `build`, never `build:server`. */
const BUILD_SCRIPT = "build";

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair in this repo. */
const SANDBOX_PORT = 47870;
const CDP_PORT = 9372;
const SANDBOX_PREFIX = "dispatch-panel-98-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RENDER_TIMEOUT_MS = 15_000;
/** Sub-pixel tolerance for a live `getBoundingClientRect()` read against a fixed integer. */
const PX_TOLERANCE = 0.5;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-98-harness-fake-key-never-real";

/**
 * Five fixture identifiers, each a fixed prefix no other fixture's identifier is a substring of
 * (`PR98-GROUP` vs `PR98-GRP-MEM-*` is the one pair that would otherwise collide), the
 * `density-91.mjs` reason applies unchanged: no DOM id names an individual card today and adding
 * one would be a `src/` edit this instrument is not entitled to make, so every card lookup below
 * locates a card by this rendered identifier text instead.
 */
const SOLO_ID = "panel98-solo";
const SOLO_IDENTIFIER = "PR98-SOLO";
const MULTI_ID = "panel98-multi";
const MULTI_IDENTIFIER = "PR98-MULTI";
const OVER_ID = "panel98-over";
const OVER_IDENTIFIER = "PR98-OVER";
const GROUP_ID = "panel98-group";
const GROUP_IDENTIFIER = "PR98-GROUP";
const GROUP_TITLE = "panel-98 group fixture card";
const GROUP_MEMBER1_ID = "panel98-group-m1";
const GROUP_MEMBER1_IDENTIFIER = "PR98-GRP-MEM-1";
const GROUP_MEMBER2_ID = "panel98-group-m2";
const GROUP_MEMBER2_IDENTIFIER = "PR98-GRP-MEM-2";
const FAIL_ID = "panel98-fail";
const FAIL_IDENTIFIER = "PR98-FAIL";
/** Board-visible identifiers only, group members render nowhere at top level until expanded. */
const TOP_LEVEL_IDENTIFIERS = [
  SOLO_IDENTIFIER,
  MULTI_IDENTIFIER,
  OVER_IDENTIFIER,
  GROUP_IDENTIFIER,
  FAIL_IDENTIFIER,
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
      "PANEL-98-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-98-LIVE"))
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

let headBuild = null;

/** Unconditional full `build` (web + server), this instrument reads rendered DOM. Never mtime-gated. */
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
 * Plant a stub `claude` executable at `<home>/bin/claude`, defense in depth only, since every
 * fixture below is seeded directly via `node:sqlite` and never drives a real saga. MUST branch on
 * `--version`: `checkHooksCapability()` probes it, untimeouted, before the sandbox server ever
 * starts listening, a stub blocking unconditionally hangs the boot.
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
      "echo 'panel-98 stub claude, deliberately never ready'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
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
// Fixtures, five cards, each distinguishing exactly one criterion this
// harness measures. Every PR field is REQUIRED on the wire (`PrInfo`, no
// optionals), so every fixture PR below sets all six.
// ---------------------------------------------------------------------------

function makePr({ number, repo, state, isDraft = false, ci = null, title }) {
  return {
    number,
    url: `https://github.com/acme/${repo}/pull/${number}`,
    title: title ?? `panel-98 fixture PR #${number} (${repo})`,
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

/** PRLINK-01 negative case: one repo, two PRs, proves no repo tag on a single-repo card, and one
 * of its two chips (the merged, `ci: null` one) is the "no CI dot" control for `pr-list-detail`. */
function buildSoloCard() {
  return {
    ...baseCardFields(SOLO_ID, SOLO_IDENTIFIER, "panel-98 solo fixture card"),
    prs: [
      makePr({ number: 1, repo: "web", state: "open", ci: "pass" }),
      makePr({ number: 2, repo: "web", state: "merged", ci: null }),
    ],
  };
}

/**
 * PRLINK-01 positive case AND PRLINK-02 in one fixture: `card.prs` carries only the ACTIVE
 * session's PR (repo `web`); the SIBLING session's PR (repo `api`) exists nowhere except its own
 * session record, `redactCard` is what turns that into `sessionSummaries[].prs` on the wire, so
 * `card.prs` is hand-mirrored from the active session exactly as production's write-time mirror
 * does at N=1 (the `panel-96.mjs` cleanup-fixture idiom, since this seed bypasses every write-time
 * method by going straight to `node:sqlite`).
 */
function buildMultiCard() {
  const now = Date.now();
  const activePr = makePr({
    number: 5,
    repo: "web",
    state: "open",
    ci: "pass",
  });
  const siblingPr = makePr({
    number: 7,
    repo: "api",
    state: "open",
    ci: "pending",
  });
  const s1 = {
    id: randomUUID(),
    createdAt: new Date(now - 6000).toISOString(),
    updatedAt: new Date(now - 6000).toISOString(),
    prs: [activePr],
  };
  const s2 = {
    id: randomUUID(),
    createdAt: new Date(now - 3000).toISOString(),
    updatedAt: new Date(now - 3000).toISOString(),
    prs: [siblingPr],
  };
  return {
    ...baseCardFields(
      MULTI_ID,
      MULTI_IDENTIFIER,
      "panel-98 multi-session fixture card",
    ),
    sessions: [s1, s2],
    activeSessionId: s1.id,
    prs: s1.prs,
  };
}

/**
 * The cap-and-honesty case (UI-SPEC item 12): five PRs, four `repo: "web"` and one `repo: "api"`.
 * All five states rank equal (`open`), so `useCardPrs`'s number-descending sort places them in
 * NUMBER order, the `api` PR (#97) is deliberately the fourth-highest number, so it sorts to
 * index 3, one past the 3-chip cap, letting the harness catch a `showRepo` computed over the
 * sliced array instead of the full one.
 */
function buildOverCard() {
  return {
    ...baseCardFields(
      OVER_ID,
      OVER_IDENTIFIER,
      "panel-98 overflow fixture card",
    ),
    prs: [
      makePr({ number: 100, repo: "web", state: "open", ci: "pass" }),
      makePr({ number: 99, repo: "web", state: "open", ci: "pass" }),
      makePr({ number: 98, repo: "web", state: "open", ci: "pass" }),
      makePr({ number: 97, repo: "api", state: "open", ci: "pass" }),
      makePr({ number: 96, repo: "web", state: "open", ci: "pass" }),
    ],
  };
}

/**
 * PRLINK-03: one group card with two PRs of its own (#22 is a DRAFT with a non-null `ci`, the
 * `isDraft` gate must suppress its CI dot even though `state` alone would qualify, matching
 * `prStyleFor`'s own precedence), plus two member cards linked back via `groupId`, carrying no PRs
 * of their own (`MemberRow` never renders `PrBadge`, confirmed by source read in 98-05-SUMMARY.md).
 */
function buildGroupCards() {
  const groupCard = {
    ...baseCardFields(GROUP_ID, GROUP_IDENTIFIER, GROUP_TITLE),
    source: "group",
    memberIds: [GROUP_MEMBER1_ID, GROUP_MEMBER2_ID],
    prs: [
      makePr({ number: 21, repo: "web", state: "open", ci: "pass" }),
      makePr({
        number: 22,
        repo: "web",
        state: "open",
        isDraft: true,
        ci: "pass",
      }),
    ],
  };
  const member1 = {
    ...baseCardFields(
      GROUP_MEMBER1_ID,
      GROUP_MEMBER1_IDENTIFIER,
      "panel-98 group member 1",
    ),
    groupId: GROUP_ID,
  };
  const member2 = {
    ...baseCardFields(
      GROUP_MEMBER2_ID,
      GROUP_MEMBER2_IDENTIFIER,
      "panel-98 group member 2",
    ),
    groupId: GROUP_ID,
  };
  return [groupCard, member1, member2];
}

/** PRLINK-04's board half: no `prs`, one failed probe, the card must render NO PR-unknown badge. */
function buildFailCard() {
  return {
    ...baseCardFields(
      FAIL_ID,
      FAIL_IDENTIFIER,
      "panel-98 probe-failure fixture card",
    ),
    prsUnknown: {
      category: "gh repo not accessible",
      checkedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    },
  };
}

function allFixtureCards() {
  return [
    buildSoloCard(),
    buildMultiCard(),
    buildOverCard(),
    ...buildGroupCards(),
    buildFailCard(),
  ];
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93/94/95/96.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
 * every fixture row directly via `node:sqlite` in the same pass.
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
          `seedFixtureCards: schema not yet created after warmup attempt ${attempt}/${ATTEMPTS}, retrying`,
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

/** Standup-only: confirms the initial board paint reached every top-level fixture identifier
 * before any check runs. Group members are deliberately excluded, they render nowhere at top
 * level until a check expands the group. */
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
        `PANEL-98-STALE-PORT: :${port} is already held before this run started, a prior run of ` +
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
  const idx = argv.indexOf(name);
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Checks, stubs only in this task. `CHECKS` is the named-check dispatch idiom
// copied from `session-liveness-v3.mjs`'s own `CHECKS`/`--check` table. Every
// real check body lands in the next task; wiring these as `not implemented`
// throws proves the boot/seed/dispatch/teardown lifecycle on its own first.
// ---------------------------------------------------------------------------

async function checkRepoTagging() {
  throw new Error("not implemented");
}

async function checkMultiSessionPrs() {
  throw new Error("not implemented");
}

async function checkGroupPrList() {
  throw new Error("not implemented");
}

async function checkPrListDetail() {
  throw new Error("not implemented");
}

async function checkA11y() {
  throw new Error("not implemented");
}

const CHECKS = {
  "repo-tagging": checkRepoTagging,
  "multi-session-prs": checkMultiSessionPrs,
  "group-pr-list": checkGroupPrList,
  "pr-list-detail": checkPrListDetail,
  a11y: checkA11y,
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

  await assertNoLiveService();
  await assertSandboxPortsFree();
  assertBuilt();

  const realBefore = statRealBoardDb();
  console.log(`\nLIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  const violations = [];
  let server = null;
  let chromeChild = null;
  let cdp = null;
  let portsHeld = false;

  try {
    const pathPrefix = writeStubClaudeBinary(home);
    console.log(`standup: stub claude planted, ${join(pathPrefix, "claude")}`);

    await seedFixtureCards(home, allFixtureCards());
    console.log("standup: five fixture cards seeded via node:sqlite");

    server = bootServerAt(home, pathPrefix);
    await waitForReady(SANDBOX_PORT);
    console.log(
      `standup: sandbox server ready on :${SANDBOX_PORT}, pid=${server.pid}`,
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

    await waitForBoardRootLoaded(cdp, sessionId, TOP_LEVEL_IDENTIFIERS);
    console.log("standup: board painted, all five fixture identifiers present");

    const names = checkName != null ? [checkName] : Object.keys(CHECKS);
    for (const n of names) {
      console.log(`\n=== running check: ${n} ===`);
      const before = violations.length;
      try {
        await CHECKS[n](cdp, sessionId, violations);
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

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`  ${v}`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`panel-98 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
