/**
 * Phase 100 plan 01 CDP harness scaffold (DRAG-05, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92..99.mjs. This
 * file is the FIRST script in this repo to drive a real dnd-kit `MouseSensor` drag through CDP
 * `Input.dispatchMouseEvent` and prove, before asserting anything else, that the drag actually
 * activated (`assertDragActivated`). Every check this phase writes calls that primitive first; a
 * fixture or a drag sequence that never truly activates dnd-kit would otherwise let every later
 * check pass vacuously against a still board, exactly the "check that cannot fail" failure this
 * milestone has recorded repeatedly (99-REVIEW.md CR-02, three earlier phases' own findings).
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-99.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on :4700, before this script boots any server or spawns any real process, and
 * there is no override flag. It is awaited BEFORE any sandbox directory is created.
 *
 * NO REAL TMUX, NO REAL TTYD, NO REAL SAGA. Every verdict measures DOM shape produced from a wire
 * payload the fixtures seed directly via `node:sqlite` (the panel-93..99.mjs idiom). None of the
 * five fixture cards below ever carries a `tmuxSession`: a seeded `tmuxSession` with no live tmux
 * gets reconciled to lost at boot (`board.store.ts`'s `markSessionLost` full-card-loss branch),
 * which wipes seeded fields before the board ever paints, the exact trap `panel-99.mjs`'s own
 * header documents and this file avoids the same way.
 *
 * FIXTURE SHAPE, matched exactly to `Board.tsx`'s own selection-eligibility predicate
 * (`c.column === "todo" && c.groupId == null && c.source !== "group"`), not a shape the product can
 * never produce. `MSD-A`/`MSD-B`/`MSD-C`/`MSD-D` are all `column: "todo"`, `groupId: null`, no
 * `source` field at all (so `source !== "group"` holds trivially). `MSD-Z` sits in `done` so the
 * direct-move target column is never empty, which would otherwise make "card moved into an empty
 * column" ambiguous with "card moved to the wrong column that happens to render first." No fixture
 * ever seeds a `selectedIds`-shaped object; selection in later plans is only ever produced by real
 * Ctrl/Cmd+click through the real DOM, never a direct React-state injection (RESEARCH Pitfall 2,
 * `99-REVIEW.md` CR-02's own root cause).
 *
 * THE DRAG PRIMITIVE, the load-bearing addition this file makes to the repo's toolbox
 * (`100-PATTERNS.md` gotcha 5, verified against `node_modules/@dnd-kit/core/dist/core.esm.js`).
 * `MouseSensor.activators = [{ eventName: 'onMouseDown' }]`, its `events` map is
 * `{ move: 'mousemove', end: 'mouseup' }`, plain native mouse events, NOT pointer events
 * (`PointerSensor` is not used anywhere in this codebase; `Board.tsx` wires only `MouseSensor` and
 * `TouchSensor`). Those listeners reach the DOM through `Card.tsx`'s
 * `domProps={{ ...listeners, ...attributes, ... }}`, spread onto `CardView`'s root `<div>`, THAT
 * div, never a child button or icon, is the element `Input.dispatchMouseEvent` must target.
 * Activation constraint is `useSensor(MouseSensor, { activationConstraint: { distance: 5 } })`
 * (`Board.tsx`): the FIRST `mousemove` whose delta from the `mousedown` point exceeds 5px activates
 * the drag; a sequence that never exceeds 5px total never starts a drag at all. `beginDrag` below
 * asserts that displacement NUMERICALLY rather than assuming the geometry clears it.
 * `assertDragActivated` is the self-proof: called while the mouse button is still down, it reads
 * the rendered `DragOverlay` node (NOT a `document.body` portal in this dnd-kit version,
 * `DragOverlay`'s own source has no `createPortal` call, it renders in normal React tree flow
 * exactly where `<DragOverlay>` sits in `Board.tsx`'s JSX, which is a sibling of the column scroll
 * row, never nested inside any `[data-column]` container) and asserts the SOURCE card root's
 * computed `opacity` is `"0.4"` (`CardView.tsx`'s `dimmed` rendering, driven only by
 * `useDraggable().isDragging`, which is only ever true today while a drag is genuinely active). If
 * either reading is absent or wrong, `assertDragActivated` THROWS, naming the identifier and both
 * readings, it never records a violation and continues, because every later check in this phase
 * calls it first and a soft failure there would let those checks pass against a board that never
 * moved (the exact failure mode `100-01-PLAN.md`'s own rationale names).
 *
 * CARD LOCATION, the `density-91.mjs`/`panel-99.mjs` convention copied verbatim: no DOM `id` or
 * `data-*` attribute names an individual card today, so every card lookup below walks
 * `[data-column="<column>"] > .scroll-stable-y`'s direct DIV children and matches on
 * `el.textContent.indexOf(identifier) !== -1`, throwing on zero matches and on more than one match.
 * No locator anywhere in this file keys on an `aria-label` prefix (the standing Trap 3 rule this
 * milestone has recorded from `panel-99.mjs`'s own header): an attribute a later regression could
 * change would report "not found" instead of naming the wrong value, which looks like a real
 * pass/fail signal but proves nothing.
 *
 * Ports, unique across every existing harness (verified against every `panel-9x.mjs`,
 * `density-91.mjs`, and `port-attribution-99.mjs`'s own constants): sandbox server 47876, CDP 9377,
 * sandbox prefix `dispatch-panel-100-`.
 *
 * Usage:
 *   node scripts/panel-100.mjs                       every registered check, exits non-zero on any
 *                                                       violation. With zero checks registered (this
 *                                                       plan's own state before plan 03 lands
 *                                                       `atomic-rollback`), stands up and tears down
 *                                                       cleanly and exits 0.
 *   node scripts/panel-100.mjs --check <name>         one named check only.
 *   node scripts/panel-100.mjs --break <name>         that check's OWN break: fires the SAME check
 *                                                       function the real run uses against a DOM
 *                                                       mutation, confirms it reports the violation
 *                                                       by name, restores the captured original,
 *                                                       and re-confirms PASS, all inside one Chrome
 *                                                       tab. Never edits a source file.
 *
 * BREAK EVIDENCE, TO BE FILLED (plan 01 task 3 fills this in with the verbatim trip-leg output of
 * `single-card-unchanged` and `keyboard-unchanged`'s own `--break` runs, once those checks exist).
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
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
/** Every verdict here reads DOM served out of `dist/web`, a server-only build would measure a
 * stale bundle, so this is the full `build`, never `build:server`. */
