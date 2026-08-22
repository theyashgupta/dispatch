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
 *   node scripts/panel-98.mjs --break <name>         that check's OWN break: fires the SAME check
 *                                                     function the real run uses against a DOM
 *                                                     mutation, confirms it reports the violation
 *                                                     by name, restores the captured original
 *                                                     value, and re-confirms PASS, all inside one
 *                                                     Chrome tab. Never edits a source file.
 *
 * BREAK EVIDENCE, every check in this file has been run under `--break <name>` for real and has
 * been observed reporting its own violation. The quoted lines below are the VERBATIM TRIP-leg
 * output captured from that run (the product's own aria-label text embeds a real em dash and a
 * middle dot; both are substituted below with a single plain hyphen and a period respectively, to
 * satisfy this repo's own no-em-dash, no-double-hyphen text policy, the substitution changes no
 * other character):
 *   - `repo-tagging` proven able to fail: blanking one PR98-MULTI chip's repo-segment text node
 *     produced `repo-tagging: PR98-MULTI chip PR api #7 - Open . Checks pending repo segment
 *     text "" does not match either seeded repo`.
 *   - `multi-session-prs` proven able to fail: hiding one PR98-MULTI chip via inline
 *     `display: none` produced `multi-session-prs: PR98-MULTI visible chip count=1, expected
 *     union size=2 (active session prs + sessionSummaries prs, deduped by url)` and
 *     `multi-session-prs: PR98-MULTI chips=["PR web #5 - Open . Checks passing"] are missing the
 *     sibling-session PR (repo api), which exists only in sessionSummaries, not card.prs`.
 *   - `group-pr-list` proven able to fail: cloning the group PR row into a member row produced
 *     `group-pr-list: PR98-GROUP has 2 distinct PR-row containers, expected exactly 1` and
 *     `group-pr-list: member row PR98-GRP-MEM-1 carries 2 PR chip(s), expected 0`.
 *   - `pr-list-detail` proven able to fail: rewriting PR98-MULTI's heading text to
 *     `Pull Requests (0)` produced `pr-list-detail: PR98-MULTI heading expected "Pull Requests
 *     (2)", measured "Pull Requests (0)"`.
 *   - `a11y` proven able to fail: blanking PR98-OVER's overflow element `aria-label` produced
 *     `a11y: PR98-OVER overflow accessible name expected "2 more pull requests", measured ""`.
 * Every `--break <name>` run's restore leg re-confirmed PASS, and a plain `node scripts/panel-98.mjs`
 * run immediately after all five breaks exited 0, proving no break leaked DOM state.
 *
 * Exit codes: 0 every requested check PASS (or, under `--break <name>`, the break correctly fired
 * and the restore leg re-passed). 1 a live :4700, a failed build, a sandbox safety violation, a DOM
 * node the evaluate could not resolve, any violated criterion, the real board.db changing during
 * the run, or a sandbox port still held after teardown.
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
 * All five states rank equal (`open`), so `cardPrs`'s number-descending sort places them in
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
// Navigation and DOM-lookup helpers, shared by every check and (in the next
// task) every break. `FIND_CARD_SRC` is this file's ONE card-lookup idiom,
// generalized from `density-91.mjs`'s own single `document.querySelector`
// scoping rule: every column's `.scroll-stable-y` direct DIV children are
// exactly the rendered `<Card>` roots (confirmed by source read of
// `Column.tsx`), so a card is found by scanning every `[data-column]` region
// for the ONE direct-child card root whose text contains the identifier.
// Every selector below keys on aria-label, role, or fixture text, never on a
// style/attribute value a check or the next task's break is about to mutate
// (TRAP 3).
// ---------------------------------------------------------------------------

const FIND_CARD_SRC = `
  function panel98FindCardRoot(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel98: board root #root not found");
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
    if (matches.length === 0) throw new Error("panel98: card " + identifier + " not found on board");
    if (matches.length > 1) throw new Error("panel98: identifier " + identifier + " matched " + matches.length + " card roots");
    return matches[0];
  }
`;

/** Structural PR-affordance locators, deliberately keyed on ROLE and RENDERED TEXT rather than on
 * `aria-label`: every a11y assertion below is ABOUT the accessible name, and a selector that keys
 * on the name reports "element missing" instead of "name empty" the moment it is stripped (TRAP 3,
 * the same lesson `checkOverflowAccessibleName` already learned). A PR chip is a leaf `button`
 * carrying `PrBadge`'s `#<number>`; a `PrList` row is the leaf `div` that holds both a `#<number>`
 * and its own link control. */
const PR_AFFORDANCE_SRC = `
  function panel98PrChips(root) {
    return Array.prototype.filter.call(root.querySelectorAll("button"), function (b) {
      return b.querySelector("button") === null && /#\\d+/.test((b.textContent || "").trim());
    });
  }
  function panel98PrListRows(root) {
    return Array.prototype.filter.call(root.querySelectorAll("div"), function (d) {
      return d.querySelector("div") === null && d.querySelector("button") !== null &&
        /#\\d+/.test(d.textContent || "");
    });
  }
  function panel98PrListLinks(root) {
    return panel98PrListRows(root).map(function (row) { return row.querySelector("button"); });
  }
`;

/** Click a card's root by fixture identifier, native `.click()` so React's delegated `onClick`
 * (`Card.tsx`'s `domProps.onClick`) fires exactly as a real mouse click would. */
async function clickCardByIdentifier(cdp, sessionId, identifier) {
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}panel98FindCardRoot(${JSON.stringify(identifier)}).click()`,
  );
}

/** Opens the detail panel for `identifier` by clicking its card, then polls
 * `aside[aria-label="Ticket detail"]` for that identifier's own text. */
async function openCardDetail(cdp, sessionId, identifier) {
  await clickCardByIdentifier(cdp, sessionId, identifier);
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
    `panel98: detail panel never showed ${identifier} within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/** Expands a group card's member list (idempotent: a no-op if already expanded) by clicking its
 * "Show members" `IconButton`, polling for the resulting "Hide members" toggle state. */
async function expandGroupCard(cdp, sessionId, identifier) {
  const already = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(identifier)});
      return card.querySelector('button[aria-label="Hide members"]') != null;
    })()`,
  );
  if (already) return;
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(identifier)});
      var btn = card.querySelector('button[aria-label="Show members"]');
      if (!btn) throw new Error("panel98: Show members button not found for ${identifier}");
      btn.click();
      return true;
    })()`,
  );
  const probe = `${FIND_CARD_SRC}(function () {
    var card = panel98FindCardRoot(${JSON.stringify(identifier)});
    return card.querySelector('button[aria-label="Hide members"]') != null;
  })()`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `panel98: ${identifier} never expanded within ${RENDER_TIMEOUT_MS}ms`,
  );
}

