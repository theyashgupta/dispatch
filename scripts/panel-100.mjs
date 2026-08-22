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
 *                                                       violation. This plan (100-01) registers two:
 *                                                       single-card-unchanged | keyboard-unchanged.
 *                                                       Later plans in this phase (stacked-overlay,
 *                                                       group-modal-prefill, atomic-rollback, a11y)
 *                                                       extend CHECKS/BREAKS without touching this
 *                                                       scaffold.
 *   node scripts/panel-100.mjs --check <name>         one named check only.
 *   node scripts/panel-100.mjs --break <name>         that check's OWN break: fires the SAME check
 *                                                       function the real run uses against a DOM
 *                                                       mutation, confirms it reports the violation
 *                                                       by name, restores the captured original,
 *                                                       and re-confirms PASS, all inside one Chrome
 *                                                       tab. Never edits a source file.
 *
 * BREAK EVIDENCE, both checks run under `--break <name>` for real and observed reporting their own
 * violation. The quoted lines below are the VERBATIM TRIP-leg output captured from those runs:
 *   - `single-card-unchanged` proven able to fail: removing the `done` column's droppable DOM node
 *     (behind a same-size placeholder so no sibling column reflows) BEFORE the drag starts produced
 *     `single-card-unchanged: MSD-A expected column "done", measured "todo"`.
 *   - `keyboard-unchanged` proven able to fail: detaching MSD-B's MoveToPicker "Done" entry before
 *     the click produced `keyboard-unchanged: MSD-B expected column "done", measured "todo"`.
 * Both `--break <name>` runs' restore legs re-confirmed PASS (`tripFired=true restoreClean=true`
 * for each), and a plain `node scripts/panel-100.mjs` run immediately after both breaks exited 0,
 * proving no break leaked DOM state.
 *
 * TIMING FINDING, load-bearing for the `single-card-unchanged` break specifically, and worth
 * recording since it corrects this plan's own `<interfaces>` block: dnd-kit caches a droppable's
 * rect at drag activation (`handleDragStart`) and does not re-measure a droppable removed AFTER
 * that point. A first draft of this break removed the `done` column's node MID-DRAG (matching the
 * `<interfaces>` block's literal wording, "before the drop"), and the drop SILENTLY SUCCEEDED
 * server-side anyway (verified via a direct `fetch("/api/board")` read from the page: MSD-A's
 * server-side `column` read `"done"`), because collision detection reused the STALE pre-removal
 * rect. The resulting React commit into the now-detached `done` subtree left the whole page stuck
 * (`DragOverlay` never cleared, MSD-A vanished from every attached column, `over` never resolving
 * clean). Removing `done` BEFORE `beginDrag`'s `mousedown` instead means dnd-kit's very first
 * measurement of that droppable reads a detached node's `getBoundingClientRect()` (all zeros in
 * every browser), so no drop point can ever intersect it and `over` correctly resolves to nothing.
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

/** Finds a `"<n> selected"` span anywhere in the document (`SelectionBar.tsx`'s own text, which
 * only mounts at `count >= 2`). Used to prove NOTHING in this plan's baseline checks ever
 * constructs a selection, since every fixture card here is dragged or moved individually. */
const FIND_SELECTION_TEXT_SRC = `
  function panel100FindSelectionText() {
    var spans = Array.prototype.slice.call(document.querySelectorAll("span"));
    var match = spans.find(function (s) { return /^\\d+ selected$/.test((s.textContent || "").trim()); });
    return match ? match.textContent : null;
  }
`;

/** Polls `cardColumnOf` until it reads `toColumn` or `timeoutMs` elapses, returning the LAST
 * observed value either way (never throws). Unlike `dragCardToColumn`'s own poll, this is used by
 * checks that must report a wrong MEASURED column as a named violation rather than an exception,
 * so a `--break` leg's trip output never degrades to an opaque "not found"/timeout message. */
