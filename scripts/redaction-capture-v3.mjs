/**
 * Wire-redaction capture harness (SESS-02/SESS-04, dev/ops tooling, NOT test code): imports no test
 * framework, asserts nothing via an assertion library, lives outside src/ — the same category as
 * check-invariants.mjs, check-doc-drift.mjs, perf-board.mjs, and migration-diff-v3.mjs. It answers
 * the question ROADMAP success criterion 5 needs answered: does a real SSE frame and a real
 * `GET /api/board` body carry zero occurrences of the persisted hook token, including inside the
 * new nested session copy — not "does redactCard's source code look right".
 *
 * SANDBOX SAFETY (non-negotiable, enforced by assertSandboxSafe before any fs/spawn call): this
 * harness seeds a throwaway board.db and boots the BUILT server once against it. It never opens,
 * migrates, or mutates the real `~/.dispatch/board.db` — every sandbox HOME lives under
 * `os.tmpdir()` with a `dispatch-redaction-capture-v3-` basename, verified structurally, and the
 * sandbox port is asserted to never be 4700 (the user's live dispatch instance) and to differ from
 * the ports migration-diff-v3.mjs (47831) and perf-board.mjs (47820) already claim, so this harness
 * can never run concurrently against the same port as a sibling instrument by accident. The real
 * board.db's mtime and size are recorded before this script does anything and again after it
 * finishes; a mismatch is a loud non-zero-exit failure, not a warning.
 *
 * The frontend dev-server proxy config is never used: it hardcodes its dev-mode `/api/`/`/sessions/`
 * targets to the user's real, live dispatch port. This harness only ever boots the production build
 * (`dist/server/bootstrap/index.js`) as a plain child process with an overridden `HOME`.
 *
 * KNOWN, ACCEPTED SIDE EFFECT (T-90-27): booting the sandbox server runs `reconcileSessions()`,
 * which sweeps `dsp-` ttyd processes MACHINE-WIDE via `adoptAndSweep` — not scoped by HOME. The
 * fixture card below is seeded on the `done` column specifically so reconcile's dead-tmux-session
 * handling never touches its session fields (a `done`/`todo` card whose claimed tmux session isn't
 * live is left completely alone by `reconcile.ts`), matching migration-diff-v3.mjs's own fixture
 * placement rationale.
 *
 * The seeded canary token value is NEVER printed by this script, to any artifact, at any point —
 * only occurrence COUNTS and a redacted marker. See T-90-25.
 *
 * Usage:
 *   node scripts/redaction-capture-v3.mjs      run the full sandbox capture + five-row verdict
 *
 * Exit codes: 0 all five verdict rows PASS. 1 setup/build/sandbox-safety error, any verdict row
 * FAIL, or the live board.db changing.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");

const SANDBOX_PORT = 47845;
const SANDBOX_PREFIX = "dispatch-redaction-capture-v3-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const SSE_FRAME_TIMEOUT_MS = 10_000;

const CARD_ID = "redact-card";
const CARD_IDENTIFIER = "REDACT-1";

/**
 * Distinctive canary value that could not occur naturally: a fixed harness prefix plus this
 * process's own pid. Never printed by this script — only its occurrence count and a redacted
 * marker ever reach stdout, per T-90-25.
 */
const CANARY_TOKEN = `dsp-redaction-canary-v3-${process.pid}`;

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
 * Sandbox HOME whose config carries only a hardcoded, obviously-fake placeholder Linear key —
 * never the real `~/.dispatch/config.json`'s key. This harness seeds the fixture card directly via
 * node:sqlite, so it never reads or needs a real key.
 */
