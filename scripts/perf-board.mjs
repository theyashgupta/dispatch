/**
 * Board-at-scale measurement harness (SCALE-05, dev/ops tooling, NOT test code): imports no test
 * framework, asserts nothing about app runtime behavior, and lives outside src/ — the same
 * category as check-invariants.mjs, perf-rerender.mjs, perf-sse.mjs, and perf-cleanup.mjs.
 *
 * It answers the one question Phase 82 needs a before/after number for: does the board pay a cost
 * proportional to total card count? Three numbers, each isolating one leg of that cost:
 *   - initial `/api/board` payload bytes and card count (the full-snapshot REST fallback)
 *   - one SSE frame's byte size following a single card mutation (the broadcast leg)
 *   - React commits caused by that same single mutation, via the same raw-CDP DevTools-hook
 *     technique perf-rerender.mjs already proved (headless Chrome, zero new npm dependency)
 *
 * SANDBOX SAFETY (non-negotiable, enforced by assertSandboxSafe before any fs/spawn call): this
 * harness seeds and boots a throwaway server. It never touches the real `~/.dispatch` directory
 * or `board.db`, never reads the real `~/.dispatch/config.json` and never sees the real Linear API
 * key (cards are seeded directly via node:sqlite, not synced) — the sandbox config carries only a
 * HARDCODED, OBVIOUSLY-FAKE placeholder string in `sources.linear.apiKey`, needed only to clear the
 * web app's client-side "needs a Linear key" first-run gate so the board actually renders for the
 * commit-count leg; Linear rejects it with a clean 401 every poll, which the poller already handles
 * as a routine sync failure (never a crash). This harness never binds the port the user's real,
 * live dispatch instance listens on. Every sandbox HOME lives under `os.tmpdir()` with a
 * `dispatch-perf-board-` basename, verified structurally, not by convention.
 *
 * `--dev` is intentionally UNSUPPORTED (a deliberate departure from perf-rerender.mjs's tsx+vite
 * fallback): vite.config.ts hardcodes its dev-mode `/api/`+`/sessions/` proxy target to the user's
 * real, live dispatch port, and this harness's sandbox-safety guarantee forbids ever binding that
 * port from a second instance. Passing `--dev` prints a clear explanation and exits 1 rather than
 * silently reusing that port or silently falling back to prod — only the production build
 * (`npm run build`) can be measured here.
 *
 * Usage:
 *   node scripts/perf-board.mjs [--done=500] [--runs=3]     measure the production build (default)
 *   node scripts/perf-board.mjs --dev                        unsupported — prints why, exits 1
 *   node scripts/perf-board.mjs [--done=500] [--runs=3] --sessions-per-card=N   (N >= 2) multi-session
 *                                                              leg — see below
 *
 * `--sessions-per-card=N` (Phase 96, KEEP-05): an ADDITIVE, off-by-default multi-session leg. When
 * ABSENT (the default, `sessionsPerCard=0`), the seed step is byte-for-byte the same code path this
 * flag's introducing commit found — every 25th card gets exactly the same flat
 * `tmuxSession`/`workspacePath` pair it always got, a structural no-op, not a widened default. When
 * present (N >= 2), those SAME every-25th cards are seeded with `N` real `sessions[]` records
 * directly (bypassing the store's own flat-card migration entirely, since a card already carrying
 * `sessions` is skipped by it) so `redactCard` emits `sessionCount`/`sessionSummaries` on them — the
 * wire cost `KEEP-05`'s multi-session leg exists to measure. The baseline leg's own command and seed
 * must stay untouched by this flag's presence in argv; see `docs/BASELINES.md`'s Phase 96 section for
 * why the two legs are never conflated.
 *
 * Prints one stderr line per run, then a machine-parsable summary:
 *   PERF-BOARD mode=<prod|dev> done=<n> initialBytes=<n> initialCards=<n> sseFrameBytes=<n> loadCommits=<n> commits=<n>
 *   PERF-BOARD-MULTI mode=<prod|dev> done=<n> sessionsPerCard=<n> initialBytes=<n> initialCards=<n> sseFrameBytes=<n> loadCommits=<n> commits=<n>
 *     (only when --sessions-per-card=N is passed — a distinct label so this leg's numbers can never
 *     be mistaken for a baseline PERF-BOARD line when grepped out of docs/BASELINES.md)
 *
 * Exit codes: 0 success. 1 setup/teardown/build error. 2 production hook never fired (rerun is
 * pointless — --dev is unsupported, so this is a hard failure, not a retry signal).
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");

const SANDBOX_PORT = 47820;
const CDP_PORT = 9359;
const SANDBOX_PREFIX = "dispatch-perf-board-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const MUTATION_WAIT_MS = 1_000;
const CARD_RENDER_TIMEOUT_MS = 10_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const DEFAULT_DONE_COUNT = 500;
const DEFAULT_RUNS = 3;
const AWAITING_EVERY_NTH = 25;

/**
 * The one manual-move pair this harness drives, verified against
 * src/shared/column-transitions.ts's `isManualMoveAllowed`: neither direction of done<->todo is
 * blocked (blocksAgentDoneManualEntry only refuses a move INTO agent_done; blocksTodoToInProgressManualMove
 * only refuses todo -> in_progress), so this round trip is a real, server-accepted transition, not
 * a guess.
 */