async function pollUntilColumn(
  cdp,
  sessionId,
  identifier,
  toColumn,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(identifier)})`,
    );
    if (last === toColumn) return last;
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

/** Polls until `identifier`'s card renders a button whose text contains "Move to" (`CardView.tsx`,
 * gated `isCarousel && onMoveTo`), i.e. until the narrow-viewport carousel layout has actually
 * activated after a `Emulation.setDeviceMetricsOverride` resize. */
async function waitForMoveToButton(cdp, sessionId, identifier) {
  const probe = `${FIND_CARD_SRC}(function () {
    var card = panel100FindCardRoot(${JSON.stringify(identifier)});
    var buttons = Array.prototype.slice.call(card.querySelectorAll("button"));
    return buttons.some(function (b) { return (b.textContent || "").indexOf("Move to") !== -1; });
  })()`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `panel100: "Move to..." button for ${identifier} never appeared within ${RENDER_TIMEOUT_MS}ms (isCarousel may not have activated)`,
  );
}

/** Clicks `identifier`'s "Move to..." button (a native `.click()`, so React's delegated `onClick`
 * fires exactly as a real mouse click would, the same idiom `panel-99.mjs`'s own
 * `clickCardByIdentifier` uses). Throws if the button cannot be found; this is a setup step, not
 * the assertion under test. */
async function clickMoveToButton(cdp, sessionId, identifier) {
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel100FindCardRoot(${JSON.stringify(identifier)});
      var buttons = Array.prototype.slice.call(card.querySelectorAll("button"));
      var btn = buttons.find(function (b) { return (b.textContent || "").indexOf("Move to") !== -1; });
      if (!btn) throw new Error("panel100: Move to... button not found for " + ${JSON.stringify(identifier)});
      btn.click();
      return true;
    })()`,
  );
}

/** Polls until `MoveToPicker`'s own `role="group" aria-label="Move <identifier> to"` container
 * (`MoveToPicker.tsx:85`) is present. */