const FAKE_LINEAR_API_KEY = "redaction-capture-v3-harness-fake-key-never-real";

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
 * Boot the harness's own server against `home`. Only ever spawns the production build — this
 * harness never boots through the frontend dev tooling (its dev proxy hardcodes its targets to the
 * user's live port).
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

/**
 * The single fixture card seeded as an OLD-shaped row (no `sessions`/`activeSessionId` keys), all
 * six session fields present, `hookToken` set to {@link CANARY_TOKEN}. Seeded on the `done` column
 * for the same reconcile-avoidance reason migration-diff-v3.mjs's `mig-full`/`mig-group` fixtures
 * are (see file header).
 */
function makeFixtureCard(home) {
  const now = new Date().toISOString();
  return {
    id: CARD_ID,
    issueId: `${CARD_ID}-issue`,
    identifier: CARD_IDENTIFIER,
    title: "Redaction capture fixture card",
    description: null,
    priority: 3,
    column: "done",
    updatedAt: now,
    branch: "redact-card-branch",
    tmuxSession: "dsp-REDACT-1",
    ttydPort: 41901,
    hookToken: CANARY_TOKEN,
    claudeSessionId: "claude-session-redact-abcdef",
    workspacePath: join(home, "workspaces", "REDACT-1"),
    workspace: {
      folder: "REDACT-1",
      repos: [{ path: join(home, "repos", "REDACT-1"), base: "main" }],
    },
  };
}

/**
 * Boot once against the empty sandbox home purely to get a real schema, kill it, then insert the
 * fixture card directly via node:sqlite (perf-board.mjs's seedDoneCards idiom, reused verbatim from
 * migration-diff-v3.mjs's seedFixtureCards). Then defuse the warmup-boot trap: the warmup boot's
 * own `load()` unconditionally advances the meta row's `schemaVersion` even on an empty database,
 * which would make the REAL boot below think migration already ran and the card would never gain a
 * `sessions` array — making the whole session-copy redaction check vacuous. Reset `schemaVersion`
 * to 0 and delete any `.pre-v3`/`.bak.*` files so the real boot's migration pass is guaranteed to
 * run for real.
 */
async function seedFixtureCard(home, card) {
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
    const writeMeta = db.prepare(
      `INSERT INTO meta (id, data) VALUES (0, @data)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    );
    db.exec("BEGIN");
    insertCard.run(card.id, JSON.stringify(card));
    const metaRow = db.prepare("SELECT data FROM meta WHERE id = 0").get();
    const meta = metaRow ? JSON.parse(metaRow.data) : {};
    delete meta.schemaVersion;
    writeMeta.run({ data: JSON.stringify(meta) });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }

  const dispatchDir = join(home, ".dispatch");
  for (const entry of readdirSync(dispatchDir)) {
    if (entry.endsWith(".pre-v3") || /\.bak\.(\d+|tmp)$/.test(entry)) {
      rmSync(join(dispatchDir, entry), { force: true });
    }
  }
  if (existsSync(join(dispatchDir, "board.db.pre-v3"))) {
    throw new Error(
      "ABORT: board.db.pre-v3 still exists after the seed step's reset — the real boot below " +
        "would skip migration and the card would never gain a sessions array, making the " +
        "session-copy redaction check vacuous. Refusing to produce a verdict.",
    );
  }
}

/** Raw `GET /api/board` body as TEXT — never parsed for the negative (zero-occurrence) checks. */
async function captureBoardText(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/board`);
  return res.text();
}

/**
 * Capture the first unnamed `data:` SSE frame from `/api/stream` as raw text, then abort — never a
 * watch/tail mode that runs forever. Named frames (`event: tunnel`/`event: ping`) are skipped, same
 * frame-boundary logic as perf-board.mjs's `makeFrameReader`. Bounded by
 * {@link SSE_FRAME_TIMEOUT_MS}.
 */
async function captureSseFrameText(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SSE_FRAME_TIMEOUT_MS);
  const res = await fetch(`http://127.0.0.1:${port}/api/stream`, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const boundary = buf.indexOf("\n\n");
      if (boundary !== -1) {
        const raw = buf.slice(0, boundary);
        buf = buf.slice(boundary + 2);
        if (raw.startsWith("data:")) return raw;
        continue;
      }
      const { value, done } = await reader.read();
      if (done)
        throw new Error("SSE stream closed before any data: frame arrived");
      buf += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
  }
}

