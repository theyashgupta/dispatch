import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import { cardOf, writeRunLog } from "./harness/board-reads.js";
import {
  MINUTE,
  SANDBOX_ROOT,
  makeNote,
  sleep,
  startSandbox,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const BOARD = "LIS";
const CARD = "LIS-1";
const SAMPLE_FILE = path.join(SANDBOX_ROOT, "local-197-memory-sample.json");
const PROBE = "tests/e2e/fixtures/local-197/early-import.probe.ts";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const note = makeNote("local-197-live-isolation");

/** Answer the board policy body with the supervisor on. */
const policy = () => ({
  roadmapApproval: "all",
  concurrencyCap: 2,
  loopModel: "claude-sonnet-5-5:high",
  orchestratorModel: "claude-sonnet-5-5",
  handoffPercent: 50,
  handoffHardPercent: 80,
  usageLimit: "stop",
  shipRights: "merge",
  budgetPerGroup: null,
  supervisor: "on",
  groupPlaybook: null,
});

/** Write the memory sample file that keeps every sandbox above its free memory floor. */
function writeMemorySample(): void {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  fs.writeFileSync(
    SAMPLE_FILE,
    JSON.stringify({
      freeMb: 4096,
      compressorMb: 500,
      swapUsedMb: 0,
      swapTotalMb: 12288,
      load1: 2,
    }),
  );
}

/** Run one read-only query against a sandbox database file and return the first row. */
function readRow(
  dbFile: string,
  sql: string,
): Record<string, number | string | null> {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return (db.prepare(sql).get() ?? {}) as Record<
      string,
      number | string | null
    >;
  } finally {
    db.close();
  }
}

/** Answer the highest `events.id` of the database file, or 0 when the table is empty. */
const maxEventId = (dbFile: string): number =>
  Number(readRow(dbFile, "SELECT max(id) AS n FROM events").n ?? 0);

/** Create board LIS with the supervisor on, start card LIS-1 and answer its tmux session once the fake claude prompt shows. */
async function startSupervisedCard(sb: Sandbox): Promise<string> {
  const sample = makeSampleRepo(sb.root, sb.home);
  fs.writeFileSync(
    path.join(sb.scenarios, "default.json"),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  const sessions = path.join(sb.workspaces, "lis-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const board = await sb.api("POST", "/api/boards", {
    key: BOARD,
    name: "Live isolation board",
    workspaceRoot: sessions,
    repositories: [
      { path: sample.repo, baseBranch: "main", checkCommand: "true" },
    ],
  });
  assert.equal(board.status, 201);
  const on = await sb.api("PUT", `/api/boards/${BOARD}/policy`, policy());
  assert.equal(on.status, 200);
  const made = await sb.api<{ id: string }>(
    "POST",
    `/api/cards?board=${BOARD}`,
    { title: "Share a session name", description: "Same card in two boards." },
  );
  assert.equal(made.status, 201);
  assert.equal(made.body.id, CARD);
  const start = await sb.api("POST", `/api/cards/${CARD}/start`, {
    folder: sb.workspaces,
    repos: [{ path: sample.repo, base: "main" }],
  });
  assert.equal(start.status, 202, JSON.stringify(start.body));
  const live = await waitFor(
    async () => {
      const card = await cardOf(sb, BOARD, CARD);
      return card?.tmuxSession !== undefined && card.workspacePath
        ? card
        : null;
    },
    MINUTE,
    "the card with a live tmux session",
  );
  const session = live.tmuxSession ?? "";
  await waitFor(
    () => sb.tmux(["capture-pane", "-p", "-t", `=${session}:`]).includes("❯"),
    MINUTE,
    "the fake claude prompt in the pane",
  );
  return session;
}

/**
 * Lose the session of the loop sandbox and check that the live stand-in records nothing for its own card.
 *
 * @remarks Both sandboxes hold card LIS-1 under the same tmux session name, the collision of the Oct 23 incident.
 * Each data folder gets its own tmux server label, so the live supervisor must not see the loop's lost session.
 */
