/**
 * Phase 95 plan 07 UI measurement instrument (`UI-03`/`MULTI-02`, dev/ops tooling, NOT test code):
 * no test framework, no assertion library, lives outside src/ — the same category as panel-92.mjs,
 * panel-93.mjs, panel-94.mjs. It measures all EIGHT observable acceptance criteria `95-UI-SPEC.md`
 * names for the `StartModal` inherit toggle and the `SessionSwitcher` parentage caption, against a
 * real Chrome, a real sandboxed dispatch server and a real board — never eyeballed, never asserted
 * from source reading alone.
 *
 * SAFETY — copied verbatim from this milestone's own precedent (panel-92/93/94.mjs headers).
 * Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via `adoptAndSweep`,
 * fingerprinted by argv shape, never by tmux session name or which board.db spawned it.
 * `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if anything answers
 * on :4700, before this script boots any server or spawns any real process.
 *
 * NO REAL TMUX, NO REAL TTYD, NO REAL SAGA. Every one of the eight criteria measures DOM shape
 * produced from a wire payload the fixtures seed directly via `node:sqlite` (the `panel-93.mjs`
 * idiom) — none of them need a live terminal. `StartAnotherSessionButton`'s presence gate reads
 * `card.workspacePath`/`card.column`/`card.groupId` only, never `hasLiveSession`; `SessionSwitcher`
 * renders off `card.sessionSummaries` alone. A stub `claude` binary is still planted on PATH as a
 * defense-in-depth measure (see criterion 4's own comment for why the real saga must never run),
 * even though the primary defense is CDP request interception, not the stub.
 *
 * TRAP 1 — THE BLIND-GEOMETRY TRAP (criteria 6/7, Phase 92's third dead instrument, restated in
 * `94-UI-SPEC.md` too). A `display:none` or otherwise-absent node reads a false 0px and a naive
 * geometry-only check would report that as "smaller, therefore correct" instead of "the wrong node
 * entirely." Every geometry read in this file is PAIRED with an independent structural existence
 * assertion, and criterion 6 additionally asserts `getComputedStyle` is not `display:none`/
 * `visibility:hidden` AND non-zero rendered width, at each breakpoint independently.
 *
 * TRAP 2 — ASSERTING CLIENT STATE INSTEAD OF THE WIRE (criterion 4). Reading React's `inherit` flag
 * proves nothing about what the server receives. Criterion 4 captures the ACTUAL
 * `POST /api/cards/:id/start` request body via CDP `Fetch` domain interception in both toggle
 * states, and FAILS the request after capture so no real saga ever runs from a UI measurement.
 *
 * TRAP 3 — THE SESSIONSWITCHER WRAPPER, post plan 95-04. Before this phase, `[role="group"]`'s
 * pills were a DIRECT child of the session row; the caption addition wrapped that group in a NEW
 * outer flex `<div>`, so `group.parentElement` now resolves to THAT wrapper, not the row. The
 * switcher-only row-height read (criterion 7) must walk up TWO levels
 * (`group.parentElement.parentElement`), never one — panel-94.mjs's own one-level walk would
 * silently measure the wrong node's height here.
 *
 * THE UNDEFINED-ON-THE-WIRE TRAP (95-06's finding, restated because Break 1 below depends on it).
 * `JSON.stringify` drops `undefined`-valued keys, so a resolver defect that computes
 * `parentOrdinal: undefined` produces a wire body BYTE-IDENTICAL to omitting the key — invisible to
 * `Object.hasOwn` on a parsed body. Break 1 below uses a concrete, wire-visible default (`?? 0`,
 * never `?? undefined`) so the regression is actually observable.
 *
 * macOS TRAP, load-bearing here too: `dist`'s `main()` guard compares `import.meta.url` against an
 * UNRESOLVED `process.argv[1]`; `realpathSync(entry)` before spawn fixes it (see `bootServerAt`).
 *
 * Usage:
 *   node scripts/panel-95.mjs                       the real run: all eight criteria, exits
 *                                                    non-zero on any violation.
 *   node scripts/panel-95.mjs --geometry-expect-wrong   Task 2's dead-instrument self-check ONLY:
 *                                                    swaps criterion 7's row-height expectations to
 *                                                    deliberately wrong values — MUST fail,
 *                                                    demonstrating the 49px/45px expectations are
 *                                                    load-bearing rather than copied constants.
 *                                                    Harness-only; touches no product code.
 *
 * Exit codes: 0 every check PASS. 1 a live :4700, a failed build, a sandbox safety violation, a DOM
 * element the evaluate could not find, any measured-criterion violation, the real board.db changing
 * during the run, or a sandbox port still held after teardown.
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
const SANDBOX_PORT = 47868;
const CDP_PORT = 9370;
const SANDBOX_PREFIX = "dispatch-panel-95-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RESIZE_SETTLE_MS = 250;
const RENDER_TIMEOUT_MS = 15_000;
const TAB_TRAVERSAL_CAP = 40;
const FETCH_PAUSE_TIMEOUT_MS = 10_000;
/** Sub-pixel tolerance for a live `getBoundingClientRect().height` read against a fixed expected integer. */
const HEIGHT_TOLERANCE_PX = 0.5;
/**
 * Phase 94's own row-height figures, CORRECTED once already (panel-94.mjs's own arithmetic note)
 * and reused directly here, per this plan's own objective: "49px with the button present, 45px
 * switcher-only." Not re-derived, not 48/44 — those were Phase 94's pre-correction numbers.
 */