async function dispatchTab(cdp, sessionId) {
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
 * attribute read), the `panel-96.mjs` idiom, since a DOM `aria-label` read and the browser's own
 * name computation can disagree. `returnByValue: false` yields an `objectId`;
 * `Accessibility.queryAXTree` resolves the accessibility node straight from that JS object
 * reference, sidestepping the `DOM.requestNode` hop panel-96.mjs's own header records as
 * unreliable for an element only ever touched via `Runtime.evaluate`.
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
  const { nodes } = await cdp.send(
    "Accessibility.queryAXTree",
    { objectId: result.objectId },
    sessionId,
  );
  const node = nodes && nodes[0];
  return { name: node?.name?.value ?? null, role: node?.role?.value ?? null };
}

/** Dedupes PRs by `url` exactly as `cardPrs` does, computed by the HARNESS from the fixture it
 * seeded rather than hardcoded, so `multi-session-prs` cannot pass vacuously when both source
 * arrays happen to be empty. */
function dedupeByUrl(prLists) {
  const seen = new Set();
  const merged = [];
  for (const list of prLists) {
    for (const pr of list) {
      if (seen.has(pr.url)) continue;
      seen.add(pr.url);
      merged.push(pr);
    }
  }
  return merged;
}

/** Reads the currently-open detail panel's `PrList` block: the `Pull Requests (N)` heading (a
 * plain `Field` `<span>`, distinguished from the `Members (N)` heading by its own text), every PR
 * row (found via its `Open PR #<n> in GitHub` link control, never by row index), each row's CI dot
 * (5x5 circular span), the set of repo sub-labels rendered, and any probe-failure diagnostic line. */
async function measurePrListDetail(cdp, sessionId) {
  return evalValue(
    cdp,
    sessionId,
    `${PR_AFFORDANCE_SRC}(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      if (!aside) return { asideFound: false };
      var spans = Array.prototype.slice.call(aside.querySelectorAll("span"));
      var heading = spans.find(function (s) { return /^Pull Requests \\(\\d+\\)$/.test(s.textContent.trim()); });
      if (!heading) return { asideFound: true, headingFound: false };
      var container = heading.parentElement;
      var rows = panel98PrListRows(container).map(function (row) {
        var btn = row.querySelector("button");
        var numSpan = Array.prototype.slice.call(row.querySelectorAll("span")).find(function (sp) {
          return /^#\\d+$/.test((sp.textContent || "").trim());
        });
        var m = numSpan ? /^#(\\d+)$/.exec(numSpan.textContent.trim()) : null;
        var ciDot = Array.prototype.slice.call(row.querySelectorAll("span")).find(function (s) {
          var cs = getComputedStyle(s);
          return cs.width === "5px" && cs.height === "5px" && cs.borderRadius === "50%";
        });
        return {
          number: m ? parseInt(m[1], 10) : null,
          ariaLabel: btn.getAttribute("aria-label"),
          rowText: row.textContent,
          hasCiDot: ciDot != null,
        };
      });
      var repoLabels = [];
      ["web", "api"].forEach(function (r) {
        var found = Array.prototype.slice.call(container.querySelectorAll("span")).some(function (s) {
          return s.textContent.trim() === r;
        });
        if (found) repoLabels.push(r);
      });
      var diagEls = Array.prototype.filter.call(container.querySelectorAll("div"), function (d) {
        return d.children.length === 0 && d.textContent.indexOf("Could not check") !== -1;
      });
      return {
        asideFound: true,
        headingFound: true,
        headingText: heading.textContent.trim(),
        rowCount: rows.length,
        rows: rows,
        repoLabels: repoLabels,
        diagnosticCount: diagEls.length,
        diagnosticText: diagEls.length > 0 ? diagEls[0].textContent : null,
      };
    })()`,
  );
}

