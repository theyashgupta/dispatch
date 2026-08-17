/**
 * Phase 91 scanning-density instrument (UI-01, dev/ops tooling, NOT test code): imports no test
 * framework, asserts nothing via an assertion library, lives outside src/ — the same category as
 * check-invariants.mjs, migration-diff-v3.mjs, and perf-board.mjs. It answers ROADMAP criterion 4:
 * does a multi-session card's chip-count suffix change card row height or cards-visible-per-
 * breakpoint versus the v2.9 baseline? A BEFORE run must land before this phase's first frontend
 * commit — a snapshot taken afterwards measures nothing.
 *
 * SAFETY — this is the sharpest hazard in this phase, stated once and load-bearing for every later
 * instrument that copies this file's shape. Booting ANY dispatch server (sandboxed or not) runs
 * `reconcileSessions()` at boot, which sweeps `ttyd` processes MACHINE-WIDE via `adoptAndSweep` —
 * fingerprinted by argv shape (ttyd + tmux attach, the revision marker, or the
 * `-b /sessions/<cardId>/terminal` base path), NEVER by tmux session name or by which board.db
 * spawned it. Running this instrument while the user's real dispatch service is live on :4700
 * would reap the user's own live ttyd processes. `assertNoLiveService()` below is therefore a
 * FAIL-CLOSED pre-flight: it throws (never warns, never degrades) if anything answers on :4700,
 * before this script spawns a sandbox server, before it writes a single byte. This instrument
 * itself spawns no real tmux/ttyd (it only measures rendered DOM geometry against a seeded fixture
 * whose session fields are inert strings, never live processes) — the guard exists anyway because
 * the sandbox server's own boot-time reconcile pass runs unconditionally and would otherwise sweep
 * the user's real ttyd fleet exactly as a normal restart would.
 *
 * `assertSandboxSafe` (the same four checks migration-diff-v3.mjs and perf-board.mjs use) is
 * SCOPED TO STATE ON DISK, NOT TO PROCESS STATE — it fences the database and the port, not the
 * machine-wide ttyd sweep `assertNoLiveService` exists to prevent. This harness only ever boots
 * the production build (`dist/server/bootstrap/index.js`); the Vite dev-server proxy hardcodes its
 * `/api/`/`/sessions/` targets to the user's real, live dispatch port and must never be used here.
 * The real board.db's mtime and size are recorded before and after this script runs; a mismatch is
 * a loud non-zero-exit failure, never a warning.
 *
 * CARD IDENTIFICATION: no DOM `id`/`data-*` attribute names an individual card today (verified
 * against the current `CardView.tsx`/`Card.tsx` — grep-confirmed). Adding one would be a `src/`
 * edit, which this plan's own ordering constraint forbids until the BEFORE snapshot exists. This
 * instrument therefore locates the two measured fixture cards by their rendered `card.identifier`
 * text (`DENS-SOLO` / `DENS-PAIR`) — the closest existing "id-bearing" surface a card exposes, and
 * unique by construction (fixed-prefix identifiers no fixture id is ever a substring of another).
 *
 * Usage:
 *   node scripts/density-91.mjs                     measure and print the 16-number table
 *   node scripts/density-91.mjs --json <path>        measure and write raw readings as JSON
 *   node scripts/density-91.mjs --compare <path>     measure, diff against a previous JSON at
 *                                                     ZERO tolerance, print one line per mismatch
 *
 * Exit codes: 0 all checks PASS (or plain/--json mode with no comparison requested). 1 a live
 * :4700 (WR-08), a missing production build, a sandbox-safety violation, a card the evaluate could
 * not find or that collided with its sibling, a --compare MISMATCH, the real board.db changing
 * during the run, or a sandbox port still held after teardown.
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  readFileSync,
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

const SANDBOX_PORT = 47861;
const CDP_PORT = 9366;
const SANDBOX_PREFIX = "dispatch-density-91-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RESIZE_SETTLE_MS = 250;
const RENDER_TIMEOUT_MS = 15_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** The four scanning-density breakpoints, matching 89-BASELINE.md's and the UI-SPEC's lineage. */
const BREAKPOINTS = [
  { name: "1600", width: 1600, height: 1000 },
  { name: "1280", width: 1280, height: 900 },
  { name: "900", width: 900, height: 800 },
  { name: "390", width: 390, height: 844 },
];

