/**
 * Phase 99 plan 04 UI measurement instrument (PORT-02, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92..98.mjs. It
 * reads computed DOM out of a real headless Chrome against a real sandboxed dispatch server seeded
 * with three fixture cards, proving the browser actually renders the ROADMAP claim "hovering the
 * badge or opening the panel shows the attribution evidence": the badge's `title` carries the
 * attribution string, the panel's preview row carries the same pid/source/bindAddress readout, and
 * a walk-vs-cwd disagreement renders a separately coloured `cwd mismatch` segment.
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-98.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on :4700, before this script boots any server or spawns any real process, and
 * there is no override flag.
 *
 * NO REAL TMUX, NO REAL TTYD, NO REAL SAGA. Every verdict measures DOM shape produced from a wire
 * payload the fixtures seed directly via `node:sqlite` (the panel-93..98.mjs idiom); none of the
 * three fixture cards ever needs a live terminal, and none carries a `tmuxSession`, matching
 * `panel-98.mjs`'s own `buildSoloCard`/`buildMultiCard` precedent. A card WITH a `tmuxSession` but
 * no `sessions` record is yielded by `board.store.ts`'s `sessionsWithTmux()` as a SYNTHETIC pair;
 * `reconcileSessions()` at boot cannot find that name in a real `tmux list-sessions`, calls
 * `markSessionLost`, and that method's derived-full-loss branch sets `card.previews = undefined`
 * (`board.store.ts`, the same clear `card.prs`/`card.prsUnknown`/`card.previewsUnknown` take), which
 * would erase this file's own seeded evidence before the board ever paints. Confirmed by an
 * instrumented run: seeding an inert `tmuxSession` reproduces exactly that wipe, so every fixture
 * below omits the field entirely. Source-read of `DetailPanel.tsx`/`PanelHeader.tsx` separately
 * confirms the preview-evidence block that hosts `PreviewRow` is NOT nested inside the "Details"
 * disclosure's `detailsExpanded` gate at all: it renders unconditionally whenever `card.previews`
 * is non-empty, independent of the `tmuxSession` question above. `expandDetailsIfPresent()` below
 * is kept as a defensive no-op for parity with `panel-98.mjs`'s own detail-opening convention; on
 * this file's tmuxSession-free fixture shape the "Details" button never renders at all (it requires
 * `hasLiveSession`), so the call always resolves to "absent" and never blocks a read. A stub
 * `claude` binary is still planted on PATH as defense in depth, branching on `--version` per the
 * boot-hang trap panel-94..98.mjs already document (`checkHooksCapability()` probes it,
 * untimeouted, before the server ever listens).
 *
 * TRAP 1, THE BLIND-GEOMETRY TRAP (Phase 92's third dead instrument). A `display:none` or absent
 * node reads a false 0px/0-count and a geometry/count-only check would call that "correct" instead
 * of "the wrong node entirely." The colour assertion below pairs a resolved-colour read with an
 * independent structural existence assertion (the mismatch span's presence) on the same node.
 *
 * TRAP 3 (v2.9's dead instrument #9), A SELECTOR MUST NEVER KEY ON THE PROPERTY IT IS ABOUT TO
 * MUTATE. Every element lookup in this file finds its target by rendered leaf text or DOM
 * structure, never by an `aria-label` prefix attribute selector, since this phase deliberately
 * keeps the badge's `aria-label` evidence-free (`99-UI-SPEC.md`): a prefix-attribute locator on
 * that name would report "badge not found" the moment a regression puts the evidence into the
 * wrong attribute, when the real defect is a wrong `title`. This file's own acceptance criterion
 * requires zero such prefix-attribute selectors anywhere below, checked by grepping this file for
 * the two-character caret-equals sequence immediately after that attribute name.
 *
 * DEAD INSTRUMENT #8's LESSON, applied to every break's restore leg: a removed DOM node is restored
 * by reinserting the CAPTURED node object itself (stashed on `window` across the two `Runtime.
 * evaluate` calls, which share one JS realm), never by re-creating a lookalike node from scratch.
 *
 * macOS TRAP, load-bearing here too: `dist`'s `main()` guard compares `import.meta.url` against an
 * UNRESOLVED `process.argv[1]`; `realpathSync(entry)` before spawn fixes it (see `bootServerAt`).
 *
 * Usage:
 *   node scripts/panel-99.mjs                       both checks below, exits non-zero on any
 *                                                     violation.
 *   node scripts/panel-99.mjs --check <name>         one named check only, <name> one of
 *                                                     evidence-hover | evidence-panel.
 *   node scripts/panel-99.mjs --break <name>         that check's OWN break: fires the SAME check
 *                                                     function the real run uses against a DOM
 *                                                     mutation, confirms it reports the violation
 *                                                     by name, restores the captured original
 *                                                     value, and re-confirms PASS, all inside one
 *                                                     Chrome tab. Never edits a source file. <name>
 *                                                     one of evidence-hover |
 *                                                     evidence-hover-wrong-subject | evidence-panel.
 *
 * BREAK EVIDENCE for each `--break <name>` leg is recorded in this header once that leg's own
 * code lands (this file's own plan places every break in Task 3).
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

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair in this repo (panel-98 and
 * gh-reliability-98 each own their own fixed pair, neither of which this file's constants equal). */