function assertPrListDetailReading(label, reading, expected, violations) {
  if (reading == null || !reading.asideFound || !reading.headingFound) {
    violations.push(
      `pr-list-detail: ${label}, PrList block not found (${JSON.stringify(reading)})`,
    );
    return;
  }
  const expectedHeading = `Pull Requests (${expected.expectedCount})`;
  if (reading.headingText !== expectedHeading) {
    violations.push(
      `pr-list-detail: ${label} heading expected ${JSON.stringify(expectedHeading)}, measured ${JSON.stringify(reading.headingText)}`,
    );
  }
  if (reading.rowCount !== expected.expectedCount) {
    violations.push(
      `pr-list-detail: ${label} expected ${expected.expectedCount} PR rows, measured ${reading.rowCount}`,
    );
  }
  const measuredNumbers = reading.rows
    .map((r) => r.number)
    .sort((a, b) => a - b);
  const wantNumbers = [...expected.expectedNumbers].sort((a, b) => a - b);
  if (JSON.stringify(measuredNumbers) !== JSON.stringify(wantNumbers)) {
    violations.push(
      `pr-list-detail: ${label} expected PR numbers ${JSON.stringify(wantNumbers)}, measured ${JSON.stringify(measuredNumbers)}`,
    );
  }
  for (const row of reading.rows) {
    if (row.ariaLabel == null || row.ariaLabel.trim() === "") {
      violations.push(
        `pr-list-detail: ${label} row #${row.number} has an empty link-control accessible name`,
      );
    }
    const wantLabel = expected.stateLabels[row.number];
    if (wantLabel != null && row.rowText.indexOf(wantLabel) === -1) {
      violations.push(
        `pr-list-detail: ${label} row #${row.number} expected state label ${JSON.stringify(wantLabel)} somewhere in row text, measured ${JSON.stringify(row.rowText)}`,
      );
    }
    const expectedCiDot = expected.expectedCiDotNumbers.includes(row.number);
    if (row.hasCiDot !== expectedCiDot) {
      violations.push(
        `pr-list-detail: ${label} row #${row.number} CI dot presence measured ${row.hasCiDot}, expected ${expectedCiDot}`,
      );
    }
  }
  if (reading.repoLabels.length !== expected.expectedRepoLabelCount) {
    violations.push(
      `pr-list-detail: ${label} expected ${expected.expectedRepoLabelCount} repo sub-label(s), measured ${reading.repoLabels.length} (${JSON.stringify(reading.repoLabels)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Checks. `CHECKS` is the named-check dispatch idiom copied from
// `session-liveness-v3.mjs`'s own `CHECKS`/`--check` table. Every check pushes
// violation strings naming the fixture, the criterion, and both the measured
// and expected value, per an empty return meaning PASS. Every DOM read pairs
// a geometry/count assertion with an independent structural existence
// assertion on the same node (TRAP 1).
// ---------------------------------------------------------------------------

/** PRLINK-01: the repo tag renders only when a card's full PR set spans 2+ repos, matches height
 * with a bare (no-tag) chip, and the board never shows a "PR unknown"/"PR check incomplete" badge
 * (PRLINK-04's board half, asserted here on the DOM since the wire half is plan 98-08's). */
async function checkRepoTagging(cdp, sessionId, violations) {
  const chipReadExpr = (identifier) => `${FIND_CARD_SRC}(function () {
    var card = panel98FindCardRoot(${JSON.stringify(identifier)});
    var chips = Array.prototype.slice.call(card.querySelectorAll('button[aria-label^="PR "]'));
    return {
      structurallyPresent: chips.length > 0,
      count: chips.length,
      chips: chips.map(function (b) {
        var repoSpan = Array.prototype.slice.call(b.querySelectorAll("span")).find(function (s) {
          return getComputedStyle(s).fontFamily.toLowerCase().indexOf("mono") !== -1;
        });
        var r = b.getBoundingClientRect();
        return {
          ariaLabel: b.getAttribute("aria-label"),
          hasRepoSpan: repoSpan != null,
          repoSpanText: repoSpan ? repoSpan.textContent.trim() : null,
          height: r.height,
        };
      }),
    };
  })()`;

  const solo = await evalReport(
    cdp,
    sessionId,
    violations,
    "repo-tagging (PR98-SOLO)",
    chipReadExpr(SOLO_IDENTIFIER),
  );
  let soloChipHeight = null;
  if (solo == null) return;
  if (!solo.structurallyPresent) {
    violations.push("repo-tagging: PR98-SOLO chips not found structurally");
    return;
  }
  if (solo.count !== 2) {
    violations.push(
      `repo-tagging: PR98-SOLO expected 2 chips, measured ${solo.count}`,
    );
  }
  for (const c of solo.chips) {
    if (c.hasRepoSpan) {
      violations.push(
        `repo-tagging: PR98-SOLO chip ${c.ariaLabel} unexpectedly carries a repo segment on a single-repo card`,
      );
    }
    if (!/^PR #\d/.test(c.ariaLabel ?? "")) {
      violations.push(
        `repo-tagging: PR98-SOLO chip aria-label ${JSON.stringify(c.ariaLabel)} expected the bare "PR #<n>..." form (no repo prefix)`,
      );
    }
    soloChipHeight = c.height;
  }

  const multi = await evalReport(
    cdp,
    sessionId,
    violations,
    "repo-tagging (PR98-MULTI)",
    chipReadExpr(MULTI_IDENTIFIER),
  );
  if (multi == null) return;
  if (!multi.structurallyPresent) {
    violations.push("repo-tagging: PR98-MULTI chips not found structurally");
    return;
  }
  if (multi.count !== 2) {
    violations.push(
      `repo-tagging: PR98-MULTI expected 2 chips, measured ${multi.count}`,
    );
  }
  const seenRepos = new Set();
  for (const c of multi.chips) {
    if (!c.hasRepoSpan) {
      violations.push(
        `repo-tagging: PR98-MULTI chip ${c.ariaLabel} is missing its repo segment on a card spanning 2+ repos`,
      );
    } else {
      seenRepos.add(c.repoSpanText);
      if (c.repoSpanText !== "web" && c.repoSpanText !== "api") {
        violations.push(
          `repo-tagging: PR98-MULTI chip ${c.ariaLabel} repo segment text ${JSON.stringify(c.repoSpanText)} does not match either seeded repo`,
        );
      }
    }
    if (
      soloChipHeight != null &&
      Math.abs(c.height - soloChipHeight) > PX_TOLERANCE
    ) {
      violations.push(
        `repo-tagging: PR98-MULTI chip ${c.ariaLabel} height=${c.height}px does not match PR98-SOLO's bare-chip height=${soloChipHeight}px (the repo tag must not change chip height)`,
      );
    }
  }
  if (seenRepos.size !== 2) {
    violations.push(
      `repo-tagging: PR98-MULTI chips carried repo segments ${JSON.stringify([...seenRepos])}, expected exactly "web" and "api"`,
    );
  }

  await checkNoPrUnknownBadge(cdp, sessionId, violations);
}

/** PRLINK-04's board half, extracted so the break can drive the exact same assertion without
 * re-running the whole repo-tagging orchestrator. Matches the RENDERED TEXT of a leaf node the
 * way `gh-reliability-98.mjs` does, never `aria-label`/`title`: `UnknownProbeBadge` carries no
 * `aria-label` at all and its `title` is the DETAIL sentence ("Could not check ..."), never the
 * label, so an attribute-prefix scan cannot see the badge this requirement forbids. */