async function waitForPickerGroup(cdp, sessionId, identifier) {
  const probe = `(function () {
    return document.querySelector('[role="group"][aria-label="Move ' + ${JSON.stringify(identifier)} + ' to"]') != null;
  })()`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `panel100: MoveToPicker group for ${identifier} never appeared within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/**
 * Clicks the picker entry whose rendered text equals `columnLabel` (e.g. `"Done"`, the exact
 * `COLUMN_LABELS` string `MoveToPicker.tsx` renders, imported from `lib/event-copy.js`) inside
 * `identifier`'s already-open picker group. Returns `true` if the entry was found and clicked,
 * `false` if the group or the entry is absent, NEVER throws: the `keyboard-unchanged` break
 * deliberately detaches the "Done" entry before calling this, and the resulting check must fall
 * through to its own column-poll (reporting a named wrong MEASURED column) rather than an opaque
 * exception, matching `single-card-unchanged`'s own break discipline.
 */
async function clickPickerColumn(cdp, sessionId, identifier, columnLabel) {
  return evalValue(
    cdp,
    sessionId,
    `(function () {
      var group = document.querySelector('[role="group"][aria-label="Move ' + ${JSON.stringify(identifier)} + ' to"]');
      if (!group) return false;
      var buttons = Array.prototype.slice.call(group.querySelectorAll("button"));
      var btn = buttons.find(function (b) { return (b.textContent || "").trim() === ${JSON.stringify(columnLabel)}; });
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
}

// ---------------------------------------------------------------------------
// Checks. The two DRAG-05 baseline checks this plan pins: single-card drag
// and the carousel keyboard "Move to..." path must behave exactly as they
// do today, unaffected by every later plan in this phase. Both checks and
// both break legs run against the UNCHANGED tree (this plan touches no
// src/ file), so the expected outcome is already known and the break legs
// below prove the instrument itself, not a regression.
// ---------------------------------------------------------------------------

/**
 * Shared body for `single-card-unchanged`: with no selection anywhere on the board, drags MSD-A
 * from `todo` to `done` via the real drag primitive and asserts every DRAG-05 "unchanged" property
 * at once. `preDragHook`, when provided, runs AFTER the drop-target point is captured but BEFORE
 * `beginDrag` (i.e. before `mousedown`), letting `runBreakSingleCardUnchanged` remove the `done`
 * droppable's DOM node before dnd-kit ever measures it. This timing is load-bearing, empirically
 * proven by this file's own diagnostic run: dnd-kit caches each droppable's rect at
 * `handleDragStart` and does not re-measure a node it removed AFTER activation, so a mid-drag
 * removal (the timing this plan's own interfaces block first described) leaves the CACHED
 * pre-removal rect live for collision purposes and the drop silently SUCCEEDS server-side, a false
 * negative for this break. Removing the node before the drag starts means dnd-kit's very first
 * measurement reads a detached node's `getBoundingClientRect()`, which browsers return as an
 * all-zero rect, so no drop point can ever intersect it.
 */
async function performSingleCardDragCheck(
  cdp,
  sessionId,
  violations,
  preDragHook,
) {
  const preText = await evalValue(
    cdp,
    sessionId,
    `${FIND_SELECTION_TEXT_SRC}panel100FindSelectionText()`,
  );
  if (preText != null) {
    violations.push(
      `single-card-unchanged: unexpected "${preText}" selection text present before the drag started`,
    );
  }

  const target = await columnDropPoint(cdp, sessionId, "done");

  if (preDragHook) await preDragHook(cdp, sessionId);

  const point = await beginDrag(
    cdp,
    sessionId,
    "todo",
    MSD_A_IDENTIFIER,
    target,
  );
  await assertDragActivated(cdp, sessionId, MSD_A_IDENTIFIER);

  const midReading = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_IN_COLUMN_SRC}${FIND_OVERLAY_SRC}${FIND_SELECTION_TEXT_SRC}(function () {
      var overlay = panel100FindOverlayNode(${JSON.stringify(MSD_A_IDENTIFIER)});
      var source = panel100FindCardInColumn("todo", ${JSON.stringify(MSD_A_IDENTIFIER)});
      if (!overlay) return { overlayFound: false, selectionText: panel100FindSelectionText() };
      var overlayRect = overlay.getBoundingClientRect();
      var sourceRect = source.getBoundingClientRect();
      var candidates = [overlay].concat(Array.prototype.slice.call(overlay.querySelectorAll("*")));
      var faceCount = 0;
      candidates.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (getComputedStyle(el).borderRadius === "6px" && r.width > 0 && r.height > 0) faceCount++;
      });
      return {
        overlayFound: true,
        overlayWidth: overlayRect.width,
        sourceWidth: sourceRect.width,
        faceCount: faceCount,
        selectionText: panel100FindSelectionText(),
      };
    })()`,
  );

  if (!midReading.overlayFound) {
    violations.push(
      `single-card-unchanged: DragOverlay node for MSD-A unexpectedly absent mid-flight (assertDragActivated should have caught this)`,
    );
  } else {
    if (midReading.faceCount !== 1) {
      violations.push(
        `single-card-unchanged: overlay face count expected 1, measured ${midReading.faceCount}`,
      );
    }
    if (Math.abs(midReading.overlayWidth - midReading.sourceWidth) > 1) {
      violations.push(
        `single-card-unchanged: overlay width expected within 1px of source card width ${midReading.sourceWidth}, measured ${midReading.overlayWidth}`,
      );
    }
  }
  if (midReading.selectionText != null) {
    violations.push(
      `single-card-unchanged: unexpected "${midReading.selectionText}" selection text present mid-drag`,
    );
  }

  await endDrag(cdp, sessionId, point);

  const finalA = await pollUntilColumn(
    cdp,
    sessionId,
    MSD_A_IDENTIFIER,
    "done",
    RENDER_TIMEOUT_MS,
  );
  if (finalA !== "done") {
    violations.push(
      `single-card-unchanged: MSD-A expected column "done", measured ${JSON.stringify(finalA)}`,
    );
  }
  for (const id of [MSD_B_IDENTIFIER, MSD_C_IDENTIFIER, MSD_D_IDENTIFIER]) {
    const col = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
    );
    if (col !== "todo") {
      violations.push(
        `single-card-unchanged: ${id} expected column "todo", measured ${JSON.stringify(col)}`,
      );
    }
  }

  const postText = await evalValue(
    cdp,
    sessionId,
    `${FIND_SELECTION_TEXT_SRC}panel100FindSelectionText()`,
  );
  if (postText != null) {
    violations.push(
      `single-card-unchanged: unexpected "${postText}" selection text present after the drag ended`,
    );
  }
}

/** DRAG-05 baseline: dragging a single, unselected card moves exactly that card, no selection
 * text ever appears, and the overlay stays byte-for-byte today's single-card shape (one face, the
 * source card's own width). */
async function checkSingleCardUnchanged(cdp, sessionId, violations) {
  await performSingleCardDragCheck(cdp, sessionId, violations, null);
}

/**
 * Shared body for `keyboard-unchanged`: resizes to the carousel breakpoint, opens MSD-B's "Move
 * to..." picker, clicks its "Done" entry, and asserts MSD-B alone changed column. Snapshots
 * MSD-A/C/D's columns BEFORE acting and compares against those exact values afterward (rather than
 * assuming they start in `todo`), so this check stays correct regardless of whether
 * `single-card-unchanged` already moved MSD-A to `done` earlier in the same run. `preClickHook`,
 * when provided, runs after the picker group is confirmed open and BEFORE the "Done" entry is
 * clicked, letting `runBreakKeyboardUnchanged` detach that entry first.
 */
async function performKeyboardCheckBody(
  cdp,
  sessionId,
  violations,
  preClickHook,
) {
  const before = {};
  for (const id of [MSD_A_IDENTIFIER, MSD_C_IDENTIFIER, MSD_D_IDENTIFIER]) {
    before[id] = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
    );
  }

  await waitForMoveToButton(cdp, sessionId, MSD_B_IDENTIFIER);
  await clickMoveToButton(cdp, sessionId, MSD_B_IDENTIFIER);
  await waitForPickerGroup(cdp, sessionId, MSD_B_IDENTIFIER);

  if (preClickHook) await preClickHook(cdp, sessionId);

  await clickPickerColumn(cdp, sessionId, MSD_B_IDENTIFIER, "Done");

  const finalB = await pollUntilColumn(
    cdp,
    sessionId,
    MSD_B_IDENTIFIER,
    "done",
    RENDER_TIMEOUT_MS,
  );
  if (finalB !== "done") {
    violations.push(
      `keyboard-unchanged: MSD-B expected column "done", measured ${JSON.stringify(finalB)}`,
    );
  }
  for (const id of [MSD_A_IDENTIFIER, MSD_C_IDENTIFIER, MSD_D_IDENTIFIER]) {
    const col = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
    );
    if (col !== before[id]) {
      violations.push(
        `keyboard-unchanged: ${id} expected column ${JSON.stringify(before[id])} (unmoved), measured ${JSON.stringify(col)}`,
      );
    }
  }
}

/** DRAG-05 baseline: the carousel "Move to..." keyboard-accessible path moves exactly the one
 * card it targets, leaving every other card's column untouched. Restores the 1600x1000 viewport
 * in a `finally` so no later check in the same run ever inherits the narrow carousel layout. */
async function checkKeyboardUnchanged(cdp, sessionId, violations) {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  try {
    await performKeyboardCheckBody(cdp, sessionId, violations, null);
  } finally {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
  }
}

const CHECKS = {
  "single-card-unchanged": checkSingleCardUnchanged,
  "keyboard-unchanged": checkKeyboardUnchanged,
};

// ---------------------------------------------------------------------------
// Breaks. Neither break edits a file under src/: both mutate the live DOM
// mid-flow, in a way `Board.tsx`'s own unchanged code cannot recover from,
// proving the check reports a wrong MEASURED value rather than degrading to
// an opaque "not found"/exception. Both drive the SAME check body the real
// run uses, restore the captured original state, and re-confirm PASS.
// ---------------------------------------------------------------------------

/**
 * `single-card-unchanged` break: BEFORE the drag starts (mousedown never yet dispatched), removes
 * the `done` column's droppable container node, the exact element `useDroppable({ id: "done" })`
 * attaches its ref to (`Column.tsx:252-256`). A same-size PLACEHOLDER div is inserted in its place
 * first, so removing the real node causes NO layout reflow of the sibling columns and the
 * already-captured drop point stays geometrically valid, landing on inert placeholder space, never
 * on a neighbouring column that shifted into the gap.
 *
 * TIMING IS LOAD-BEARING, proven by this file's own instrumented diagnostic run: dnd-kit caches
 * each droppable's rect at `handleDragStart` (drag activation) and does not re-measure a node
 * removed AFTER that point, so removing `done` MID-DRAG (the first shape this break was written
 * against) leaves the STALE pre-removal rect live for collision purposes, the drop SILENTLY
 * SUCCEEDS server-side, and the resulting React commit into the now-detached `done` subtree leaves
 * the whole page visibly stuck (`DragOverlay` never clears, `MSD-A` vanishes from every attached
 * column). Removing `done` BEFORE the drag starts means dnd-kit's very first measurement reads a
 * detached node's `getBoundingClientRect()`, which browsers return as an all-zero rect, so no drop
 * point can ever intersect it and `over` correctly resolves to nothing.
 *
 * React never reconciles this raw DOM surgery (it only observes state changes), so its own
 * `droppableContainers` map keeps a stale reference to the now-detached `done` node throughout.
 * The restore leg reinserts the CAPTURED node itself (never a recreated lookalike, the Dead
 * Instrument #8 discipline) and discards the placeholder.
 */
async function runBreakSingleCardUnchanged(cdp, sessionId) {
  console.log(
    "\n--break single-card-unchanged: removing the done column's droppable container node before the drag starts (placeholder holds its layout space)",
  );
  const tripViolations = [];
  const preDragHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var col = document.querySelector('[data-column="done"]');
        if (!col) throw new Error("panel100 break: done column node not found");
        var rect = col.getBoundingClientRect();
        var computedFlex = getComputedStyle(col).flex;
        var placeholder = document.createElement("div");
        placeholder.setAttribute("data-panel100-break-placeholder", "true");
        placeholder.style.cssText = "flex: " + computedFlex + "; width: " + rect.width + "px; min-width: " + rect.width + "px;";
        col.parentNode.insertBefore(placeholder, col);
        window.__panel100BreakDoneNode = col;
        window.__panel100BreakDoneParent = col.parentNode;
        window.__panel100BreakPlaceholder = placeholder;
        col.remove();
        return true;
      })()`,
    );
  };
  await performSingleCardDragCheck(cdp, sessionId, tripViolations, preDragHook);
  console.log(
    `--break single-card-unchanged TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) =>
      v.indexOf('MSD-A expected column "done"') !== -1 &&
      v.indexOf("not found") === -1,
  );

  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var node = window.__panel100BreakDoneNode;
      var placeholder = window.__panel100BreakPlaceholder;
      if (!node || !placeholder) throw new Error("panel100 break: restore state missing for done column");
      placeholder.parentNode.insertBefore(node, placeholder);
      placeholder.remove();
      delete window.__panel100BreakDoneNode;
      delete window.__panel100BreakDoneParent;
      delete window.__panel100BreakPlaceholder;
      return true;
    })()`,
  );
  const restoreViolations = [];
  await performSingleCardDragCheck(cdp, sessionId, restoreViolations, null);
  console.log(
    `--break single-card-unchanged RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/**
 * `keyboard-unchanged` break: once MSD-B's `MoveToPicker` group is open, stashes and detaches its
 * "Done" entry button before `clickPickerColumn` runs. `clickPickerColumn` finds no matching
 * button and returns `false` without throwing, so `performKeyboardCheckBody` falls through to its
 * own column-poll, which observes MSD-B still in its pre-click column, exactly the "wrong measured
 * column, not not found" trip this break is required to produce. The restore leg reinserts the
 * CAPTURED button node itself while the picker (still open at the 900px breakpoint) has not yet
 * unmounted, then a fresh `checkKeyboardUnchanged` run re-opens the picker and re-confirms PASS.
 */
async function runBreakKeyboardUnchanged(cdp, sessionId) {
  console.log(
    "\n--break keyboard-unchanged: detaching the Done entry from MSD-B's MoveToPicker portal before the click",
  );
  const tripViolations = [];
  let restoreOutcome = "not-run";
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  try {
    const preClickHook = async (cdpArg, sessionIdArg) => {
      await evalValue(
        cdpArg,
        sessionIdArg,
        `(function () {
          var group = document.querySelector('[role="group"][aria-label="Move MSD-B to"]');
          if (!group) throw new Error("panel100 break: MoveToPicker group not found for MSD-B");
          var buttons = Array.prototype.slice.call(group.querySelectorAll("button"));
          var btn = buttons.find(function (b) { return (b.textContent || "").trim() === "Done"; });
          if (!btn) throw new Error("panel100 break: Done entry not found in MoveToPicker for MSD-B");
          window.__panel100BreakDoneBtn = btn;
          window.__panel100BreakDoneBtnParent = btn.parentNode;
          window.__panel100BreakDoneBtnNext = btn.nextSibling;
          btn.remove();
          return true;
        })()`,
      );
    };
    await performKeyboardCheckBody(
      cdp,
      sessionId,
      tripViolations,
      preClickHook,
    );
    console.log(
      `--break keyboard-unchanged TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
    );

    restoreOutcome = await evalValue(
      cdp,
      sessionId,
      `(function () {
        var btn = window.__panel100BreakDoneBtn;
        var parent = window.__panel100BreakDoneBtnParent;
        if (!btn || !parent || !document.contains(parent)) {
          delete window.__panel100BreakDoneBtn;
          delete window.__panel100BreakDoneBtnParent;
          delete window.__panel100BreakDoneBtnNext;
          return "parent-gone";
        }
        parent.insertBefore(btn, window.__panel100BreakDoneBtnNext || null);
        delete window.__panel100BreakDoneBtn;
        delete window.__panel100BreakDoneBtnParent;
        delete window.__panel100BreakDoneBtnNext;
        return "restored";
      })()`,
    );
  } finally {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
  }

  const tripFired = tripViolations.some(
    (v) =>
      v.indexOf('MSD-B expected column "done"') !== -1 &&
      v.indexOf("not found") === -1,
  );

  const restoreViolations = [];
  await checkKeyboardUnchanged(cdp, sessionId, restoreViolations);
  console.log(
    `--break keyboard-unchanged RESTORE leg (restoreOutcome=${restoreOutcome}): ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

const BREAKS = {
  "single-card-unchanged": runBreakSingleCardUnchanged,
  "keyboard-unchanged": runBreakKeyboardUnchanged,
};

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
    await cdp.send("Console.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );

    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.consoleAPICalled") {
        console.error(
          `DEBUG console.${msg.params.type}: ${JSON.stringify(msg.params.args)}`,
        );
      }
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