const SANDBOX_PORT = 47874;
const CDP_PORT = 9376;
const SANDBOX_PREFIX = "dispatch-panel-99-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RENDER_TIMEOUT_MS = 15_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-99-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-99-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-99-LIVE"))
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
      "echo 'panel-99 stub claude, deliberately never ready'\n" +
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
// Fixtures, three cards, each carrying exactly one seeded `PreviewInfo` with
// hand-written `evidence`, per the interfaces `99-04-PLAN.md` locks:
//   PORT-CWD  - evidence.source "cwd", a resolved matchedCwd, no mismatch
//   PORT-WALK - evidence.source "pane ancestry", no matchedCwd, no mismatch
//   PORT-MISS - evidence.source "pane ancestry", bindAddress "*", cwdMismatch: true
// ---------------------------------------------------------------------------

const CWD_ID = "panel99-cwd";
const CWD_IDENTIFIER = "PORT-CWD";
const CWD_PORT = 41001;
const WALK_ID = "panel99-walk";
const WALK_IDENTIFIER = "PORT-WALK";
const WALK_PORT = 41002;
const MISS_ID = "panel99-miss";
const MISS_IDENTIFIER = "PORT-MISS";
const MISS_PORT = 41003;

const TOP_LEVEL_IDENTIFIERS = [CWD_IDENTIFIER, WALK_IDENTIFIER, MISS_IDENTIFIER];

/** The three fixtures this file measures, `evidence` shapes locked by `99-04-PLAN.md`'s own
 * <interfaces> block; `hasMismatch` drives which checks expect the `cwd mismatch` segment. */
const FIXTURES = [
  {
    id: CWD_ID,
    identifier: CWD_IDENTIFIER,
    port: CWD_PORT,
    evidence: {
      pid: 40101,
      source: "cwd",
      matchedCwd: "api",
      bindAddress: "127.0.0.1",
    },
    hasMismatch: false,
  },
  {
    id: WALK_ID,
    identifier: WALK_IDENTIFIER,
    port: WALK_PORT,
    evidence: {
      pid: 40202,
      source: "pane ancestry",
      bindAddress: "::1",
    },
    hasMismatch: false,
  },
  {
    id: MISS_ID,
    identifier: MISS_IDENTIFIER,
    port: MISS_PORT,
    evidence: {
      pid: 40303,
      source: "pane ancestry",
      bindAddress: "*",
      cwdMismatch: true,
    },
    hasMismatch: true,
  },
];

/**
 * Reimplements `previewBadgeTitle`'s contract independently of
 * `src/web/features/badges/preview-evidence.ts`, the module under test, so the check does not
 * become tautological against its own subject. Mirrors the locked `99-UI-SPEC.md` copy contract,
 * the same "harness computes independently" idiom `panel-98.mjs`'s `dedupeByUrl` established.
 */
function panel99ExpectedBadgeTitle(evidence, port) {
  if (evidence == null) return `Open preview, localhost:${port}`;
  const base =
    evidence.source === "cwd"
      ? evidence.matchedCwd != null
        ? `Detected via cwd match (${evidence.matchedCwd}), pid ${evidence.pid}, bound ${evidence.bindAddress}`
        : `Detected via cwd match, pid ${evidence.pid}, bound ${evidence.bindAddress}`
      : `Detected via pane ancestry, pid ${evidence.pid}, bound ${evidence.bindAddress}`;
  return evidence.cwdMismatch === true
    ? `${base}; cwd points elsewhere, verify`
    : base;
}

/** Independent reimplementation of `previewEvidenceLine`'s contract, same rationale as
 * `panel99ExpectedBadgeTitle` above. */
