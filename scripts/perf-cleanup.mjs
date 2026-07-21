/**
 * Cleanup-teardown measurement harness (PERF-01, dev/ops tooling, NOT test code): boots the
 * production build with `DISPATCH_PERF_CLEANUP=1` (see src/server/services/orchestration/
 * cleanup.ts's env-gated per-step timing) against a sandbox seeded with N real git repos, N real
 * worktrees under one Done card's workspace folder, and that card in `board.db`, then drives the
 * real `POST /api/cards/:id/cleanup` route and reads back the `DISPATCH_PERF_CLEANUP_STEPS` line
 * the instrumented saga writes to stderr right before its terminal decision.
 *
 * Usage:
 *   node scripts/perf-cleanup.mjs                 3 repos, 5 runs (default)
 *   node scripts/perf-cleanup.mjs --repos=2 --runs=1
 *
 * Prints a per-run, per-step breakdown table, then two machine-parsable summary lines:
 *   PERF-CLEANUP repos=<N> runs=<N> mean=<ms> p50=<ms> p95=<ms>
 *   PERF-CLEANUP-STEPS preflight=<ms> kill=<ms> worktree_remove=<ms> fs_rm=<ms> prune=<ms>
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const PORT = 4861;
const POLL_INTERVAL_MS = 25;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const CLEANUP_TIMEOUT_MS = 60_000;
const STEPS_PREFIX = "DISPATCH_PERF_CLEANUP_STEPS ";

/** Read `--repos=N` off argv, defaulting to 3 repos per run. */
function readReposFlag(argv) {
  const flag = argv.find((a) => a.startsWith("--repos="));
  if (!flag) return 3;
  const n = Number(flag.slice("--repos=".length));
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--repos must be a positive integer, got: ${flag}`);
    process.exit(1);
  }
  return n;
}

/** Read `--runs=N` off argv, defaulting to 5 measured runs. */
function readRunsFlag(argv) {
  const flag = argv.find((a) => a.startsWith("--runs="));
  if (!flag) return 5;
  const n = Number(flag.slice("--runs=".length));
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--runs must be a positive integer, got: ${flag}`);
    process.exit(1);
  }
  return n;
}

/** Same deterministic scratch-HOME shape as perf-boot.mjs/perf-subproc.mjs. */
function makeSandboxHome(label) {
  const home = join(tmpdir(), `dispatch-perf-${label}-${process.pid}`);
  const dispatchDir = join(home, ".dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port: PORT,
        workspaceRoot: join(home, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return { home, dispatchDir };
}

/**
 * Create `count` real, independent git repos under `reposRoot`, each with one commit (via
 * `-c user.email`/`-c user.name` so this works on a machine with no global git identity), then
 * `git worktree add` one worktree per repo into `workspacePath` at the exact layout
 * `worktreePath(workspacePath, repoPath)` builds (`<workspacePath>/<basename(repoPath)>`) — a
 * mismatched layout would silently measure a no-op teardown.
 * @returns The absolute repo paths, in the same order the seeded card's `workspace.repos` uses.
 */
function seedRepos(reposRoot, workspacePath, count) {
  mkdirSync(reposRoot, { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  const repoPaths = [];
  for (let i = 0; i < count; i++) {
    const repoPath = join(reposRoot, `repo-${i}`);
    mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repoPath });
    execFileSync(
      "git",
      [
        "-c",
        "user.email=perf-cleanup@dispatch.local",
        "-c",
        "user.name=perf-cleanup",
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "seed",
      ],
      { cwd: repoPath },
    );
    const worktreePath = join(workspacePath, `repo-${i}`);
    execFileSync(
      "git",
      ["worktree", "add", "-q", "-b", `wt-repo-${i}`, worktreePath, "HEAD"],
      { cwd: repoPath },
    );
    repoPaths.push(repoPath);
  }
  return repoPaths;
}

/**
 * Seed one Done card directly into `<home>/.dispatch/board.db` with `node:sqlite`'s built-in
 * `DatabaseSync` (no dependency): create the `cards` table if absent and insert one row whose
 * `data` JSON satisfies `Card` (src/shared/types.ts) with `column: "done"`, the seeded
 * `workspacePath`, and one `workspace.repos` entry per seeded repo.
 */
function seedCard(dbPath, cardId, workspacePath, repoPaths) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      id   INTEGER PRIMARY KEY CHECK (id = 0),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id  TEXT,
      type     TEXT NOT NULL,
      from_col TEXT,
      to_col   TEXT,
      reason   TEXT,
      source   TEXT,
      ts       TEXT NOT NULL
    );
  `);
  const card = {
    id: cardId,
    issueId: cardId,
    identifier: cardId,
    title: "perf-cleanup seeded card",
    description: null,
    priority: 0,
    column: "done",
    updatedAt: new Date().toISOString(),
    workspacePath,
    workspace: {
      folder: workspacePath,
      repos: repoPaths.map((path) => ({ path, base: "main" })),
    },
  };
  db.prepare(
    `INSERT INTO cards (id, data) VALUES (@id, @data)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  ).run({ id: cardId, data: JSON.stringify(card) });
  db.close();
}