const BUILD_SCRIPT = "build";

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair in this repo (verified against
 * density-91.mjs 47861/9366, panel-92..99.mjs 47864..47871/47874/9367..9373/9376, port-attribution-99.mjs
 * 47875). Neither number below equals any of them. */
const SANDBOX_PORT = 47876;
const CDP_PORT = 9377;
const SANDBOX_PREFIX = "dispatch-panel-100-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RENDER_TIMEOUT_MS = 15_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-100-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-100-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-100-LIVE"))
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
      "echo 'panel-100 stub claude, deliberately never ready'\n" +
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
// Fixtures. MSD-A..D are selection-eligible per Board.tsx's own predicate
// (column === "todo" && groupId == null && source !== "group"); MSD-Z sits in
// "done" so the direct-move target column is never empty. No fixture carries
// a tmuxSession (see header note). No fixture ever seeds a selectedIds-shaped
// object; selection is only ever produced by real DOM interaction.
// ---------------------------------------------------------------------------

const MSD_A_ID = "panel100-a";
const MSD_A_IDENTIFIER = "MSD-A";
const MSD_B_ID = "panel100-b";
const MSD_B_IDENTIFIER = "MSD-B";
const MSD_C_ID = "panel100-c";
const MSD_C_IDENTIFIER = "MSD-C";
const MSD_D_ID = "panel100-d";
const MSD_D_IDENTIFIER = "MSD-D";
const MSD_Z_ID = "panel100-z";
const MSD_Z_IDENTIFIER = "MSD-Z";

const TOP_LEVEL_IDENTIFIERS = [
  MSD_A_IDENTIFIER,
  MSD_B_IDENTIFIER,
  MSD_C_IDENTIFIER,
  MSD_D_IDENTIFIER,
  MSD_Z_IDENTIFIER,
];