async function runIsolation(live: Sandbox, loop: Sandbox): Promise<void> {
  const liveSession = await startSupervisedCard(live);
  const loopSession = await startSupervisedCard(loop);
  note(`sessions ${liveSession} and ${loopSession}`);
  assert.equal(liveSession, loopSession, "both cards use one session name");
  assert.notEqual(live.tmuxLabel, loop.tmuxLabel);

  const liveDb = path.join(live.dir, "board.db");
  const orchestrationBase = Math.max(
    0,
    ...(await live.orchestrationEvents(BOARD)).map((e) => e.id),
  );
  const eventsBase = maxEventId(liveDb);

  spawnSync(
    "tmux",
    ["-L", loop.tmuxLabel, "kill-session", "-t", `=${loopSession}`],
    { stdio: "ignore" },
  );
  note("loop session killed");

  await waitFor(
    async () =>
      (await loop.orchestrationEvents(BOARD)).find(
        (e) =>
          e.kind === "supervisor_state" &&
          e.cardId === CARD &&
          e.data.to === "lost",
      ),
    2 * MINUTE,
    "the loop supervisor to record lost for its card",
  );
  note("loop supervisor recorded lost");
  await sleep(20_000);

  const liveOrchestration = (await live.orchestrationEvents(BOARD)).filter(
    (e) => e.id > orchestrationBase && e.cardId === CARD,
  );
  assert.deepEqual(liveOrchestration, [], "no live orchestration event");
  const stray = new DatabaseSync(liveDb, { readOnly: true });
  try {
    const rows = stray
      .prepare(
        "SELECT id, type FROM events WHERE id > ? AND card_id = ? AND type IN ('session_lost', 'session_resume', 'resume_failed', 'status_needs_input')",
      )
      .all(eventsBase, CARD);
    assert.deepEqual(rows, [], "no live card event");
  } finally {
    stray.close();
  }
  assert.doesNotThrow(() =>
    live.tmux(["has-session", "-t", `=${liveSession}`]),
  );
  const card = await cardOf(live, BOARD, CARD);
  assert.equal(card?.tmuxSession, liveSession);
  assert.notEqual(card?.sessionLost, true);
  await writeRunLog(
    live,
    BOARD,
    path.join(live.root, "logs", "live-orchestration.tsv"),
  );
  await writeRunLog(
    loop,
    BOARD,
    path.join(loop.root, "logs", "loop-orchestration.tsv"),
  );
}

void test(
  "scenario-LOCAL-197-live-isolation: a supervised sandbox card that loses its session leaves the live board untouched",
  { timeout: 10 * MINUTE },
  async () => {
    writeMemorySample();
    const live = await startSandbox({
      name: "local-197-live",
      memorySampleFile: SAMPLE_FILE,
    });
    try {
      const loop = await startSandbox({
        name: "local-197-loop",
        memorySampleFile: SAMPLE_FILE,
      });
      try {
        await runIsolation(live, loop);
      } finally {
        await loop.stop();
      }
    } finally {
      await live.stop();
    }
  },
);

/** Build the environment of the probe run: no Dispatch, Claude or Anthropic key, no NODE_ENV, no inherited test-runner marker, and a chosen HOME. */
function probeEnv(home: string, out: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const stripped =
      key === "NODE_ENV" ||
      key === "NODE_TEST_CONTEXT" ||
      ["DISPATCH_", "CLAUDE_", "ANTHROPIC_"].some((p) => key.startsWith(p));
    if (!stripped) env[key] = value;
  }
  return { ...env, HOME: home, PROBE_OUT: out };
}

void test(
  "scenario-LOCAL-197-live-isolation: a test process that imports the store before isolating its env cannot write to the live board",
  { timeout: 10 * MINUTE },
  async () => {
    writeMemorySample();
    const live = await startSandbox({
      name: "local-197-early-import",
      memorySampleFile: SAMPLE_FILE,
    });
    try {
      const liveDb = path.join(live.dir, "board.db");
      const probeHome = path.join(SANDBOX_ROOT, "local-197-probe-home");
      if (fs.lstatSync(probeHome, { throwIfNoEntry: false })) {
        fs.renameSync(probeHome, `${probeHome}-old-${Date.now()}`);
      }
      fs.mkdirSync(probeHome, { recursive: true });
      fs.symlinkSync(live.dir, path.join(probeHome, ".dispatch"));

      assert.equal(
        readRow(liveDb, "SELECT key FROM boards WHERE key = 'LOCAL'").key,
        "LOCAL",
        "the live stand-in holds the default board",
      );
      const probeCards = (): number =>
        Number(
          readRow(
            liveDb,
            "SELECT count(*) AS n FROM cards WHERE json_extract(data, '$.title') = 'early import probe'",
          ).n,
        );
      const localCreated = (): number =>
        Number(
          readRow(
            liveDb,
            "SELECT count(*) AS n FROM events WHERE type = 'local_created'",
          ).n,
        );
      const createdBefore = localCreated();
      const out = path.join(live.root, "probe-db-path.txt");

      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", "--test", PROBE],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: probeEnv(probeHome, out),
        },
      );
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

      assert.equal(probeCards(), 0, "the live stand-in gained no card");
      assert.equal(localCreated(), createdBefore, "no new local_created row");
      const dbPath = fs.readFileSync(out, "utf8");
      note(`probe opened ${dbPath}`);
      const tmp = fs.realpathSync(os.tmpdir());
      assert.ok(
        dbPath.startsWith(path.join(os.tmpdir(), "dispatch-unisolated-")) ||
          dbPath.startsWith(path.join(tmp, "dispatch-unisolated-")),
        `the probe opened ${dbPath}`,
      );
      assert.ok(!dbPath.startsWith(probeHome));
      assert.ok(!dbPath.startsWith(live.dir));
      assert.ok(!dbPath.startsWith(fs.realpathSync(live.dir)));

      await writeRunLog(
        live,
        "LOCAL",
        path.join(live.root, "logs", "early-import-orchestration.tsv"),
      );
    } finally {
      await live.stop();
    }
  },
);