/** Poll `GET /api/board` until it returns 200 AND the seeded card is present in `done`. */
async function waitForSeededCard(cardId) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/board`);
      const body = await res.json().catch(() => null);
      if (res.status === 200 && body) {
        const card = (body.cards ?? []).find((c) => c.id === cardId);
        if (card && card.column === "done") return;
      }
    } catch {
      // server not listening yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `seeded card ${cardId} never appeared in 'done' via /api/board within ${READY_TIMEOUT_MS}ms — a silently-dropped seed would otherwise report a fast, meaningless number`,
  );
}

/** SIGTERM the child and wait for exit, escalating to SIGKILL after `KILL_TIMEOUT_MS`. */
function killAndWait(child) {
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
 * Run one full measured cleanup: fresh sandbox, N seeded repos + worktrees + a Done card, boot the
 * instrumented server, POST /cleanup, wait for the `DISPATCH_PERF_CLEANUP_STEPS` stderr line, kill
 * the child, tear down the sandbox. Returns the parsed per-step payload.
 */
async function driveOnce(repoCount, runIndex) {
  const label = `cleanup-${runIndex}`;
  const { home, dispatchDir } = makeSandboxHome(label);
  const workspacePath = join(home, "workspaces", "TICKET-1");
  const reposRoot = join(home, "repos");
  const cardId = "PERF-CLEANUP-1";

  try {
    const repoPaths = seedRepos(reposRoot, workspacePath, repoCount);
    seedCard(join(dispatchDir, "board.db"), cardId, workspacePath, repoPaths);

    const child = spawn("node", [DIST_ENTRY], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOME: home,
        DISPATCH_PERF_CLEANUP: "1",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderrBuf = "";
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
    });

    try {
      await waitForSeededCard(cardId);

      const res = await fetch(
        `http://127.0.0.1:${PORT}/api/cards/${cardId}/cleanup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: false }),
        },
      );
      await res.body?.cancel();
      if (res.status !== 202) {
        throw new Error(
          `expected 202 from /cleanup, got ${res.status} — instrumentation harness cannot proceed`,
        );
      }

      const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
      let line;
      while (Date.now() < deadline) {
        line = stderrBuf.split("\n").find((l) => l.startsWith(STEPS_PREFIX));
        if (line) break;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!line) {
        throw new Error(
          `no ${STEPS_PREFIX.trim()} line found in child stderr within ${CLEANUP_TIMEOUT_MS}ms — instrumentation did not fire`,
        );
      }
      return JSON.parse(line.slice(STEPS_PREFIX.length));
    } finally {
      await killAndWait(child);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function fmt(n) {
  return n.toFixed(1);
}

async function main() {
  if (!existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
    process.exit(1);
  }

  const repoCount = readReposFlag(process.argv.slice(2));
  const runs = readRunsFlag(process.argv.slice(2));

  const totals = [];
  const stepSums = {
    preflight_ms: 0,
    kill_ms: 0,
    worktree_remove_ms: 0,
    fs_rm_ms: 0,
    prune_ms: 0,
  };

  console.log(
    "  run".padEnd(6) +
      "preflight".padStart(11) +
      "kill".padStart(9) +
      "wt_remove".padStart(11) +
      "fs_rm".padStart(9) +
      "prune".padStart(9) +
      "total".padStart(10),
  );
  for (let i = 1; i <= runs; i++) {
    const dump = await driveOnce(repoCount, i);
    totals.push(dump.total_ms);
    for (const key of Object.keys(stepSums)) {
      stepSums[key] += dump[key];
    }
    console.log(
      `  ${String(i).padStart(4)}`.padEnd(6) +
        fmt(dump.preflight_ms).padStart(11) +
        fmt(dump.kill_ms).padStart(9) +
        fmt(dump.worktree_remove_ms).padStart(11) +
        fmt(dump.fs_rm_ms).padStart(9) +
        fmt(dump.prune_ms).padStart(9) +
        fmt(dump.total_ms).padStart(10),
    );
  }

  const sorted = [...totals].sort((a, b) => a - b);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);

  console.log(
    `\nPERF-CLEANUP repos=${repoCount} runs=${runs} mean=${fmt(mean)} p50=${fmt(p50)} p95=${fmt(p95)}`,
  );
  console.log(
    `PERF-CLEANUP-STEPS preflight=${fmt(stepSums.preflight_ms / runs)} kill=${fmt(stepSums.kill_ms / runs)} worktree_remove=${fmt(stepSums.worktree_remove_ms / runs)} fs_rm=${fmt(stepSums.fs_rm_ms / runs)} prune=${fmt(stepSums.prune_ms / runs)}`,
  );
}

main().catch((err) => {
  console.error(`perf-cleanup failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