async function checkNoPrUnknownBadge(cdp, sessionId, violations) {
  const fail = await evalReport(
    cdp,
    sessionId,
    violations,
    "repo-tagging (PR98-FAIL)",
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(FAIL_IDENTIFIER)});
      var offenders = Array.prototype.filter.call(card.querySelectorAll("*"), function (el) {
        if (el.children.length > 0) return false;
        var t = (el.textContent || "").trim();
        return t.indexOf("PR unknown") === 0 || t.indexOf("PR check incomplete") === 0;
      });
      return {
        structurallyPresent: true,
        offenderCount: offenders.length,
        offenders: offenders.map(function (e) { return (e.textContent || "").trim(); }),
      };
    })()`,
  );
  if (fail != null && fail.offenderCount > 0) {
    violations.push(
      `repo-tagging: PR98-FAIL card subtree contains ${fail.offenderCount} element(s) rendering a PR-unknown badge label: ${JSON.stringify(fail.offenders)}`,
    );
  }
}

/** PRLINK-02: a sibling session's PR (existing only in `sessionSummaries`, never in `card.prs`)
 * reaches the board chip row, and the chip count equals the harness-computed union size. */
async function checkMultiSessionPrs(cdp, sessionId, violations) {
  const reading = await evalReport(
    cdp,
    sessionId,
    violations,
    "multi-session-prs",
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(MULTI_IDENTIFIER)});
      var chips = Array.prototype.slice.call(card.querySelectorAll('button[aria-label^="PR "]'));
      var visibleChips = chips.filter(function (b) { return getComputedStyle(b).display !== "none"; });
      return {
        structurallyPresent: chips.length > 0,
        count: visibleChips.length,
        labels: visibleChips.map(function (b) { return b.getAttribute("aria-label"); }),
      };
    })()`,
  );
  if (reading == null) return;
  if (!reading.structurallyPresent) {
    violations.push(
      "multi-session-prs: PR98-MULTI chips not found structurally",
    );
    return;
  }
  const seed = buildMultiCard();
  const expectedUnion = dedupeByUrl([
    seed.prs,
    ...seed.sessions
      .filter((s) => s.id !== seed.activeSessionId)
      .map((s) => s.prs),
  ]);
  if (reading.count !== expectedUnion.length) {
    violations.push(
      `multi-session-prs: PR98-MULTI visible chip count=${reading.count}, expected union size=${expectedUnion.length} (active session prs + sessionSummaries prs, deduped by url)`,
    );
  }
  const hasSiblingPr = reading.labels.some((l) => l.startsWith("PR api "));
  if (!hasSiblingPr) {
    violations.push(
      `multi-session-prs: PR98-MULTI chips=${JSON.stringify(reading.labels)} are missing the sibling-session PR (repo api), which exists only in sessionSummaries, not card.prs`,
    );
  }
}

/** PRLINK-03: exactly one PR row on a group card, sitting between the title and the session-chip
 * row, and zero PR chips inside any expanded member row (which must still carry its own member
 * affordance, so "zero PR chips" cannot pass because the member row itself vanished). */
async function checkGroupPrList(cdp, sessionId, violations) {
  await expandGroupCard(cdp, sessionId, GROUP_IDENTIFIER);
  const reading = await evalReport(
    cdp,
    sessionId,
    violations,
    "group-pr-list",
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(GROUP_IDENTIFIER)});
      var divs = Array.prototype.slice.call(card.querySelectorAll("div"));
      var titleEl = divs.find(function (d) { return d.children.length === 0 && d.textContent.trim() === ${JSON.stringify(GROUP_TITLE)}; });
      if (!titleEl) return { titleFound: false };
      var groupPrRowEl = titleEl.nextElementSibling;
      var afterGroupPrRow = groupPrRowEl ? groupPrRowEl.nextElementSibling : null;
      var groupPrRowChips = groupPrRowEl
        ? Array.prototype.slice.call(groupPrRowEl.querySelectorAll(':scope > button[aria-label^="PR "]'))
        : [];
      var allChips = Array.prototype.slice.call(card.querySelectorAll('button[aria-label^="PR "]'));
      var uniqueParents = [];
      allChips.forEach(function (b) {
        if (uniqueParents.indexOf(b.parentElement) === -1) uniqueParents.push(b.parentElement);
      });
      var memberIdentifiers = ${JSON.stringify([GROUP_MEMBER1_IDENTIFIER, GROUP_MEMBER2_IDENTIFIER])};
      var memberRows = memberIdentifiers.map(function (mid) {
        var matches = Array.prototype.filter.call(card.querySelectorAll("div"), function (d) {
          return d.textContent.indexOf(mid) !== -1;
        });
        matches.sort(function (a, b) { return a.querySelectorAll("*").length - b.querySelectorAll("*").length; });
        var rowEl = matches.length > 0 ? matches[0] : null;
        return {
          id: mid,
          found: rowEl != null,
          prChipCount: rowEl ? rowEl.querySelectorAll('button[aria-label^="PR "]').length : null,
          hasSourceAffordance: rowEl ? rowEl.textContent.indexOf("Linear") !== -1 : false,
        };
      });
      return {
        titleFound: true,
        groupPrRowPresent: groupPrRowEl != null,
        groupPrRowChipCount: groupPrRowChips.length,
        sessionRowAfterGroupPrRow: afterGroupPrRow != null,
        uniquePrRowContainerCount: uniqueParents.length,
        memberRows: memberRows,
      };
    })()`,
  );
  if (reading == null) return;
  if (!reading.titleFound) {
    violations.push("group-pr-list: PR98-GROUP title node not found");
    return;
  }
  if (!reading.groupPrRowPresent || reading.groupPrRowChipCount === 0) {
    violations.push(
      `group-pr-list: PR98-GROUP has no PR row directly after the title node (measured chip count ${reading.groupPrRowChipCount})`,
    );
  }
  if (!reading.sessionRowAfterGroupPrRow) {
    violations.push(
      "group-pr-list: PR98-GROUP has no node after the PR row (expected the session-chip row)",
    );
  }
  if (reading.uniquePrRowContainerCount !== 1) {
    violations.push(
      `group-pr-list: PR98-GROUP has ${reading.uniquePrRowContainerCount} distinct PR-row containers, expected exactly 1`,
    );
  }
  for (const m of reading.memberRows) {
    if (!m.found) {
      violations.push(
        `group-pr-list: member row ${m.id} not found inside PR98-GROUP's expanded subtree`,
      );
      continue;
    }
    if (m.prChipCount !== 0) {
      violations.push(
        `group-pr-list: member row ${m.id} carries ${m.prChipCount} PR chip(s), expected 0`,
      );
    }
    if (!m.hasSourceAffordance) {
      violations.push(
        `group-pr-list: member row ${m.id} lost its own member affordance (SourceBadge), zero PR chips must not mean the row itself vanished`,
      );
    }
  }
}

/** PRLINK-06: the detail panel's `PrList` block, for a single ticket, a group, and the probe-
 * failure diagnostic line, on the same component that serves both surfaces. */