function baseCardFields(id, identifier, title, column) {
  return {
    id,
    issueId: `${id}-issue`,
    identifier,
    title,
    description: null,
    priority: 3,
    column,
    groupId: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Four selection-eligible `todo` cards plus one `done` card so the direct-move target column is
 * never empty. Deliberately NO `tmuxSession` and NO `selectedIds`-shaped seeding anywhere. */
function allFixtureCards() {
  return [
    baseCardFields(
      MSD_A_ID,
      MSD_A_IDENTIFIER,
      "panel-100 MSD-A fixture card",
      "todo",
    ),
    baseCardFields(
      MSD_B_ID,
      MSD_B_IDENTIFIER,
      "panel-100 MSD-B fixture card",
      "todo",
    ),
    baseCardFields(
      MSD_C_ID,
      MSD_C_IDENTIFIER,
      "panel-100 MSD-C fixture card",
      "todo",
    ),
    baseCardFields(
      MSD_D_ID,
      MSD_D_IDENTIFIER,
      "panel-100 MSD-D fixture card",
      "todo",
    ),
    baseCardFields(
      MSD_Z_ID,
      MSD_Z_IDENTIFIER,
      "panel-100 MSD-Z fixture card",
      "done",
    ),
  ];
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93..99.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
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

/** Standup-only: confirms the initial board paint reached every fixture identifier before any
 * check runs. */
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
        `PANEL-100-STALE-PORT: :${port} is already held before this run started, a prior run of ` +
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
// Navigation and DOM-lookup helpers, shared by every check and the drag
// primitive. Every selector below keys on rendered leaf text or DOM
// structure, never on an aria-label prefix attribute (Trap 3).
// ---------------------------------------------------------------------------

/** Locates a card root ANYWHERE on the board (searches every `[data-column]`), the same idiom
 * `panel-99.mjs`'s own `panel99FindCardRoot` uses. Throws on zero matches and on more than one. */
const FIND_CARD_SRC = `
  function panel100FindCardRoot(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
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
    if (matches.length === 0) throw new Error("panel100: card " + identifier + " not found on board");
    if (matches.length > 1) throw new Error("panel100: identifier " + identifier + " matched " + matches.length + " card roots");
    return matches[0];
  }
`;

/** Locates a card root SCOPED to one column, the exact convention `100-01-PLAN.md`'s <interfaces>
 * block locks (copied from `density-91.mjs:505-540`). Throws on zero matches and on more than one
 * match, never returns an ambiguous element. */
const FIND_CARD_IN_COLUMN_SRC = `
  function panel100FindCardInColumn(column, identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
    var col = root.querySelector('[data-column="' + column + '"]');
    if (!col) throw new Error("panel100: column not found: " + column);
    var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
    if (!scrollContainer) throw new Error("panel100: scroll container not found in column " + column);
    var cardRoots = Array.prototype.filter.call(scrollContainer.children, function (el) {
      return el.tagName === "DIV";
    });
    var matches = cardRoots.filter(function (el) { return el.textContent.indexOf(identifier) !== -1; });
    if (matches.length === 0) throw new Error("panel100: card " + identifier + " not found in column " + column);
    if (matches.length > 1) throw new Error("panel100: identifier " + identifier + " matched " + matches.length + " card roots in column " + column);
    return matches[0];
  }
`;

/** Reports which column (its `data-column` value) currently contains `identifier`'s card root, or
 * `null` if it is in none of them (never throws "not found", since a mid-drag card genuinely may be
 * transiently absent from every column's DOM list for zero polls). */
const FIND_CARD_COLUMN_SRC = `
  function panel100CardColumnOf(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
    var columns = Array.prototype.slice.call(root.querySelectorAll("[data-column]"));
    var found = null;
    columns.forEach(function (col) {
      var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
      if (!scrollContainer) return;
      var cardRoots = Array.prototype.filter.call(scrollContainer.children, function (el) {
        return el.tagName === "DIV";
      });
      var matches = cardRoots.filter(function (el) { return el.textContent.indexOf(identifier) !== -1; });
      if (matches.length > 0) found = col.getAttribute("data-column");
    });
    return found;
  }
`;

/**
 * Locates the rendered `DragOverlay` node while a drag is active: an element carrying BOTH
 * `aria-hidden="true"` and `inert` (the exact pair `Board.tsx:368` spreads onto the overlay's
 * `CardView` root via `domProps`), whose text contains the dragged identifier, and whose subtree is
 * OUTSIDE every `[data-column]` container (this dnd-kit version renders `DragOverlay` in normal
 * React tree flow, not a `document.body` portal, verified against the installed `core.esm.js`,
 * which has no `createPortal` call in `DragOverlay`'s own source). Returns the OUTERMOST such node
 * (never an inner descendant that also happens to match), or `null` if none is found. Never throws
 * on absence; the caller (`assertDragActivated`) is the one place that decides absence is fatal.
 */
const FIND_OVERLAY_SRC = `
  function panel100FindOverlayNode(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
    var candidates = Array.prototype.filter.call(
      root.querySelectorAll('[aria-hidden="true"][inert]'),
      function (el) {
        return el.textContent.indexOf(identifier) !== -1 && !el.closest("[data-column]");
      }
    );
    if (candidates.length === 0) return null;
    var outer = candidates.filter(function (el) {
      return !candidates.some(function (other) { return other !== el && other.contains(el); });
    });
    if (outer.length !== 1) {
      throw new Error("panel100: overlay node for " + identifier + " ambiguous, matched " + outer.length + " outermost candidates");
    }
    return outer[0];
  }
`;

/** Centre point and geometry of a card root scoped to `column`, throwing per
 * `FIND_CARD_IN_COLUMN_SRC`'s own zero/many-match discipline. */
async function findCardRect(cdp, sessionId, column, identifier) {
  return evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_IN_COLUMN_SRC}(function () {
      var el = panel100FindCardInColumn(${JSON.stringify(column)}, ${JSON.stringify(identifier)});
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
    })()`,
  );
}

/** A point inside `[data-column="<column>"]` that is NOT on top of any card: the column rect's
 * horizontal centre, at a y a fixed distance below the column's own sticky header (the same
 * sticky-header derivation `density-91.mjs`'s `MEASURE_EXPR` uses), so the drop resolves to the
 * column droppable rather than a specific card's droppable/sortable target. */
async function columnDropPoint(cdp, sessionId, column) {
  return evalValue(
    cdp,
    sessionId,
    `(function () {
      var root = document.getElementById("root");
      if (!root) throw new Error("panel100: board root #root not found");
      var col = root.querySelector('[data-column="' + ${JSON.stringify(column)} + '"]');
      if (!col) throw new Error("panel100: column not found: " + ${JSON.stringify(column)});
      var header = null;
      for (var i = 0; i < col.children.length; i++) {
        var child = col.children[i];
        if (getComputedStyle(child).position === "sticky") { header = child; break; }
      }
      if (!header) throw new Error("panel100: sticky header not found in column " + ${JSON.stringify(column)});
      var colRect = col.getBoundingClientRect();
      var headerRect = header.getBoundingClientRect();
      return { x: colRect.left + colRect.width / 2, y: headerRect.bottom + 24 };
    })()`,
  );
}

/**
 * `mousePressed` at the card's centre, then four `mouseMoved` steps interpolating to `target` with
 * `buttons: 1` and a 20ms sleep between each (the `panel-mount-92.mjs:756-805` recipe, proven there
 * for a plain `onPointerDown` resize handle and applied here, for the first time in this repo,
 * against a real dnd-kit `useDraggable`/`MouseSensor` card). Deliberately issues NO
 * `mouseReleased`, the caller decides when the drag ends. Asserts NUMERICALLY that the first
 * interpolated step displaces more than 5px, since `Board.tsx`'s `{ distance: 5 }` activation
 * constraint never fires for a shorter first move, throwing rather than silently proceeding with a
 * drag that never activates.
 */
async function beginDrag(cdp, sessionId, column, identifier, target) {
  const rect = await findCardRect(cdp, sessionId, column, identifier);
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = target.x;
  const y1 = target.y;
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: x0,
      y: y0,
      button: "left",
      buttons: 1,
      clickCount: 1,
    },
    sessionId,
  );
  const fracs = [0.25, 0.5, 0.75, 1];
  let firstStepDisplacement = null;
  for (let i = 0; i < fracs.length; i++) {
    const frac = fracs[i];
    const x = x0 + (x1 - x0) * frac;
    const y = y0 + (y1 - y0) * frac;
    if (i === 0) firstStepDisplacement = Math.hypot(x - x0, y - y0);
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x, y, buttons: 1 },
      sessionId,
    );
    await sleep(20);
  }
  if (firstStepDisplacement == null || firstStepDisplacement <= 5) {
    throw new Error(
      `beginDrag: ${identifier}, first interpolated move step displaced only ${firstStepDisplacement}px, ` +
        `must exceed 5px to clear dnd-kit's { distance: 5 } activation constraint (Board.tsx), ` +
        `the drag would never activate`,
    );
  }
  return { x: x1, y: y1 };
}