const ROW_HEIGHT_BUTTON = 49;
const ROW_HEIGHT_SWITCHER = 45;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** `>=1600px`, `1024-1599px`, `768-1023px`, `<768px` — the four breakpoints `95-UI-SPEC.md` names. */
const BREAKPOINTS = [
  { name: "1600", width: 1600, height: 1000 },
  { name: "1280", width: 1280, height: 900 },
  { name: "900", width: 900, height: 800 },
  { name: "390", width: 390, height: 844 },
];

const FAKE_LINEAR_API_KEY = "panel-95-harness-fake-key-never-real";

const N1_CLEAN_ID = "panel95-n1clean";
const TODO_ID = "panel95-todo";
const CHAIN_ID = "panel95-chain";
const CHAIN_DONE_ID = "panel95-chaindone";

const N1_CLEAN = "PANEL95-1";
const TODO = "PANEL95-TODO";
const CHAIN = "PANEL95-CHAIN";
const CHAIN_DONE = "PANEL95-CHAINDONE";

const ALL_IDENTIFIERS = [N1_CLEAN, TODO, CHAIN, CHAIN_DONE];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-95-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board — " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-95-LIVE"))
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
 * Plant a stub `claude` executable at `<home>/bin/claude` — defense in depth only. Criterion 4's
 * primary defense against a real saga is CDP `Fetch.failRequest`, applied BEFORE the server ever
 * processes the POST; this stub exists purely so that if interception somehow failed, the saga
 * would still hang against a non-real `claude` rather than touching anything real. MUST branch on
 * `--version`: boot itself calls the resolved `claude` with `--version` via an untimeouted
 * `checkHooksCapability()` probe BEFORE the sandbox server ever starts listening (94-05's finding).
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
      "echo 'panel-95 stub claude — deliberately never ready'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
}

/**
 * Create a throwaway local git repo under the sandbox HOME (never a real project repo) with one
 * committed file, then REGISTER it as a workspace folder via a real `POST /api/workspace-folders`
 * call — `StartModal`'s `useWorkspacePicker` reads the GLOBAL registered-folder list
 * (`getWorkspaceFolders`), never the card's own `workspace` field, so this registration (not
 * merely seeding `card.workspace`) is what makes the modal's "Start" button reach an enabled state
 * through real UI interaction. `git config` is set LOCALLY only, never `--global`.
 */