async function checkPrListDetail(cdp, sessionId, violations) {
  await openCardDetail(cdp, sessionId, MULTI_IDENTIFIER);
  const multi = await measurePrListDetail(cdp, sessionId);
  assertPrListDetailReading(
    "PR98-MULTI",
    multi,
    {
      expectedCount: 2,
      expectedNumbers: [5, 7],
      expectedCiDotNumbers: [5, 7],
      expectedRepoLabelCount: 2,
      stateLabels: { 5: "Open", 7: "Open" },
    },
    violations,
  );

  await openCardDetail(cdp, sessionId, GROUP_IDENTIFIER);
  const group = await measurePrListDetail(cdp, sessionId);
  assertPrListDetailReading(
    "PR98-GROUP",
    group,
    {
      expectedCount: 2,
      expectedNumbers: [21, 22],
      expectedCiDotNumbers: [21],
      expectedRepoLabelCount: 0,
      stateLabels: { 21: "Open", 22: "Draft" },
    },
    violations,
  );

  await openCardDetail(cdp, sessionId, SOLO_IDENTIFIER);
  const solo = await measurePrListDetail(cdp, sessionId);
  assertPrListDetailReading(
    "PR98-SOLO",
    solo,
    {
      expectedCount: 2,
      expectedNumbers: [1, 2],
      expectedCiDotNumbers: [1],
      expectedRepoLabelCount: 0,
      stateLabels: { 1: "Open", 2: "Merged" },
    },
    violations,
  );

  await openCardDetail(cdp, sessionId, FAIL_IDENTIFIER);
  const fail = await measurePrListDetail(cdp, sessionId);
  if (fail == null || !fail.asideFound || !fail.headingFound) {
    violations.push(
      `pr-list-detail: PR98-FAIL, PrList block not found (${JSON.stringify(fail)})`,
    );
  } else {
    if (fail.rowCount !== 0) {
      violations.push(
        `pr-list-detail: PR98-FAIL expected 0 PR rows, measured ${fail.rowCount}`,
      );
    }
    if (fail.diagnosticCount !== 1) {
      violations.push(
        `pr-list-detail: PR98-FAIL expected exactly 1 diagnostic line, measured ${fail.diagnosticCount}`,
      );
    }
    const expectedDetail =
      "Could not check — this repo is not visible to the signed-in gh account, or the remote no longer exists";
    if (
      fail.diagnosticText == null ||
      fail.diagnosticText.indexOf(expectedDetail) === -1
    ) {
      violations.push(
        `pr-list-detail: PR98-FAIL diagnostic text ${JSON.stringify(fail.diagnosticText)} does not contain the expected unknownProbeCopy sentence ${JSON.stringify(expectedDetail)}`,
      );
    }
    if (
      fail.diagnosticText == null ||
      fail.diagnosticText.indexOf("Last checked") === -1
    ) {
      violations.push(
        `pr-list-detail: PR98-FAIL diagnostic text ${JSON.stringify(fail.diagnosticText)} is missing "Last checked"`,
      );
    }
  }
}

/**
 * PR98-OVER's overflow span: exactly 3 visible chips (all carrying a repo segment), one overflow
 * element reading "+2" with the plural accessible-name sentence. Found by its visible TEXT ("+2"),
 * never by its own aria-label, since the aria-label is exactly the property the next task's a11y
 * break mutates (TRAP 3), a selector keyed on it would find nothing post-mutation and report
 * "element missing" instead of "name wrong", a different, weaker assertion. Factored out of
 * `checkA11y` so the next task's break can fire this SAME function without also triggering
 * `checkA11y`'s own leading `Page.reload`, which would discard the break's DOM mutation.
 */
async function checkOverflowAccessibleName(cdp, sessionId, violations) {
  const overflow = await evalReport(
    cdp,
    sessionId,
    violations,
    "a11y (PR98-OVER overflow)",
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(OVER_IDENTIFIER)});
      var chips = Array.prototype.slice.call(card.querySelectorAll('button[aria-label^="PR "]'));
      var overflowEl = Array.prototype.slice.call(card.querySelectorAll("span")).find(function (s) {
        return s.textContent.trim() === "+2";
      });
      return {
        structurallyPresent: overflowEl != null,
        chipCount: chips.length,
        overflowAriaLabel: overflowEl ? overflowEl.getAttribute("aria-label") : null,
        allChipsHaveRepo: chips.every(function (b) {
          return Array.prototype.slice.call(b.querySelectorAll("span")).some(function (s) {
            return getComputedStyle(s).fontFamily.toLowerCase().indexOf("mono") !== -1;
          });
        }),
      };
    })()`,
  );
  if (overflow == null) return;
  if (!overflow.structurallyPresent) {
    violations.push(
      'a11y: PR98-OVER overflow element (text "+2") not found structurally',
    );
    return;
  }
  if (overflow.chipCount !== 3) {
    violations.push(
      `a11y: PR98-OVER expected 3 visible chips, measured ${overflow.chipCount}`,
    );
  }
  if (overflow.overflowAriaLabel !== "2 more pull requests") {
    violations.push(
      `a11y: PR98-OVER overflow accessible name expected "2 more pull requests", measured ${JSON.stringify(overflow.overflowAriaLabel)}`,
    );
  }
  if (!overflow.allChipsHaveRepo) {
    violations.push(
      "a11y: PR98-OVER, not every visible chip carries a repo segment",
    );
  }
}

/** Every board PR chip carries a non-empty accessible name. Located STRUCTURALLY (a leaf button
 * carrying `PrBadge`'s `#<number>`) rather than by an `aria-label` prefix, so a stripped label
 * reports "name empty" instead of silently matching nothing: the old selector could not match a
 * chip whose `aria-label` was blank, which made the loop body unreachable. Extracted so the break
 * can drive it without `checkA11y`'s leading `Page.reload` discarding the mutation. */
async function checkBoardChipAccessibleNames(cdp, sessionId, violations) {
  const chips = await evalValue(
    cdp,
    sessionId,
    `${PR_AFFORDANCE_SRC}(function () {
      var chips = panel98PrChips(document.getElementById("root"));
      return chips.map(function (b) {
        return { label: b.getAttribute("aria-label"), text: (b.textContent || "").trim() };
      });
    })()`,
  );
  if (chips.length === 0) {
    violations.push(
      "a11y: no PR chips found on the board at all, the accessible-name scan would pass vacuously",
    );
  }
  chips.forEach((chip, i) => {
    if (chip.label == null || chip.label.trim() === "") {
      violations.push(
        `a11y: board PR chip #${i} (rendering ${JSON.stringify(chip.text)}) has an empty aria-label`,
      );
    }
  });
}

/** KEEP-06 continuity: every PR chip is keyboard-reachable with a non-empty accessible name and a
 * visible focus ring, the overflow element's accessible name matches the plural count sentence,
 * and the detail panel's link control has a non-empty name and the themed 2px solid focus ring. */