/** Case-sensitive, non-overlapping occurrence count of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
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

/** Print one verdict row in the shared `check-doc-drift.mjs`-style idiom. Never prints a value. */
function printRow(label, pass, detail) {
  console.log(
    `  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function main() {
  const realBefore = statRealBoardDb();
  console.log(`LIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const rows = [];
  const home = makeSandboxHome("run1");
  let boardText = "";
  let sseText = "";
  try {
    const card = makeFixtureCard(home);
    await seedFixtureCard(home, card);

    const server = bootServer(home);
    try {
      await waitForReady(SANDBOX_PORT);
      boardText = await captureBoardText(SANDBOX_PORT);
      sseText = await captureSseFrameText(SANDBOX_PORT);
    } finally {
      await killAndWait(server);
    }

    const boardCount = countOccurrences(boardText, CANARY_TOKEN);
    rows.push({
      label: "NEGATIVE 1 — canary absent from GET /api/board text",
      pass: boardCount === 0,
      detail: `occurrences=${boardCount} (redacted marker: <canary>)`,
    });

    const sseCount = countOccurrences(sseText, CANARY_TOKEN);
    rows.push({
      label: "NEGATIVE 2 — canary absent from captured SSE frame text",
      pass: sseCount === 0,
      detail: `occurrences=${sseCount} (redacted marker: <canary>)`,
    });

    const dbPath = join(home, ".dispatch", "board.db");
    const dbBytes = readFileSync(dbPath).toString("latin1");
    const dbCount = countOccurrences(dbBytes, CANARY_TOKEN);
    rows.push({
      label:
        "POSITIVE CONTROL 1 — canary present in sandbox board.db raw bytes (anti-vacuity)",
      pass: dbCount > 0,
      detail: `occurrences=${dbCount} (redacted marker: <canary>)`,
    });

    let parsedBoard;
    let parseError = null;
    try {
      parsedBoard = JSON.parse(boardText);
    } catch (err) {
      parseError = err;
    }
    const wireCard = parsedBoard?.cards?.find((c) => c.id === CARD_ID);
    const positiveControl2 =
      parseError == null &&
      wireCard != null &&
      wireCard.activeSession != null &&
      wireCard.activeSession.tmuxSession === card.tmuxSession;
    rows.push({
      label:
        "POSITIVE CONTROL 2 — GET /api/board carries the seeded card id AND an activeSession.tmuxSession match (anti-vacuity)",
      pass: positiveControl2,
      detail: parseError
        ? `JSON.parse failed: ${parseError.message}`
        : `cardFound=${wireCard != null} activeSessionPresent=${wireCard?.activeSession != null} tmuxSessionMatch=${wireCard?.activeSession?.tmuxSession === card.tmuxSession}`,
    });

    const noSessionsArray = !boardText.includes('"sessions":');
    rows.push({
      label:
        'FIFTH ROW — GET /api/board carries no top-level "sessions" array key',
      pass: noSessionsArray,
      detail: `containsSessionsKey=${!noSessionsArray}`,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  console.log("\nRedaction capture verdict:");
  for (const row of rows) printRow(row.label, row.pass, row.detail);

  const realAfter = statRealBoardDb();
  console.log(`\nLIVE ${realAfter.path} AFTER: ${fmtStat(realAfter)}`);
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

  const failed = rows.filter((r) => !r.pass);
  if (failed.length === 0) {
    console.log(`\nPASS: 5/5 redaction verdict rows green`);
    process.exit(0);
  }
  console.log(`\nFAIL: ${failed.length} row(s) failed:`);
  for (const row of failed) console.log(`  ${row.label}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`redaction-capture-v3 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