const MUTATION_TARGET_COLUMN = "todo";

/** Read `--done=N` off argv, defaulting to 500 (CONTEXT's locked "realistically large" number). */
function readDoneFlag(argv) {
  const flag = argv.find((a) => a.startsWith("--done="));
  if (!flag) return DEFAULT_DONE_COUNT;
  const n = Number(flag.slice("--done=".length));
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--done must be a positive integer, got: ${flag}`);
    process.exit(1);
  }
  return n;
}

/** Read `--runs=N` off argv, defaulting to 3 (this repo's 3-run-median convention). */
function readRunsFlag(argv) {
  const flag = argv.find((a) => a.startsWith("--runs="));
  if (!flag) return DEFAULT_RUNS;
  const n = Number(flag.slice("--runs=".length));
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--runs must be a positive integer, got: ${flag}`);
    process.exit(1);
  }
  return n;
}

function readDevFlag(argv) {
  return argv.includes("--dev");
}

/**
 * Read `--sessions-per-card=N` off argv, defaulting to 0 (off — the baseline leg's structural
 * no-op). N must be >= 2 when present: the whole point of the multi-session leg is exercising
 * `redactCard`'s `hasMultipleSessions` (>= 2) branch, so `sessionCount`/`sessionSummaries` actually
 * appear on the wire; N=1 would silently measure nothing new.
 */