async function checkA11y(cdp, sessionId, violations) {
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitForBoardRootLoaded(cdp, sessionId, TOP_LEVEL_IDENTIFIERS);
  await blurActiveElement(cdp, sessionId);

  let reached = false;
  for (let i = 0; i < 150; i++) {
    await dispatchTab(cdp, sessionId);
    const hit = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_SRC}(function () {
        var card = panel98FindCardRoot(${JSON.stringify(SOLO_IDENTIFIER)});
        var chip = card.querySelector('button[aria-label^="PR "]');
        return chip != null && document.activeElement === chip;
      })()`,
    );
    if (hit) {
      reached = true;
      break;
    }
  }
  if (!reached) {
    violations.push(
      "a11y: Tab traversal never reached PR98-SOLO's first PR chip within 150 tabs",
    );
  } else {
    const outline = await readActiveOutline(cdp, sessionId);
    if (outline.outlineStyle === "none" || outline.outlineWidth === "0px") {
      violations.push(
        `a11y: PR98-SOLO chip 1 has no visible focus ring on keyboard focus, measured ${JSON.stringify(outline)}`,
      );
    }
    const name = await readAccessibleName(
      cdp,
      sessionId,
      `${FIND_CARD_SRC}${PR_AFFORDANCE_SRC}panel98PrChips(panel98FindCardRoot(${JSON.stringify(SOLO_IDENTIFIER)}))[0]`,
    );
    if (name.name == null || name.name.trim() === "") {
      violations.push(
        `a11y: PR98-SOLO chip 1 accessible name is empty, measured ${JSON.stringify(name)}`,
      );
    }
  }

  await checkBoardChipAccessibleNames(cdp, sessionId, violations);

  await checkOverflowAccessibleName(cdp, sessionId, violations);

  await openCardDetail(cdp, sessionId, MULTI_IDENTIFIER);
  const linkName = await readAccessibleName(
    cdp,
    sessionId,
    `${PR_AFFORDANCE_SRC}panel98PrListLinks(document.querySelector('aside[aria-label="Ticket detail"]'))[0]`,
  );
  if (linkName.name == null || linkName.name.trim() === "") {
    violations.push(
      `a11y: detail panel PR link control has an empty accessible name, measured ${JSON.stringify(linkName)}`,
    );
  }
  await blurActiveElement(cdp, sessionId);
  let linkReached = false;
  for (let i = 0; i < 150; i++) {
    await dispatchTab(cdp, sessionId);
    const hit = await evalValue(
      cdp,
      sessionId,
      `${PR_AFFORDANCE_SRC}document.activeElement === panel98PrListLinks(document.querySelector('aside[aria-label="Ticket detail"]'))[0]`,
    );
    if (hit) {
      linkReached = true;
      break;
    }
  }
  if (!linkReached) {
    violations.push(
      "a11y: Tab traversal never reached the detail panel's Open PR link control within 150 tabs",
    );
  } else {
    const outline = await readActiveOutline(cdp, sessionId);
    if (outline.outlineWidth !== "2px" || outline.outlineStyle !== "solid") {
      violations.push(
        `a11y: detail panel PR link control expected a visible 2px solid focus ring (IconButton's themed focusRing()), measured ${JSON.stringify(outline)}`,
      );
    }
  }
}

const CHECKS = {
  "repo-tagging": checkRepoTagging,
  "multi-session-prs": checkMultiSessionPrs,
  "group-pr-list": checkGroupPrList,
  "pr-list-detail": checkPrListDetail,
  a11y: checkA11y,
};

// ---------------------------------------------------------------------------
// Breaks. One per check, each firing the SAME check function the real run
// uses: capture the verbatim FAIL output, revert via the CAPTURED value
// (never a bare removal, Dead Instrument #8), and re-confirm PASS in the
// same tab. Never edits a source file; every mutation is a DOM change inside
// this one Chrome tab. No selector below keys on the property it is about to
// mutate (TRAP 3): each capture/mutate/restore step locates its target by
// role/text/ordinal, and the property under test only.
// ---------------------------------------------------------------------------

/** `repo-tagging` break: blanks one PR98-MULTI chip's rendered repo-segment TEXT NODE (never its
 * aria-label), so `repoSpanText` stops matching "web"/"api" and the check reports the mismatch. */