/** `mouseReleased` at `point`, then a settle sleep so the resulting `onDragEnd`/optimistic-update
 * work has a chance to run before the caller reads any post-drop DOM state. */
async function endDrag(cdp, sessionId, point) {
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    },
    sessionId,
  );
  await sleep(150);
}

/**
 * THE LOAD-BEARING SELF-PROOF (see header). Called while the mouse button is still down (between
 * `beginDrag` and `endDrag`). Reads, in one `Runtime.evaluate` round trip: (a) whether a
 * `DragOverlay` node for `identifier` exists outside every `[data-column]` container, and (b) the
 * SOURCE card root's computed `opacity`. THROWS, never records a violation and returns, if the
 * overlay is absent or the opacity is not exactly `"0.4"`, naming the identifier and both readings.
 * A silent "no overlay, carry on" here would turn every later check in this phase into a dead
 * instrument, since they all call this first.
 */
async function assertDragActivated(cdp, sessionId, identifier) {
  const reading = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}${FIND_OVERLAY_SRC}(function () {
      var card = panel100FindCardRoot(${JSON.stringify(identifier)});
      var overlay = panel100FindOverlayNode(${JSON.stringify(identifier)});
      return {
        cardOpacity: getComputedStyle(card).opacity,
        overlayFound: overlay != null,
      };
    })()`,
  );
  if (!reading.overlayFound) {
    throw new Error(
      `assertDragActivated: ${identifier}, no DragOverlay node found outside any [data-column] ` +
        `container while the mouse button is held down; the drag never activated ` +
        `(cardOpacity measured ${JSON.stringify(reading.cardOpacity)})`,
    );
  }
  if (reading.cardOpacity !== "0.4") {
    throw new Error(
      `assertDragActivated: ${identifier}, source card root opacity expected "0.4" ` +
        `(CardView.tsx's dimmed rendering, driven only by useDraggable().isDragging), measured ` +
        `${JSON.stringify(reading.cardOpacity)}; the drag never activated (overlayFound=${reading.overlayFound})`,
    );
  }
  return reading;
}