function panel99ExpectedEvidenceLine(evidence) {
  return evidence.source === "cwd"
    ? evidence.matchedCwd != null
      ? `pid ${evidence.pid} · cwd ${evidence.matchedCwd} · ${evidence.bindAddress}`
      : `pid ${evidence.pid} · cwd match · ${evidence.bindAddress}`
    : `pid ${evidence.pid} · pane ancestry · ${evidence.bindAddress}`;
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

/** One fixture card per `FIXTURES` entry, `in_progress` and carrying exactly one seeded
 * `PreviewInfo` with `evidence`. Deliberately NO `tmuxSession` (see header note: setting one
 * triggers boot reconcile's full-card-loss branch, which clears `card.previews` before the board
 * ever paints), matching `panel-98.mjs`'s own `buildSoloCard`/`buildMultiCard` precedent. */
function buildFixtureCard(fx) {
  return {
    ...baseCardFields(fx.id, fx.identifier, `panel-99 ${fx.identifier} fixture card`),
    previews: [
      {
        port: fx.port,
        url: `http://localhost:${fx.port}`,
        evidence: fx.evidence,
      },
    ],
  };
}

function allFixtureCards() {
  return FIXTURES.map(buildFixtureCard);
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93..98.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
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
        `PANEL-99-STALE-PORT: :${port} is already held before this run started, a prior run of ` +
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
// Navigation and DOM-lookup helpers, shared by every check and break.
// `FIND_CARD_SRC` is `panel-98.mjs`'s own card-lookup idiom, copied verbatim
// in shape: every column's `.scroll-stable-y` direct DIV children are exactly
// the rendered `<Card>` roots. Every selector below keys on rendered leaf
// text or DOM structure, never on `aria-label`/`title` (TRAP 3), since those
// two attributes are exactly what this file's checks assert and its breaks
// mutate.
// ---------------------------------------------------------------------------

const FIND_CARD_SRC = `
  function panel99FindCardRoot(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel99: board root #root not found");
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
    if (matches.length === 0) throw new Error("panel99: card " + identifier + " not found on board");
    if (matches.length > 1) throw new Error("panel99: identifier " + identifier + " matched " + matches.length + " card roots");
    return matches[0];
  }
`;

/** A preview badge is the leaf `button` inside a card whose OWN text content is exactly
 * `:${port}` (the `Globe` icon SVG contributes no text). Scoped to the card root so two fixtures
 * never collide, since every fixture below seeds a distinct port. */
const FIND_BADGE_SRC = `
  function panel99FindBadge(card, port) {
    var buttons = Array.prototype.slice.call(card.querySelectorAll("button"));
    var matches = buttons.filter(function (b) {
      return b.querySelector("button") === null && (b.textContent || "").trim() === (":" + port);
    });
    if (matches.length === 0) throw new Error("panel99: badge for port " + port + " not found");
    if (matches.length > 1) throw new Error("panel99: port " + port + " matched " + matches.length + " badges");
    return matches[0];
  }
`;

// ---------------------------------------------------------------------------
// Checks. `CHECKS` is the named-check dispatch idiom copied from
// `panel-98.mjs`'s own `CHECKS`/`--check` table. Every check pushes violation
// strings naming the check, the fixture identifier, and both the expected and
// measured value, an empty return meaning PASS.
// ---------------------------------------------------------------------------

/** PORT-02's hover-evidence leg: the badge's `title` carries the exact evidence string per
 * fixture, the `aria-label` stays the plain evidence-free form and never leaks a `pid`/`bound`/
 * `Detected via` fragment, and the mismatch fixture's title carries the "verify" suffix. */
async function checkEvidenceHover(cdp, sessionId, violations) {
  for (const fx of FIXTURES) {
    const expectedTitle = panel99ExpectedBadgeTitle(fx.evidence, fx.port);
    const expectedAriaLabel = `Open preview, localhost:${fx.port}`;
    const reading = await evalReport(
      cdp,
      sessionId,
      violations,
      `evidence-hover (${fx.identifier})`,
      `${FIND_CARD_SRC}${FIND_BADGE_SRC}(function () {
        var card = panel99FindCardRoot(${JSON.stringify(fx.identifier)});
        var badge = panel99FindBadge(card, ${fx.port});
        return {
          structurallyPresent: true,
          title: badge.getAttribute("title"),
          ariaLabel: badge.getAttribute("aria-label"),
        };
      })()`,
    );
    if (reading == null) continue;

    if (reading.title !== expectedTitle) {
      violations.push(
        `evidence-hover: ${fx.identifier} title expected ${JSON.stringify(expectedTitle)}, measured ${JSON.stringify(reading.title)}`,
      );
    }

    if (reading.ariaLabel !== expectedAriaLabel) {
      violations.push(
        `evidence-hover: ${fx.identifier} aria-label expected ${JSON.stringify(expectedAriaLabel)}, measured ${JSON.stringify(reading.ariaLabel)}`,
      );
    }
    for (const forbidden of ["pid", "bound", "Detected via"]) {
      if ((reading.ariaLabel ?? "").indexOf(forbidden) !== -1) {
        violations.push(
          `evidence-hover: ${fx.identifier} aria-label ${JSON.stringify(reading.ariaLabel)} unexpectedly contains ${JSON.stringify(forbidden)}, evidence must stay off the accessible name`,
        );
      }
    }

    if (fx.hasMismatch) {
      const suffix = "; cwd points elsewhere, verify";
      if ((reading.title ?? "").indexOf(suffix) === -1) {
        violations.push(
          `evidence-hover: ${fx.identifier} title expected to end with ${JSON.stringify(suffix)}, measured ${JSON.stringify(reading.title)}`,
        );
      }
    }
  }
}

const CHECKS = {
  "evidence-hover": checkEvidenceHover,
};

const BREAKS = {};

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
    console.log("standup: three fixture cards seeded via node:sqlite");

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
    console.log("standup: board painted, all three fixture identifiers present");

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
  console.error(`panel-99 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