function readSessionsPerCardFlag(argv) {
  const flag = argv.find((a) => a.startsWith("--sessions-per-card="));
  if (!flag) return 0;
  const n = Number(flag.slice("--sessions-per-card=".length));
  if (!Number.isInteger(n) || n < 2) {
    console.error(
      `--sessions-per-card must be an integer >= 2 (redactCard's sessionCount/sessionSummaries ` +
        `only appear at >= 2 sessions), got: ${flag}`,
    );
    process.exit(1);
  }
  return n;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The structural guarantee behind "never touches the user's real board.db or port 4700": called
 * before any filesystem write or child-process spawn touching `home`. Throws (never silently
 * degrades) if any check fails.
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

/**
 * Sandbox HOME whose config carries only this hardcoded, obviously-fake placeholder — never the
 * real `~/.dispatch/config.json`'s key, never read from it, never derived from it. `GET /setup`
 * gates the whole web app behind a first-run "needs a Linear key" screen whenever
 * `linearApiKey` is absent (`setup.route.ts`), which would make the Done column (and therefore the
 * commit-count leg) unreachable; a fake key clears that gate. Linear itself rejects it with a
 * clean 401 every poll — `poller.ts` already treats that as a routine, non-fatal sync failure.
 */
const FAKE_LINEAR_API_KEY = "perf-board-harness-fake-key-never-real";

/**
 * Sandbox HOME seeded with `FAKE_LINEAR_API_KEY` (see above) — this harness seeds Done cards
 * directly via node:sqlite, so it never reads the real `~/.dispatch/config.json` and never needs,
 * touches, or transmits a real Linear key.
 */
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

/** The DevTools-global-hook shim: every commit anywhere in the tree increments `commits`. */
const HOOK_SHIM_SOURCE = `
window.__DSP_RENDER_COUNTS__ = { commits: 0 };
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true,
  renderers: new Map(),
  inject(renderer) {
    this.renderers.set(this.renderers.size + 1, renderer);
    return this.renderers.size;
  },
  onCommitFiberRoot() { window.__DSP_RENDER_COUNTS__.commits++; },
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  checkDCE() {},
  sub() { return function unsubscribe() {}; },
  on() {},
  off() {},
  emit() {},
};
`;

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

function getCommits(cdp, sessionId) {
  return evalValue(cdp, sessionId, "window.__DSP_RENDER_COUNTS__.commits");
}

/**
 * Poll the Done column's count-badge text (no stable `data-card-id`/similar attribute exists on
 * `Card`/`CardView` — grep-verified) until it reads `expectedCount`, proving every seeded card
 * reached the wire AND rendered, not merely that the column mounted.
 */
async function waitForDoneBadge(cdp, sessionId, expectedCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const expected = String(expectedCount);
  while (Date.now() < deadline) {
    const text = await evalValue(
      cdp,
      sessionId,
      `(function(){
        var col = document.querySelector('[data-column="done"]');
        if (!col) return null;
        var spans = col.querySelectorAll('span');
        return spans.length > 1 ? spans[1].textContent : null;
      })()`,
    );
    if (text === expected) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Done column badge never reached "${expected}" within ${timeoutMs}ms`,
  );
}

/**
 * Boot the harness's own server against `home`. `--dev` is refused here (see the file header) —
 * this function only ever spawns the production build, never the tsx/vite fallback.
 */
function bootServer(home, dev) {
  if (dev) {
    console.error(
      "perf-board.mjs does not support --dev: the dev-mode frontend proxy target is hardcoded " +
        "in vite.config.ts to the user's real, live dispatch port, and this harness's " +
        "sandbox-safety guarantee forbids ever binding that port from a second instance. Only " +
        "the production build can be measured by this script — run `npm run build` and rerun " +
        "without --dev.",
    );
    process.exit(1);
  }
  if (!existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
    process.exit(1);
  }
  return spawn("node", [DIST_ENTRY], {
    env: { ...process.env, HOME: home, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

/**
 * Build `n` real `Session`-shaped records for card `i`'s multi-session leg — bypassing the store's
 * own flat-card migration entirely (a card already carrying `sessions` is skipped by
 * `migrateCardsToSessionEntity`), so this is the only way to get `redactCard` to see `>= 2`
 * sessions on one card. Mirrors the field shape (and rough string lengths) the flat-field branch
 * below would have produced for a single session, so the multi-session leg's byte growth is
 * attributable to `sessionCount`/`sessionSummaries` and per-session field duplication, not to an
 * unrelated shape change in this harness's own synthetic data.
 */
function buildSyntheticSessions(home, i, n) {
  const sessions = [];
  for (let s = 0; s < n; s++) {
    const createdAt = new Date(
      Date.now() - (i * 60_000 + s * 1_000),
    ).toISOString();
    sessions.push({
      id: `perf-session-${i}-${s}`,
      createdAt,
      updatedAt: createdAt,
      tmuxSession: `dsp-PERF-${i}-${s}`,
      workspacePath: join(home, "workspaces", `PERF-${i}`, `session-${s}`),
    });
  }
  return sessions;
}

/**
 * TWO-BOOT seeding: boot once so the store's own `board-db.ts` creates the real schema (WAL mode,
 * every table/index), kill it, then insert `count` Done cards directly via node:sqlite. This
 * avoids a second, hand-duplicated schema that could drift from the store's own.
 * @param {number} sessionsPerCard Phase 96 KEEP-05 multi-session leg (default 0 — off). ABSENT
 * (0/1) leaves this function's every-25th-card seed step byte-for-byte identical to before this
 * flag existed — a structural no-op, not a widened default (see file header). Present (>= 2)
 * additively swaps that same every-25th card's flat `tmuxSession`/`workspacePath` pair for `N` real
 * `sessions[]` records, so `redactCard` emits `sessionCount`/`sessionSummaries` for them.
 */
async function seedDoneCards(home, count, sessionsPerCard = 0) {
  const warmup = bootServer(home, false);
  try {
    await waitForReady(SANDBOX_PORT);
  } finally {
    await killAndWait(warmup);
  }

  const dbPath = join(home, ".dispatch", "board.db");
  const db = new DatabaseSync(dbPath);
  try {
    const insert = db.prepare(
      `INSERT INTO cards (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    );
    db.exec("BEGIN");
    for (let i = 0; i < count; i++) {
      const id = `perf-${i}`;
      const updatedAt = new Date(Date.now() - i * 60_000).toISOString();
      const card = {
        id,
        issueId: `perf-issue-${i}`,
        identifier: `PERF-${i}`,
        title: `Seeded done ticket ${i} for the board-at-scale harness`,
        description: null,
        priority: 3,
        column: "done",
        updatedAt,
      };
      if (i % AWAITING_EVERY_NTH === 0) {
        if (sessionsPerCard >= 2) {
          const sessions = buildSyntheticSessions(home, i, sessionsPerCard);
          card.sessions = sessions;
          card.activeSessionId = sessions[0].id;
          // Faithful to the real product's `setActiveSession` chokepoint (board.store.ts:606),
          // which mirrors the active session's fields onto the card's own flat fields — the exact
          // mechanism Task 1's finding identified as riding the wire ALONGSIDE `activeSession`.
          // Seeding sessions[] alone (skipping this mirror) would understate the real byte cost.
          card.tmuxSession = sessions[0].tmuxSession;
          card.workspacePath = sessions[0].workspacePath;
        } else {
          card.tmuxSession = `dsp-PERF-${i}`;
          card.workspacePath = join(home, "workspaces", `PERF-${i}`);
        }
      }
      insert.run(id, JSON.stringify(card));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

/** `GET /api/board`'s raw byte size and card count — the full-snapshot REST fallback leg. */
async function measureInitialBytes(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/board`);
  const body = await res.text();
  const snapshot = JSON.parse(body);
  return {
    initialBytes: Buffer.byteLength(body, "utf8"),
    initialCards: snapshot.cards.length,
  };
}

async function moveCard(port, id, column) {
  const res = await fetch(`http://127.0.0.1:${port}/api/cards/${id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column }),
  });
  if (res.status !== 204) {
    const body = await res.text();
    throw new Error(`move ${id} -> ${column} failed (${res.status}): ${body}`);
  }
  await res.body?.cancel();
}

/**
 * Wrap one SSE connection's readable body: `nextBoardFrame()` resolves on the next UNNAMED
 * `data:` frame, skipping every NAMED frame (`event: tunnel`/`event: ping`/`event: activity`) —
 * matching perf-sse.mjs's exact frame-boundary/skip logic.
 */
function makeFrameReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  return {
    async nextBoardFrame() {
      for (;;) {
        const boundary = buf.indexOf("\n\n");
        if (boundary !== -1) {
          const raw = buf.slice(0, boundary);
          buf = buf.slice(boundary + 2);
          if (raw.startsWith("data:")) return raw;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE stream closed unexpectedly");
        buf += decoder.decode(value, { stream: true });
      }
    },
    async close() {
      await reader.cancel().catch(() => {});
    },
  };
}

/**
 * One SSE frame's byte size following exactly one mutation on `perf-0` (done -> todo, then
 * restored to `done` so the run is idempotent). The resync frame sent on connect is discarded
 * before the mutation is driven, so only the broadcast frame counts.
 */
async function measureSseFrameBytes(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/stream`);
  const reader = makeFrameReader(res);
  try {
    await reader.nextBoardFrame();
    await moveCard(port, "perf-0", MUTATION_TARGET_COLUMN);
    const mutationFrame = await reader.nextBoardFrame();
    await moveCard(port, "perf-0", "done");
    return Buffer.byteLength(`${mutationFrame}\n\n`, "utf8");
  } finally {
    await reader.close();
  }
}

/**
 * React commits caused by exactly one mutation, measured via the same raw-CDP DevTools-hook
 * technique perf-rerender.mjs proved: snapshot the counter, drive one `perf-0` done<->todo round
 * trip over HTTP, wait a fixed settle window, and report the raw delta.
 * @remarks Deliberately NOT noise-adjusted against `SyncStrip`'s own 1s-interval tick
 * (`docs/BASELINES.md`'s `## Board re-renders` "Spread note"): an empirical dry run of a
 * scaled-subtraction design (2000ms idle sample scaled down to the 1000ms mutation window) proved
 * unreliable — it occasionally rounded a real, non-zero mutation cost down to 0, which is a worse
 * measurement than the small, already-documented tick noise it was trying to remove. `commits`
 * is therefore the same raw, occasionally-±1-noisy number perf-rerender.mjs itself reports, with
 * the same caveat: both sides of any future before/after comparison are subject to the identical
 * tick noise, so it is not a bias in either direction.
 * @returns `null` (after setting `process.exitCode = 2`) if the production hook never registered —
 * the caller must stop the whole run, never retry with `--dev` (unsupported, see file header).
 */
async function measureCommits(port, cdp, sessionId, doneCount) {
  await cdp.send(
    "Page.navigate",
    { url: `http://127.0.0.1:${port}/` },
    sessionId,
  );
  await waitForDoneBadge(cdp, sessionId, doneCount, CARD_RENDER_TIMEOUT_MS);

  const loadCommits = await getCommits(cdp, sessionId);
  if (loadCommits === 0) {
    console.error(
      "PERF-BOARD diagnostic: commits stayed 0 after the board visibly rendered (Done column " +
        "badge reached the seeded count) — production react-dom did not register with the " +
        "DevTools hook shim. --dev is unsupported by this harness (see the file header), so this " +
        "is a hard failure, not a retry signal.",
    );
    process.exitCode = 2;
    return null;
  }

  const beforeMutation = await getCommits(cdp, sessionId);
  await moveCard(port, "perf-0", MUTATION_TARGET_COLUMN);
  await sleep(MUTATION_WAIT_MS);
  const afterMutation = await getCommits(cdp, sessionId);
  await moveCard(port, "perf-0", "done");

  const commits = afterMutation - beforeMutation;
  return { loadCommits, commits };
}

/** The MEDIAN of `values` (not the mean — this repo's 3-run-median convention, perf-sse.mjs's formula). */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.5)];
}