/** The four numeric fields read at every breakpoint — 4 breakpoints x 4 fields = 16 readings. */
const READING_FIELDS = [
  "soloHeight",
  "pairHeight",
  "columnHeaderHeight",
  "cardsVisible",
];

const SOLO_IDENTIFIER = "DENS-SOLO";
const PAIR_IDENTIFIER = "DENS-PAIR";
const FILLER_COUNT = 10;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The fail-closed guard this whole instrument exists to prove: throw (never degrade) if anything
 * answers on the user's real dispatch port. A `WR-08` token is embedded in the thrown message so
 * the reason a run aborted is greppable from stderr alone. Only a fetch rejection (ECONNREFUSED —
 * nothing listening) is the safe path; that rejection is swallowed here, everything else re-thrown.
 */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "WR-08: a live dispatch service answered on http://127.0.0.1:4700/api/board — refusing to " +
        "boot a sandbox server while the user's real service is up (its boot-time reconcile pass " +
        "sweeps ttyd machine-wide). Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("WR-08")) throw err;
  }
}

/**
 * The structural guarantee behind "never touches the user's real board.db or port 4700": called
 * before any filesystem write touching `home`. Throws (never silently degrades) if any check
 * fails. Scoped to disk state only — see the file header's SAFETY section for what this does NOT
 * cover.
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

/** Obviously-fake placeholder Linear key, clearing the first-run gate without ever touching a real key. */
const FAKE_LINEAR_API_KEY = "density-91-harness-fake-key-never-real";

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

/**
 * Boot the harness's own server against `home`. Only ever spawns the production build — refuses
 * with a `npm run build` pointer if it is missing, per the file header's safety-envelope order.
 */