async function runBreakRepoTagging(cdp, sessionId) {
  console.log(
    "\n--break repo-tagging: blanking one PR98-MULTI chip's repo-segment text",
  );
  const original = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(MULTI_IDENTIFIER)});
      var chip = card.querySelector('button[aria-label^="PR "]');
      var repoSpan = Array.prototype.slice.call(chip.querySelectorAll("span")).find(function (s) {
        return getComputedStyle(s).fontFamily.toLowerCase().indexOf("mono") !== -1;
      });
      if (!repoSpan) throw new Error("panel98 break: repo segment span not found on PR98-MULTI's first chip");
      return repoSpan.firstChild ? repoSpan.firstChild.nodeValue : null;
    })()`,
  );
  console.log(
    `--break repo-tagging: captured original repo-segment text = ${JSON.stringify(original)}`,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(MULTI_IDENTIFIER)});
      var chip = card.querySelector('button[aria-label^="PR "]');
      var repoSpan = Array.prototype.slice.call(chip.querySelectorAll("span")).find(function (s) {
        return getComputedStyle(s).fontFamily.toLowerCase().indexOf("mono") !== -1;
      });
      repoSpan.firstChild.nodeValue = "";
      return true;
    })()`,
  );
  const tripViolations = [];
  await checkRepoTagging(cdp, sessionId, tripViolations);
  console.log(
    `--break repo-tagging TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) => v.indexOf("repo segment text") !== -1,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(MULTI_IDENTIFIER)});
      var chip = card.querySelector('button[aria-label^="PR "]');
      var repoSpan = Array.prototype.slice.call(chip.querySelectorAll("span")).find(function (s) {
        return getComputedStyle(s).fontFamily.toLowerCase().indexOf("mono") !== -1;
      });
      repoSpan.firstChild.nodeValue = ${JSON.stringify(original)};
      return true;
    })()`,
  );
  const restoreViolations = [];
  await checkRepoTagging(cdp, sessionId, restoreViolations);
  console.log(
    `--break repo-tagging RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  // Second leg, PRLINK-04's own sub-assertion: the badge scan was never proven able to fire,
  // since the leg above only blanks a repo-segment text node. The injected node carries the exact
  // shape the real component renders (a bare span whose `title` is the DETAIL sentence and which
  // carries no `aria-label` at all), so it also demonstrates why the old attribute-prefix scan
  // could not see it.
  console.log(
    "\n--break repo-tagging: injecting a PR-unknown badge leaf into PR98-FAIL's own subtree",
  );
  const injectedId = "panel98-break-pr-unknown";
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(FAIL_IDENTIFIER)});
      if (document.getElementById(${JSON.stringify(injectedId)})) throw new Error("panel98 break: injected node already present");
      var span = document.createElement("span");
      span.id = ${JSON.stringify(injectedId)};
      span.setAttribute("title", "Could not check for pull requests: gh could not reach GitHub.");
      span.textContent = "PR unknown";
      card.appendChild(span);
      return true;
    })()`,
  );
  const badgeTripViolations = [];
  await checkNoPrUnknownBadge(cdp, sessionId, badgeTripViolations);
  console.log(
    `--break repo-tagging (PR98-FAIL badge) TRIP leg FAIL output:\n${badgeTripViolations.join("\n")}`,
  );
  const badgeTripFired = badgeTripViolations.some(
    (v) => v.indexOf("rendering a PR-unknown badge label") !== -1,
  );
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var el = document.getElementById(${JSON.stringify(injectedId)});
      if (!el) throw new Error("panel98 break: injected node vanished before restore");
      el.remove();
      return document.getElementById(${JSON.stringify(injectedId)}) === null;
    })()`,
  );
  const badgeRestoreViolations = [];
  await checkNoPrUnknownBadge(cdp, sessionId, badgeRestoreViolations);
  console.log(
    `--break repo-tagging (PR98-FAIL badge) RESTORE leg: ${badgeRestoreViolations.length === 0 ? "PASS" : `FAIL:\n${badgeRestoreViolations.join("\n")}`}`,
  );

  return {
    tripFired: tripFired && badgeTripFired,
    restoreClean:
      restoreViolations.length === 0 && badgeRestoreViolations.length === 0,
    tripViolations: [...tripViolations, ...badgeTripViolations],
  };
}

/** `multi-session-prs` break: hides one PR98-MULTI chip via an inline `display: none`, captured
 * from its EXISTING inline value (`PrBadge` sets `display: "inline-flex"` inline) before mutating,
 * so the visible-chip-count assertion fires. */
async function runBreakMultiSessionPrs(cdp, sessionId) {
  console.log(
    "\n--break multi-session-prs: hiding one PR98-MULTI chip via inline display:none",
  );
  const original = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(MULTI_IDENTIFIER)});
      var chip = card.querySelector('button[aria-label^="PR "]');
      return chip.style.getPropertyValue("display");
    })()`,
  );
  console.log(
    `--break multi-session-prs: captured original inline display = ${JSON.stringify(original)}`,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(MULTI_IDENTIFIER)});
      var chip = card.querySelector('button[aria-label^="PR "]');
      chip.style.setProperty("display", "none");
      return true;
    })()`,
  );
  const tripViolations = [];
  await checkMultiSessionPrs(cdp, sessionId, tripViolations);
  console.log(
    `--break multi-session-prs TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) => v.indexOf("visible chip count=") !== -1,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(MULTI_IDENTIFIER)});
      var chip = card.querySelector('button[aria-label^="PR "]');
      chip.style.setProperty("display", ${JSON.stringify(original)});
      return true;
    })()`,
  );
  const restoreViolations = [];
  await checkMultiSessionPrs(cdp, sessionId, restoreViolations);
  console.log(
    `--break multi-session-prs RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/** `group-pr-list` break: clones the group's own PR-row node into a member row subtree (tagged
 * with a harness-only marker attribute for a clean removal), so the "zero PR chips under a member
 * row" assertion fires, then removes the clone. */
async function runBreakGroupPrList(cdp, sessionId) {
  console.log(
    "\n--break group-pr-list: cloning the group PR row into a member row subtree",
  );
  await expandGroupCard(cdp, sessionId, GROUP_IDENTIFIER);
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(GROUP_IDENTIFIER)});
      var divs = Array.prototype.slice.call(card.querySelectorAll("div"));
      var titleEl = divs.find(function (d) { return d.children.length === 0 && d.textContent.trim() === ${JSON.stringify(GROUP_TITLE)}; });
      if (!titleEl) throw new Error("panel98 break: PR98-GROUP title node not found");
      var groupPrRowEl = titleEl.nextElementSibling;
      if (!groupPrRowEl) throw new Error("panel98 break: PR98-GROUP has no PR row after the title");
      var memberMatches = Array.prototype.filter.call(card.querySelectorAll("div"), function (d) {
        return d.textContent.indexOf(${JSON.stringify(GROUP_MEMBER1_IDENTIFIER)}) !== -1;
      });
      memberMatches.sort(function (a, b) { return a.querySelectorAll("*").length - b.querySelectorAll("*").length; });
      var memberRow = memberMatches[0];
      if (!memberRow) throw new Error("panel98 break: member row ${GROUP_MEMBER1_IDENTIFIER} not found");
      var clone = groupPrRowEl.cloneNode(true);
      clone.setAttribute("data-panel98-break-clone", "true");
      memberRow.appendChild(clone);
      return true;
    })()`,
  );
  const tripViolations = [];
  await checkGroupPrList(cdp, sessionId, tripViolations);
  console.log(
    `--break group-pr-list TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) => v.indexOf("carries") !== -1 && v.indexOf("expected 0") !== -1,
  );
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var clone = document.querySelector('[data-panel98-break-clone="true"]');
      if (clone) clone.remove();
      return true;
    })()`,
  );
  const restoreViolations = [];
  await checkGroupPrList(cdp, sessionId, restoreViolations);
  console.log(
    `--break group-pr-list RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/** `pr-list-detail` break: rewrites PR98-MULTI's `Pull Requests (N)` heading TEXT NODE to
 * `Pull Requests (0)` (captured first), so the row-count-vs-heading assertion fires. Re-selecting
 * an already-selected card is a no-op re-render (`setSelectedCardId` bails on an unchanged id), so
 * the SAME `checkPrListDetail` the real run uses reads this mutation without a fresh navigation
 * erasing it first. */