async function seedFixtureRepoAndRegister(home, port) {
  const repoPath = join(home, "repos", "alpha");
  mkdirSync(repoPath, { recursive: true });
  await execFileP("git", ["init"], { cwd: repoPath });
  await execFileP("git", ["config", "user.email", "harness@localhost"], {
    cwd: repoPath,
  });
  await execFileP("git", ["config", "user.name", "panel-95 harness"], {
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

async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
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
    title: `panel-95 fixture card ${identifier}`,
    description: null,
    priority: 3,
    column: "in_progress",
    updatedAt: now,
    ...extra,
  };
}

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

/**
 * Build the four fixture cards. `n1CleanWorkspacePath`, when given, is a REAL path (the fixture
 * repo's own containing folder) so `StartAnotherSessionButton`'s `card.workspacePath != null` gate
 * is satisfied through a real value, not a placeholder string.
 */
function makeFixtures(n1CleanWorkspacePath) {
  const n1Session = makeInertSession("n1clean", 4000, {
    workspacePath: n1CleanWorkspacePath,
  });
  const n1Clean = withActiveMirror(
    baseCard(N1_CLEAN_ID, N1_CLEAN, {
      column: "in_progress",
      groupId: undefined,
    }),
    n1Session,
  );

  const todo = baseCard(TODO_ID, TODO, {
    column: "todo",
    groupId: undefined,
    workspacePath: undefined,
    activeSessionId: undefined,
  });

  // CHAIN: session 1 (root, no builtFrom) <- session 2 (builtFrom=1) <- session 3 (builtFrom=2),
  // ascending createdAt so redactCard's positional ordinal assignment (sorted by createdAt) lands
  // 1/2/3 in the order the fixture intends. `builtFrom` is seeded on the PERSISTED session rows —
  // never `parentOrdinal` directly on the wire — so the server's own resolver is what this
  // instrument measures, not the fixture's own claim about itself.
  const c1 = makeInertSession("chain-1", 9000);
  const c2 = makeInertSession("chain-2", 6000, { builtFrom: c1.id });
  const c3 = makeInertSession("chain-3", 3000, { builtFrom: c2.id });
  const chain = baseCard(CHAIN_ID, CHAIN, {
    column: "in_progress",
    groupId: undefined,
    workspacePath: n1CleanWorkspacePath,
    activeSessionId: c1.id,
    tmuxSession: undefined,
    sessions: [c1, c2, c3],
  });

  // CHAIN_DONE: the identical 1<-2<-3 shape, distinct session ids, on a `column: "done"` card —
  // `StartAnotherSessionButton`'s own `column === "done"` gate hides the button while
  // `SessionSwitcher` still renders (its gate is `sessionSummaries != null` alone), giving the
  // switcher-only 45px row-height fixture criterion 7 needs alongside CHAIN's 49px button-present
  // reading — mirrors panel-94.mjs's own doneSwitcher/healthy2 pairing.
  const d1 = makeInertSession("chaindone-1", 9000);
  const d2 = makeInertSession("chaindone-2", 6000, { builtFrom: d1.id });
  const d3 = makeInertSession("chaindone-3", 3000, { builtFrom: d2.id });
  const chainDone = baseCard(CHAIN_DONE_ID, CHAIN_DONE, {
    column: "done",
    groupId: undefined,
    workspacePath: undefined,
    activeSessionId: d1.id,
    tmuxSession: undefined,
    sessions: [d1, d2, d3],
  });

  return [n1Clean, todo, chain, chainDone];
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93.mjs / panel-94.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then
 * insert the fixture rows directly via `node:sqlite`.
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

// ---------------------------------------------------------------------------
// Navigation — the panel-92/93/94 Orca/docked-mode idiom.
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
 * Select a fixture's card in the Orca nav, matching its identifier on a WORD BOUNDARY — never a
 * substring match (94-07/95-05's own lesson: `PANEL95-1` is a strict prefix of a hypothetical
 * `PANEL95-10`, and `PANEL95-CHAIN` is a strict prefix of `PANEL95-CHAINDONE`).
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

/**
 * Poll until the modal's own `Start` button goes non-disabled — `useWorkspacePicker`'s repo
 * discovery is an async fetch fired on mount, so a click immediately after `waitForModal` can race
 * it and land on a still-disabled button.
 */
async function waitForStartEnabled(cdp, sessionId) {
  const probe = `(function () {
    var btns = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"] button'));
    var submit = btns.find(function (b) { return b.textContent.trim() === "Start"; });
    return submit != null && !submit.disabled;
  })()`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `modal Start button never went enabled within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/** Close the StartModal via a real Escape key event, then wait for its close transition. */
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
 * Locate the inherit checkbox by SECTION SCOPE, never a positional `input[type=checkbox]` index —
 * `RepoRow` renders checkboxes too and an index would silently measure the wrong control. Scoped by
 * finding the `<label>` whose own text contains the locked primary-line copy `"Build on Session"`,
 * which only `InheritToggleSection`'s label carries.
 */
const FIND_INHERIT_LABEL_SRC = `
  function panel95FindInheritLabel() {
    var dialog = document.querySelector('[role="dialog"][aria-label="Start session"]');
    if (!dialog) return null;
    var labels = Array.prototype.slice.call(dialog.querySelectorAll("label"));
    return labels.find(function (l) { return l.textContent.indexOf("Build on Session") !== -1; }) ?? null;
  }
`;

async function evalReport(cdp, sessionId, violations, label, expr) {
  try {
    return await evalValue(cdp, sessionId, expr);
  } catch (err) {
    violations.push(`${label}: ${err.message}`);
    return null;
  }
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
        `PANEL-95-STALE-PORT: :${port} is already held before this run started — a prior run of ` +
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
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const geometryExpectWrong = readFlag(argv, "--geometry-expect-wrong");

  await assertNoLiveService();
  await assertSandboxPortsFree();
  assertBuilt();

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  const violations = [];
  let server = null;
  let chromeChild = null;
  let cdp = null;
  let portsHeld = false;

  try {
    const pathPrefix = writeStubClaudeBinary(home);
    console.log(`standup: stub claude planted — ${join(pathPrefix, "claude")}`);

    // Boot once to create the schema, then boot again (with the stub claude on PATH) for the real
    // run — mirrors panel-94.mjs's own two-boot standup order.
    const fixturesForSeed = makeFixtures(undefined);
    await seedFixtureCards(home, fixturesForSeed);

    server = bootServerAt(home, pathPrefix);
    await waitForReady(SANDBOX_PORT);
    console.log(
      `standup: sandbox server ready on :${SANDBOX_PORT}, pid=${server.pid}`,
    );

    const { folder } = await seedFixtureRepoAndRegister(home, SANDBOX_PORT);
    console.log(
      `standup: fixture repo registered as a workspace folder — ${folder}`,
    );

    // Re-seed N1_CLEAN's session with a real workspacePath now that the folder is known, and
    // re-seed CHAIN with the same real path (its own button-present geometry reading needs
    // `card.workspacePath != null` too) — a direct DB patch, server not running for this window.
    await killAndWait(server);
    const finalFixtures = makeFixtures(folder);
    const db = new DatabaseSync(join(home, ".dispatch", "board.db"));
    try {
      const upsert = db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      );
      db.exec("BEGIN");
      for (const card of finalFixtures)
        upsert.run(card.id, JSON.stringify(card));
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    server = bootServerAt(home, pathPrefix);
    await waitForReady(SANDBOX_PORT);
    console.log(
      `standup: sandbox server re-booted with real fixtures, pid=${server.pid}`,
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
    // read as "still loading" to the poll below. Also queues `Fetch.requestPaused` events for
    // criterion 4's body-capture, harmless while the Fetch domain is disabled.
    const fetchPausedQueue = [];
    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.exceptionThrown") {
        console.error(
          `page exception: ${JSON.stringify(msg.params.exceptionDetails)}`,
        );
      } else if (msg.method === "Fetch.requestPaused") {
        fetchPausedQueue.push(msg.params);
      }
    });

    async function waitForNextPausedRequest(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (fetchPausedQueue.length > 0) return fetchPausedQueue.shift();
        await sleep(50);
      }
      throw new Error(
        `no Fetch.requestPaused event observed within ${timeoutMs}ms`,
      );
    }

    await enableOrcaMode(cdp, sessionId, ALL_IDENTIFIERS);
    console.log("standup: Orca/docked mode enabled, every fixture rendered");

    // =====================================================================
    // Criterion 1 — structural gating on newSession, and a real unchecked checkbox
    // =====================================================================
    console.log("\n--- criterion 1: structural gating ---");
    await selectCardViaOrcaNav(cdp, sessionId, TODO);
    await evalValue(
      cdp,
      sessionId,
      `(function () {
        var btns = Array.prototype.slice.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button'));
        var start = btns.find(function (b) { return b.textContent.trim() === "Start"; });
        if (!start) throw new Error("panel95: 'Start' button not found on the todo fixture");
        start.click();
        return true;
      })()`,
    );
    const noIntentOpened = await waitForModal(cdp, sessionId, true);
    if (!noIntentOpened) {
      violations.push(
        "criterion-1: StartModal never opened on the todo (no-newSession) fixture",
      );
    } else {
      const nullHalf = await evalReport(
        cdp,
        sessionId,
        violations,
        "criterion-1 (null half)",
        `${FIND_INHERIT_LABEL_SRC} panel95FindInheritLabel()`,
      );
      console.log(
        `criterion 1 (null half): inherit label = ${JSON.stringify(nullHalf)}`,
      );
      if (nullHalf !== null) {
        violations.push(
          `criterion-1: expected NO inherit toggle on a newSession-absent open, found one`,
        );
      }
      await closeModal(cdp, sessionId);
    }

    await selectCardViaOrcaNav(cdp, sessionId, N1_CLEAN);
    await evalValue(
      cdp,
      sessionId,
      `(function () {
        var btns = Array.prototype.slice.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button'));
        var start = btns.find(function (b) { return b.textContent.trim() === "Start another session"; });
        if (!start) throw new Error("panel95: 'Start another session' button not found on N1_CLEAN");
        start.click();
        return true;
      })()`,
    );
    const realHalfOpened = await waitForModal(cdp, sessionId, true);
    if (!realHalfOpened) {
      violations.push(
        "criterion-1: StartModal never opened on the N1_CLEAN (newSession=true) fixture",
      );
    } else {
      const checkboxState = await evalReport(
        cdp,
        sessionId,
        violations,
        "criterion-1 (real half)",
        `${FIND_INHERIT_LABEL_SRC}
        (function () {
          var label = panel95FindInheritLabel();
          if (!label) return { found: false };
          var input = label.querySelector('input[type="checkbox"]');
          return { found: true, isCheckbox: input != null, checked: input ? input.checked : null };
        })()`,
      );
      console.log(`criterion 1 (real half): ${JSON.stringify(checkboxState)}`);
      if (!checkboxState?.found || !checkboxState.isCheckbox) {
        violations.push(
          `criterion-1: expected a real <input type="checkbox"> on a newSession=true open, got ${JSON.stringify(checkboxState)}`,
        );
      } else if (checkboxState.checked !== false) {
        violations.push(
          `criterion-1: expected the checkbox to default unchecked, got checked=${checkboxState.checked}`,
        );
      }

      // =====================================================================
      // Criterion 2 — locked copy, read as DOM text
      // =====================================================================
      console.log("\n--- criterion 2: locked copy ---");
      const copy = await evalReport(
        cdp,
        sessionId,
        violations,
        "criterion-2",
        `${FIND_INHERIT_LABEL_SRC}
        (function () {
          var label = panel95FindInheritLabel();
          if (!label) throw new Error("inherit label not found for criterion 2");
          var section = label.parentElement;
          var field = section ? section.querySelector(":scope > *:first-child") : null;
          var spans = label.querySelectorAll("span > span");
          return {
            sectionLabel: field ? field.textContent.trim() : null,
            primaryLine: spans[0] ? spans[0].textContent : null,
            helperLine: spans[1] ? spans[1].textContent : null,
          };
        })()`,
      );
      console.log(`criterion 2: ${JSON.stringify(copy)}`);
      if (copy != null) {
        if (copy.sectionLabel !== "Starting point") {
          violations.push(
            `criterion-2: expected section label "Starting point", got ${JSON.stringify(copy.sectionLabel)}`,
          );
        }
        if (copy.primaryLine !== "Build on Session 1") {
          violations.push(
            `criterion-2: expected primary line "Build on Session 1", got ${JSON.stringify(copy.primaryLine)}`,
          );
        }
        if (
          copy.helperLine == null ||
          !copy.helperLine.includes("stays exactly where it is")
        ) {
          violations.push(
            `criterion-2: helper line missing the locked "stays exactly where it is" clause — got ${JSON.stringify(copy.helperLine)}`,
          );
        }
        if (
          copy.helperLine != null &&
          copy.helperLine.includes("won't carry over")
        ) {
          violations.push(
            `criterion-2: helper line contains the REJECTED "won't carry over" wording — got ${JSON.stringify(copy.helperLine)}`,
          );
        }
      }

      // =====================================================================
      // Criterion 3 — defaults unchecked on every fresh open
      // =====================================================================
      console.log("\n--- criterion 3: resets on reopen ---");
      await evalValue(
        cdp,
        sessionId,
        `${FIND_INHERIT_LABEL_SRC}
        (function () {
          var label = panel95FindInheritLabel();
          var input = label.querySelector('input[type="checkbox"]');
          if (!input.checked) input.click();
          return input.checked;
        })()`,
      );
      const checkedBeforeClose = await evalValue(
        cdp,
        sessionId,
        `${FIND_INHERIT_LABEL_SRC} panel95FindInheritLabel().querySelector('input[type="checkbox"]').checked`,
      );
      console.log(`criterion 3: checked before close = ${checkedBeforeClose}`);
      if (checkedBeforeClose !== true) {
        violations.push(
          "criterion-3: checking the box via a real click did not set checked=true",
        );
      }
      await closeModal(cdp, sessionId);
      await evalValue(
        cdp,
        sessionId,
        `(function () {
          var btns = Array.prototype.slice.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button'));
          var start = btns.find(function (b) { return b.textContent.trim() === "Start another session"; });
          start.click();
          return true;
        })()`,
      );
      await waitForModal(cdp, sessionId, true);
      const checkedAfterReopen = await evalValue(
        cdp,
        sessionId,
        `${FIND_INHERIT_LABEL_SRC} panel95FindInheritLabel().querySelector('input[type="checkbox"]').checked`,
      );
      console.log(`criterion 3: checked after reopen = ${checkedAfterReopen}`);
      if (checkedAfterReopen !== false) {
        violations.push(
          `criterion-3: expected checked=false on a fresh reopen, got ${checkedAfterReopen}`,
        );
      }

      // =====================================================================
      // Criterion 4 — the actual wire body, both toggle states, request failed after capture
      // =====================================================================
      console.log("\n--- criterion 4: wire body, both toggle states ---");
      await cdp.send(
        "Fetch.enable",
        {
          patterns: [
            { urlPattern: "*/api/cards/*/start", requestStage: "Request" },
          ],
        },
        sessionId,
      );

      // Unchecked submission — checkbox is already unchecked from the reopen above. The workspace
      // picker's repo discovery is an async fetch fired on mount; wait for the Start button to
      // actually go enabled (repos discovered + auto-checked) rather than racing it.
      await waitForStartEnabled(cdp, sessionId);
      await evalValue(
        cdp,
        sessionId,
        `(function () {
          var btns = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"] button'));
          var submit = btns.find(function (b) { return b.textContent.trim() === "Start"; });
          if (!submit) throw new Error("panel95: modal Start button not found");
          submit.click();
          return true;
        })()`,
      );
      const uncheckedPaused = await waitForNextPausedRequest(
        FETCH_PAUSE_TIMEOUT_MS,
      );
      const uncheckedBody = uncheckedPaused.request.postData
        ? JSON.parse(uncheckedPaused.request.postData)
        : null;
      console.log(
        `criterion 4 (unchecked): captured body = ${JSON.stringify(uncheckedBody)}`,
      );
      await cdp.send(
        "Fetch.failRequest",
        { requestId: uncheckedPaused.requestId, errorReason: "Failed" },
        sessionId,
      );
      if (uncheckedBody == null) {
        violations.push(
          "criterion-4: no request body captured for the unchecked submission",
        );
      } else {
        if (Object.hasOwn(uncheckedBody, "inheritFrom")) {
          violations.push(
            `criterion-4: unchecked submission's body carries an inheritFrom key entirely — expected total omission, got ${JSON.stringify(uncheckedBody)}`,
          );
        }
        if (uncheckedBody.newSession !== true) {
          violations.push(
            `criterion-4: unchecked submission's body must still carry newSession=true, got ${JSON.stringify(uncheckedBody.newSession)}`,
          );
        }
      }
      await sleep(400); // let the failed-request error settle client-side before the next click

      // Checked submission.
      await evalValue(
        cdp,
        sessionId,
        `${FIND_INHERIT_LABEL_SRC}
        (function () {
          var label = panel95FindInheritLabel();
          if (!label) throw new Error("panel95: inherit label not found for checked submission");
          var input = label.querySelector('input[type="checkbox"]');
          if (!input.checked) input.click();
          return input.checked;
        })()`,
      );
      await evalValue(
        cdp,
        sessionId,
        `(function () {
          var btns = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"] button'));
          var submit = btns.find(function (b) { return b.textContent.trim() === "Start"; });
          submit.click();
          return true;
        })()`,
      );
      const checkedPaused = await waitForNextPausedRequest(
        FETCH_PAUSE_TIMEOUT_MS,
      );
      const checkedBody = checkedPaused.request.postData
        ? JSON.parse(checkedPaused.request.postData)
        : null;
      console.log(
        `criterion 4 (checked): captured body = ${JSON.stringify(checkedBody)}`,
      );
      await cdp.send(
        "Fetch.failRequest",
        { requestId: checkedPaused.requestId, errorReason: "Failed" },
        sessionId,
      );
      const n1ActiveSessionId = finalFixtures.find(
        (c) => c.id === N1_CLEAN_ID,
      )?.activeSessionId;
      if (checkedBody == null) {
        violations.push(
          "criterion-4: no request body captured for the checked submission",
        );
      } else if (checkedBody.inheritFrom !== n1ActiveSessionId) {
        violations.push(
          `criterion-4: checked submission expected inheritFrom=${n1ActiveSessionId}, got ${JSON.stringify(checkedBody.inheritFrom)}`,
        );
      }

      await cdp.send("Fetch.disable", {}, sessionId);
      await sleep(400);
      await closeModal(cdp, sessionId).catch(() => {});

      // =====================================================================
      // Criterion 8, keyboard half — Tab reaches the checkbox, Space toggles, focus ring keyboard-vs-mouse
      // =====================================================================
      console.log(
        "\n--- criterion 8 (keyboard half): Tab/Space/focus ring ---",
      );
      await evalValue(
        cdp,
        sessionId,
        `(function () {
          var btns = Array.prototype.slice.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button'));
          var start = btns.find(function (b) { return b.textContent.trim() === "Start another session"; });
          start.click();
          return true;
        })()`,
      );
      await waitForModal(cdp, sessionId, true);
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
          `${FIND_INHERIT_LABEL_SRC}
          (function () {
            var label = panel95FindInheritLabel();
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
        `criterion 8 (keyboard): Tab traversal reached the checkbox = ${reachedViaTab} (tabCount=${tabCount})`,
      );
      if (!reachedViaTab) {
        violations.push(
          `criterion-8 (keyboard): Tab traversal never reached the inherit checkbox within ${TAB_TRAVERSAL_CAP} tabs`,
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
          `criterion 8 (keyboard): focus outline = ${JSON.stringify(keyboardOutline)}`,
        );
        const ringPresent =
          keyboardOutline.outlineWidth !== "0px" &&
          keyboardOutline.outlineStyle !== "none";
        if (!ringPresent) {
          violations.push(
            `criterion-8 (keyboard): expected a visible focus ring on keyboard focus, got ${JSON.stringify(keyboardOutline)}`,
          );
        }
        const checkedBeforeSpace = await evalValue(
          cdp,
          sessionId,
          `document.activeElement.checked`,
        );
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
        const checkedAfterSpace = await evalValue(
          cdp,
          sessionId,
          `${FIND_INHERIT_LABEL_SRC} panel95FindInheritLabel().querySelector('input[type="checkbox"]').checked`,
        );
        console.log(
          `criterion 8 (keyboard): Space flips checked ${checkedBeforeSpace} -> ${checkedAfterSpace}`,
        );
        if (checkedAfterSpace === checkedBeforeSpace) {
          violations.push(
            `criterion-8 (keyboard): Space did not flip checked (stayed ${checkedBeforeSpace})`,
          );
        }
      }

      // Mouse-click reading — a fresh load so Chrome's :focus-visible heuristic carries no keyboard
      // history over from the Tab passes above.
      await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
      await waitForBoardRootLoaded(cdp, sessionId, ALL_IDENTIFIERS);
      await selectCardViaOrcaNav(cdp, sessionId, N1_CLEAN);
      await evalValue(
        cdp,
        sessionId,
        `(function () {
          var btns = Array.prototype.slice.call(document.querySelectorAll('aside[aria-label="Ticket detail"] button'));
          var start = btns.find(function (b) { return b.textContent.trim() === "Start another session"; });
          start.click();
          return true;
        })()`,
      );
      await waitForModal(cdp, sessionId, true);
      const checkboxRect = await evalReport(
        cdp,
        sessionId,
        violations,
        "criterion-8 (mouse)",
        `${FIND_INHERIT_LABEL_SRC}
        (function () {
          var label = panel95FindInheritLabel();
          var input = label.querySelector('input[type="checkbox"]');
          input.scrollIntoView({ block: "center" });
          var r = input.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`,
      );
      if (checkboxRect != null) {
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", x: checkboxRect.x, y: checkboxRect.y },
          sessionId,
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          {
            type: "mousePressed",
            x: checkboxRect.x,
            y: checkboxRect.y,
            button: "left",
            buttons: 1,
            clickCount: 1,
          },
          sessionId,
        );
        const mouseOutline = await evalValue(
          cdp,
          sessionId,
          `(function () {
            var el = document.activeElement;
            if (!el || el.tagName !== "INPUT") return { outlineWidth: null, outlineStyle: null, wrongElement: true, activeTag: el ? el.tagName : null };
            var s = getComputedStyle(el);
            return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle };
          })()`,
        );
        console.log(
          `criterion 8 (mouse): outline (between mousedown/mouseup) = ${JSON.stringify(mouseOutline)}`,
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          {
            type: "mouseReleased",
            x: checkboxRect.x,
            y: checkboxRect.y,
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
            `criterion-8 (mouse): expected NO focus ring on a mouse click, got ${JSON.stringify(mouseOutline)}`,
          );
        }
      }
      await closeModal(cdp, sessionId).catch(() => {});
    }

    // =====================================================================
    // Criteria 5-7 and criterion 8's absence half land in Task 2 — until then, explicit
    // NOT-YET-IMPLEMENTED violations so this file never silently reports a false PASS for them.
    // =====================================================================
    violations.push(
      "criterion-5: NOT YET IMPLEMENTED (lands in Task 2)",
      "criterion-6: NOT YET IMPLEMENTED (lands in Task 2)",
      "criterion-7: NOT YET IMPLEMENTED (lands in Task 2)",
      "criterion-8 (absence half): NOT YET IMPLEMENTED (lands in Task 2)",
    );
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

  console.log(
    geometryExpectWrong
      ? "\nPASS (--geometry-expect-wrong self-check)"
      : "\nPASS",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`panel-95 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