/**
 * The full single-card drag: `beginDrag`, `assertDragActivated` (throws if the drag never really
 * started), `endDrag`, then polls `cardColumnOf` until it reads `toColumn` or `RENDER_TIMEOUT_MS`
 * elapses. THROWS naming both `fromColumn` and `toColumn`, plus the last observed column, if the
 * card never settles into `toColumn`.
 */
async function dragCardToColumn(
  cdp,
  sessionId,
  fromColumn,
  identifier,
  toColumn,
) {
  const target = await columnDropPoint(cdp, sessionId, toColumn);
  const point = await beginDrag(cdp, sessionId, fromColumn, identifier, target);
  await assertDragActivated(cdp, sessionId, identifier);
  await endDrag(cdp, sessionId, point);

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(identifier)})`,
    );
    if (last === toColumn) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `dragCardToColumn: ${identifier} never settled into column "${toColumn}" (dragged from ` +
      `"${fromColumn}"), last observed column: ${JSON.stringify(last)}`,
  );
}

// ---------------------------------------------------------------------------
// Checks. Empty in this plan (100-01): the two DRAG-05 baseline checks
// (single-card-unchanged, keyboard-unchanged) and their break legs land in
// this same file's next task. main() below already supports the full
// --check/--break contract so later plans in this phase extend CHECKS and
// BREAKS without touching the harness scaffold.
// ---------------------------------------------------------------------------

const CHECKS = {};

const BREAKS = {};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const checkName = readFlag(argv, "--check");
  if (checkName != null && !CHECKS[checkName]) {
    console.error(
      `unknown check "${checkName}", valid: ${Object.keys(CHECKS).join(", ") || "(none registered yet)"}`,
    );
    process.exit(1);
  }
  const breakName = readFlag(argv, "--break");
  if (breakName != null && !BREAKS[breakName]) {
    console.error(
      `unknown break "${breakName}", valid: ${Object.keys(BREAKS).join(", ") || "(none registered yet)"}`,
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
      if (names.length === 0) {
        console.log(
          "\nno checks registered yet in this file, standup/teardown only",
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
  console.error(`panel-100 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