async function runBreakPrListDetail(cdp, sessionId) {
  console.log(
    "\n--break pr-list-detail: rewriting PR98-MULTI's heading text to Pull Requests (0)",
  );
  await openCardDetail(cdp, sessionId, MULTI_IDENTIFIER);
  const original = await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var spans = Array.prototype.slice.call(aside.querySelectorAll("span"));
      var heading = spans.find(function (s) { return /^Pull Requests \\(\\d+\\)$/.test(s.textContent.trim()); });
      if (!heading) throw new Error("panel98 break: Pull Requests heading not found on PR98-MULTI's panel");
      return heading.firstChild.nodeValue;
    })()`,
  );
  console.log(
    `--break pr-list-detail: captured original heading text = ${JSON.stringify(original)}`,
  );
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var spans = Array.prototype.slice.call(aside.querySelectorAll("span"));
      var heading = spans.find(function (s) { return /^Pull Requests \\(\\d+\\)$/.test(s.textContent.trim()); });
      heading.firstChild.nodeValue = "Pull Requests (0)";
      return true;
    })()`,
  );
  const tripViolations = [];
  await checkPrListDetail(cdp, sessionId, tripViolations);
  console.log(
    `--break pr-list-detail TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) => v.indexOf("PR98-MULTI heading expected") !== -1,
  );
  await openCardDetail(cdp, sessionId, MULTI_IDENTIFIER);
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var aside = document.querySelector('aside[aria-label="Ticket detail"]');
      var spans = Array.prototype.slice.call(aside.querySelectorAll("span"));
      var heading = spans.find(function (s) { return s.textContent.trim() === "Pull Requests (0)"; });
      if (heading) heading.firstChild.nodeValue = ${JSON.stringify(original)};
      return true;
    })()`,
  );
  const restoreViolations = [];
  await checkPrListDetail(cdp, sessionId, restoreViolations);
  console.log(
    `--break pr-list-detail RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/** `a11y` break: blanks the PR98-OVER overflow element's `aria-label` (captured first), firing the
 * SAME `checkOverflowAccessibleName` sub-check `checkA11y` itself calls, never the full `checkA11y`
 * orchestrator, which reloads the page first and would discard the mutation before it could be
 * read. */
async function runBreakA11y(cdp, sessionId) {
  console.log(
    "\n--break a11y: blanking PR98-OVER's overflow element aria-label",
  );
  const original = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(OVER_IDENTIFIER)});
      var overflowEl = Array.prototype.slice.call(card.querySelectorAll("span")).find(function (s) {
        return s.textContent.trim() === "+2";
      });
      if (!overflowEl) throw new Error("panel98 break: PR98-OVER overflow element (text \\"+2\\") not found");
      return overflowEl.getAttribute("aria-label");
    })()`,
  );
  console.log(
    `--break a11y: captured original overflow aria-label = ${JSON.stringify(original)}`,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(OVER_IDENTIFIER)});
      var overflowEl = Array.prototype.slice.call(card.querySelectorAll("span")).find(function (s) {
        return s.textContent.trim() === "+2";
      });
      overflowEl.setAttribute("aria-label", "");
      return true;
    })()`,
  );
  const tripViolations = [];
  await checkOverflowAccessibleName(cdp, sessionId, tripViolations);
  console.log(
    `--break a11y TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) => v.indexOf("overflow accessible name expected") !== -1,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel98FindCardRoot(${JSON.stringify(OVER_IDENTIFIER)});
      var overflowEl = Array.prototype.slice.call(card.querySelectorAll("span")).find(function (s) {
        return s.textContent.trim() === "+2";
      });
      overflowEl.setAttribute("aria-label", ${JSON.stringify(original)});
      return true;
    })()`,
  );
  const restoreViolations = [];
  await checkOverflowAccessibleName(cdp, sessionId, restoreViolations);
  console.log(
    `--break a11y RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );

  // Second leg: the board chip-name scan used to select on the very `aria-label` it then asserted
  // was non-empty, so a blanked label matched nothing and the loop body was unreachable. Blanking
  // one real chip's label proves the structural locator now reports "name empty" instead.
  console.log("\n--break a11y: blanking PR98-SOLO's first PR chip aria-label");
  const chipOriginal = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}${PR_AFFORDANCE_SRC}(function () {
      var chip = panel98PrChips(panel98FindCardRoot(${JSON.stringify(SOLO_IDENTIFIER)}))[0];
      if (!chip) throw new Error("panel98 break: PR98-SOLO has no PR chip");
      return chip.getAttribute("aria-label");
    })()`,
  );
  console.log(
    `--break a11y: captured original chip aria-label = ${JSON.stringify(chipOriginal)}`,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}${PR_AFFORDANCE_SRC}(function () {
      panel98PrChips(panel98FindCardRoot(${JSON.stringify(SOLO_IDENTIFIER)}))[0].setAttribute("aria-label", "");
      return true;
    })()`,
  );
  const chipTripViolations = [];
  await checkBoardChipAccessibleNames(cdp, sessionId, chipTripViolations);
  console.log(
    `--break a11y (board chip name) TRIP leg FAIL output:\n${chipTripViolations.join("\n")}`,
  );
  const chipTripFired = chipTripViolations.some(
    (v) => v.indexOf("has an empty aria-label") !== -1,
  );
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}${PR_AFFORDANCE_SRC}(function () {
      panel98PrChips(panel98FindCardRoot(${JSON.stringify(SOLO_IDENTIFIER)}))[0].setAttribute("aria-label", ${JSON.stringify(chipOriginal)});
      return true;
    })()`,
  );
  const chipRestoreViolations = [];
  await checkBoardChipAccessibleNames(cdp, sessionId, chipRestoreViolations);
  console.log(
    `--break a11y (board chip name) RESTORE leg: ${chipRestoreViolations.length === 0 ? "PASS" : `FAIL:\n${chipRestoreViolations.join("\n")}`}`,
  );

  return {
    tripFired: tripFired && chipTripFired,
    restoreClean:
      restoreViolations.length === 0 && chipRestoreViolations.length === 0,
    tripViolations: [...tripViolations, ...chipTripViolations],
  };
}

const BREAKS = {
  "repo-tagging": runBreakRepoTagging,
  "multi-session-prs": runBreakMultiSessionPrs,
  "group-pr-list": runBreakGroupPrList,
  "pr-list-detail": runBreakPrListDetail,
  a11y: runBreakA11y,
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
  let breakResult = null;

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

    if (breakName != null) {
      breakResult = await BREAKS[breakName](cdp, sessionId);
    } else {
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
        `FAIL (self-check): the restore leg for "${breakName}" still reports a violation after restoring the captured original value.`,
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
  console.error(`panel-98 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