/**
 * One full measured run against a FRESH sandbox: seed, boot, measure both byte legs, then drive
 * headless Chrome over raw CDP for the commit leg, tearing down the server, Chrome, and the
 * sandbox home in every case (success, thrown error, or the exit-2 hook-never-fired path).
 * @returns The five per-run metrics, or `null` if the hook-never-fired diagnostic fired (caller
 * must stop the whole run immediately — `process.exitCode` is already set to 2).
 * @param {number} sessionsPerCard Threaded straight through to {@link seedDoneCards}; 0 (default)
 * keeps this run's seed identical to before the flag existed.
 */
async function runMetrics(doneCount, runIndex, sessionsPerCard = 0) {
  const home = makeSandboxHome(`run${runIndex}`);
  const scratchDir = join(
    tmpdir(),
    `${SANDBOX_PREFIX}chrome-${runIndex}-${process.pid}`,
  );
  mkdirSync(scratchDir, { recursive: true });

  let server = null;
  let chromeChild = null;
  let cdp = null;

  try {
    await seedDoneCards(home, doneCount, sessionsPerCard);
    server = bootServer(home, false);
    await waitForReady(SANDBOX_PORT);

    const { initialBytes, initialCards } =
      await measureInitialBytes(SANDBOX_PORT);
    const sseFrameBytes = await measureSseFrameBytes(SANDBOX_PORT);

    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${scratchDir}`,
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
      if (!up) {
        throw new Error(`Chrome debugging port :${CDP_PORT} did not come up`);
      }
    }

    cdp = await connectCDP();
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: HOOK_SHIM_SOURCE },
      sessionId,
    );

    const commitResult = await measureCommits(
      SANDBOX_PORT,
      cdp,
      sessionId,
      doneCount,
    );
    if (commitResult === null) return null;

    console.error(
      `run=${runIndex} initialBytes=${initialBytes} initialCards=${initialCards} ` +
        `sseFrameBytes=${sseFrameBytes} loadCommits=${commitResult.loadCommits} ` +
        `commits=${commitResult.commits}`,
    );
    return {
      initialBytes,
      initialCards,
      sseFrameBytes,
      loadCommits: commitResult.loadCommits,
      commits: commitResult.commits,
    };
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    await killAndWait(server);
    rmSync(home, { recursive: true, force: true });
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

/** Warn (never throw) if either port this harness owns is still held after every run tore down. */
async function warnIfPortsHeld() {
  try {
    const args = [String(SANDBOX_PORT), String(CDP_PORT)].flatMap((p) => [
      "-i",
      `:${p}`,
    ]);
    const { stdout } = await execFileP("lsof", args).catch((err) => ({
      stdout: err.stdout ?? "",
    }));
    if (stdout.trim() !== "") {
      console.error(`WARNING: ports still held after teardown:\n${stdout}`);
    }
  } catch {
    // lsof not available or no matches — nothing to report
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dev = readDevFlag(argv);
  if (dev) {
    bootServer(null, true);
    return;
  }

  const doneCount = readDoneFlag(argv);
  const runs = readRunsFlag(argv);
  const sessionsPerCard = readSessionsPerCardFlag(argv);

  const initialBytesArr = [];
  const initialCardsArr = [];
  const sseFrameBytesArr = [];
  const loadCommitsArr = [];
  const commitsArr = [];

  try {
    for (let i = 1; i <= runs; i++) {
      const result = await runMetrics(doneCount, i, sessionsPerCard);
      if (result === null) return;
      initialBytesArr.push(result.initialBytes);
      initialCardsArr.push(result.initialCards);
      sseFrameBytesArr.push(result.sseFrameBytes);
      loadCommitsArr.push(result.loadCommits);
      commitsArr.push(result.commits);
    }
  } finally {
    await warnIfPortsHeld();
  }

  const label = sessionsPerCard >= 2 ? "PERF-BOARD-MULTI" : "PERF-BOARD";
  const sessionsField =
    sessionsPerCard >= 2 ? `sessionsPerCard=${sessionsPerCard} ` : "";
  console.error(
    `${label} mode=prod done=${doneCount} ${sessionsField}initialBytes=${median(initialBytesArr)} ` +
      `initialCards=${median(initialCardsArr)} sseFrameBytes=${median(sseFrameBytesArr)} ` +
      `loadCommits=${median(loadCommitsArr)} commits=${median(commitsArr)}`,
  );
}

main().catch((err) => {
  console.error(`perf-board failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