function bootServer(home) {
  if (!existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
    process.exit(1);
  }
  return spawn("node", [DIST_ENTRY], {
    env: { ...process.env, HOME: home, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

/** Locate a local Chrome binary, or throw with a clear message if none of the known paths exist. */
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
 * The twelve `done`-column fixture cards. `dens-solo` carries one session, `dens-pair` carries
 * two, both projected onto the card's flat mirror fields so the chip renders `Live` — Phase 90's
 * recorded reason for seeding on `done` rather than `in_progress`: `reconcileSessions()` and the
 * watcher's 3-strike detector never touch a `todo`/`done` card whose claimed tmux session isn't
 * live, so nothing mutates these fields mid-measurement. Every filler card also carries a
 * `workspacePath` so all twelve land in `Column.tsx`'s single `doneGroups.awaiting` bucket — no
 * `CleanedDivider` element splits the scroll container's children, keeping "every direct child of
 * the scroll container is a card root" true without qualification. Every card shares one fixed
 * title string, satisfying "same title length on all of them" — the one deliberate exception is
 * Break B's proof run, which hand-edits `dens-pair`'s title alone and reverts it.
 */
function makeFixtureCards(home) {
  const now = new Date().toISOString();
  const sharedTitle =
    "Density fixture card for the phase 91 scanning-density instrument";

  function session(tmuxSession, ttydPort) {
    const id = randomUUID();
    return {
      id,
      createdAt: now,
      updatedAt: now,
      tmuxSession,
      ttydPort,
      workspacePath: join(home, "workspaces", tmuxSession),
    };
  }

  const soloSession = session("dsp-dens-solo", 41101);
  const pairSessionA = session("dsp-dens-pair-a", 41102);
  const pairSessionB = session("dsp-dens-pair-b", 41103);

  const cards = [
    {
      id: "dens-solo",
      issueId: "dens-solo-issue",
      identifier: SOLO_IDENTIFIER,
      title: sharedTitle,
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
      id: "dens-pair",
      issueId: "dens-pair-issue",
      identifier: PAIR_IDENTIFIER,
      title: sharedTitle,
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      sessions: [pairSessionA, pairSessionB],
      activeSessionId: pairSessionA.id,
      tmuxSession: pairSessionA.tmuxSession,
      ttydPort: pairSessionA.ttydPort,
      workspacePath: pairSessionA.workspacePath,
    },
  ];

  for (let i = 1; i <= FILLER_COUNT; i++) {
    const n = String(i).padStart(2, "0");
    cards.push({
      id: `dens-f${n}`,
      issueId: `dens-f${n}-issue`,
      identifier: `DENS-F${n}`,
      title: sharedTitle,
      description: null,
      priority: 3,
      column: "done",
      updatedAt: now,
      workspacePath: join(home, "workspaces", `dens-f${n}`),
    });
  }

  return cards;
}

/**
 * Boot once against the empty sandbox home so the store creates the real `cards`/`meta` schema,
 * kill that boot, then insert the fixture rows directly via `node:sqlite` — the
 * migration-diff-v3.mjs / perf-board.mjs seeding idiom, never a hand-duplicated schema.
 */
async function seedFixtureCards(home, fixtures) {
  const warmup = bootServer(home);
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
 * The single measurement expression, reused unmodified at all four breakpoints — this is the
 * file's ONE `document.querySelector` call (89-BASELINE.md's scoping rule: every other lookup
 * chains off this asserted root). THROWS if the board root, the done column, its scroll
 * container, or its sticky header cannot be resolved, if either measured card's identifier cannot
 * be found, or if the two measured cards resolve to the SAME DOM node — a reading that silently
 * reports one element twice is the wrong-subject failure this instrument must be immune to.
 */
const MEASURE_EXPR = `
(function () {
  var root = document.querySelector("#root");
  if (!root) throw new Error("board root #root not found");
  var col = root.querySelector('[data-column="done"]');
  if (!col) throw new Error("done column root not found");
  var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
  if (!scrollContainer) throw new Error("done column scroll container not found");

  var header = null;
  for (var i = 0; i < col.children.length; i++) {
    var child = col.children[i];
    if (getComputedStyle(child).position === "sticky") {
      if (header) throw new Error("multiple sticky header candidates in done column");
      header = child;
    }
  }
  if (!header) throw new Error("done column header (sticky child) not found");

  var cardRoots = Array.prototype.filter.call(
    scrollContainer.children,
    function (el) { return el.tagName === "DIV"; }
  );

  function findByIdentifier(identifier) {
    var matches = cardRoots.filter(function (el) {
      return el.textContent.indexOf(identifier) !== -1;
    });
    if (matches.length === 0) {
      throw new Error("card with identifier " + identifier + " not found in done column");
    }
    if (matches.length > 1) {
      throw new Error("identifier " + identifier + " matched " + matches.length + " card roots");
    }
    return matches[0];
  }

  var soloEl = findByIdentifier("${SOLO_IDENTIFIER}");
  var pairEl = findByIdentifier("${PAIR_IDENTIFIER}");
  if (soloEl === pairEl) {
    throw new Error("dens-solo and dens-pair resolved to the SAME DOM node — wrong-subject failure");
  }

  var containerRect = scrollContainer.getBoundingClientRect();
  var cardsVisible = 0;
  cardRoots.forEach(function (el) {
    var r = el.getBoundingClientRect();
    var overlapTop = Math.max(r.top, containerRect.top);
    var overlapBottom = Math.min(r.bottom, containerRect.bottom);
    var overlapHeight = Math.max(0, overlapBottom - overlapTop);
    var fraction = r.height > 0 ? overlapHeight / r.height : 0;
    if (fraction >= 0.5) cardsVisible++;
  });

  return {
    soloHeight: soloEl.getBoundingClientRect().height,
    pairHeight: pairEl.getBoundingClientRect().height,
    columnHeaderHeight: header.getBoundingClientRect().height,
    cardsVisible: cardsVisible,
  };
})()
`;

/**
 * Poll (via `document.getElementById`, deliberately NOT `document.querySelector` — see
 * `MEASURE_EXPR`'s JSDoc for why this file reserves that call for the measurement itself) until
 * both measured fixture identifiers are visible in the rendered done column.
 */
async function waitForFixtureRendered(cdp, sessionId) {
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const probe = `
    (function () {
      var root = document.getElementById("root");
      if (!root) return false;
      var col = root.querySelector('[data-column="done"]');
      if (!col) return false;
      var text = col.textContent;
      return text.indexOf("${SOLO_IDENTIFIER}") !== -1 && text.indexOf("${PAIR_IDENTIFIER}") !== -1;
    })()
  `;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `fixture cards ${SOLO_IDENTIFIER}/${PAIR_IDENTIFIER} never rendered in the done column within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/** Run `MEASURE_EXPR` at every breakpoint, returning `{ [breakpointName]: readings }`. */
async function runMeasurement(cdp, sessionId) {
  const readings = {};
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
    readings[bp.name] = await evalValue(cdp, sessionId, MEASURE_EXPR);
  }
  return readings;
}

/** Diff every one of the sixteen numbers at ZERO tolerance, naming breakpoint, field and both values. */
function compareReadings(before, after) {
  const violations = [];
  for (const bp of BREAKPOINTS) {
    const b = before[bp.name];
    const a = after[bp.name];
    if (!b || !a) {
      violations.push(
        `${bp.name}: missing reading in ${!b ? "baseline" : "fresh run"}`,
      );
      continue;
    }
    for (const field of READING_FIELDS) {
      if (b[field] !== a[field]) {
        violations.push(
          `${bp.name}.${field}: expected ${b[field]}, got ${a[field]}`,
        );
      }
    }
  }
  return violations;
}

function printTable(readings) {
  console.log(
    "\nbreakpoint  soloHeight  pairHeight  columnHeaderHeight  cardsVisible",
  );
  for (const bp of BREAKPOINTS) {
    const r = readings[bp.name];
    console.log(
      `${bp.name.padEnd(12)}${String(r.soloHeight).padEnd(12)}${String(r.pairHeight).padEnd(12)}${String(r.columnHeaderHeight).padEnd(20)}${r.cardsVisible}`,
    );
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
    if (held) {
      console.error(
        `ASSERTION: sandbox ports still held after teardown:\n${stdout}`,
      );
    }
    return held;
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonPath = readFlag(argv, "--json");
  const comparePath = readFlag(argv, "--compare");

  await assertNoLiveService();

  if (!existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
    process.exit(1);
  }

  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  let server = null;
  let chromeChild = null;
  let cdp = null;
  let readings = null;
  let portsHeld = false;

  try {
    const fixtures = makeFixtureCards(home);
    await seedFixtureCards(home, fixtures);

    server = bootServer(home);
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

    await waitForFixtureRendered(cdp, sessionId);
    readings = await runMeasurement(cdp, sessionId);
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

  let violations = [];
  if (comparePath) {
    const before = JSON.parse(readFileSync(comparePath, "utf8"));
    violations = compareReadings(before, readings);
    for (const v of violations) console.log(`MISMATCH ${v}`);
  }

  if (!jsonPath && !comparePath) {
    printTable(readings);
  }

  if (portsHeld) {
    console.log("FAIL: sandbox port(s) still held after teardown");
    process.exit(1);
  }

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} mismatch(es)`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`density-91 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
