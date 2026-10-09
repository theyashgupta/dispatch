import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import type { Card } from "../../src/shared/types.js";
import { makeSampleRepo } from "./fixtures/scenario-1/repo.js";
import { readyRows } from "./fixtures/scenario-1/status-rows.js";
import {
  EVIDENCE_DIR,
  MINUTE,
  makeNote,
  RELEASE_V420,
  SANDBOX_ROOT,
  startSandbox,
  V420_SKIP,
  waitFor,
  type Sandbox,
} from "./harness/sandbox.js";

const REPORT = path.join(EVIDENCE_DIR, "upgrade-report.md");
const NAME = "s3-upgrade";
const NEWER = "s3-newer";
const COLUMN_MOVES: [string, string][] = [
  ["LOCAL-3", "needs_input"],
  ["LOCAL-4", "done"],
  ["LOCAL-5", "in_review"],
  ["LOCAL-6", "parked"],
];
const SESSION_CARDS = ["LOCAL-1", "LOCAL-2"];

interface Row {
  assertion: string;
  expected: string;
  observed: string;
  ok: boolean;
}

interface CardFacts {
  id: string;
  title: string;
  column: string;
  state: string | null;
  stateReason: string | null;
  tmuxSession: string | null;
  sessionLost: boolean | null;
  activeSessionId: string | null;
  workspacePath: string | null;
  branch: string | null;
}

const rows: Row[] = [];
const note = makeNote("scenario-3");

/** Record one assertion with its expected and observed value, then fail the test when they differ. */
function expectEqual(assertion: string, expected: unknown, observed: unknown) {
  const text = (v: unknown): string =>
    typeof v === "string" ? v : JSON.stringify(v);
  const ok = text(expected) === text(observed);
  rows.push({
    assertion,
    expected: text(expected),
    observed: text(observed),
    ok,
  });
  assert.deepEqual(observed, expected, assertion);
}

/** Write the table of every recorded assertion, one row each, to the evidence folder. */
function writeReport(extra: string[]): void {
  const cell = (s: string): string =>
    (s.length > 160 ? `${s.slice(0, 160)}...` : s).replaceAll("|", "\\|");
  const lines = [
    "# Scenario 3 upgrade report",
    "",
    "A v4.2.0 data folder with two running fake sessions is opened by the new build.",
    "",
    "| Assertion | Expected | Observed | Result |",
    "|-|-|-|-|",
    ...rows.map(
      (r) =>
        `| ${cell(r.assertion)} | ${cell(r.expected)} | ${cell(r.observed)} | ${r.ok ? "pass" : "FAIL"} |`,
    ),
    "",
    ...extra,
  ];
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${lines.join("\n")}\n`);
}

const factsOf = (card: Card): CardFacts => ({
  id: card.id,
  title: card.title,
  column: card.column,
  state: card.state ?? null,
  stateReason: card.stateReason ?? null,
  tmuxSession: card.tmuxSession ?? null,
  sessionLost: card.sessionLost ?? null,
  activeSessionId: card.activeSessionId ?? null,
  workspacePath: card.workspacePath ?? null,
  branch: card.branch ?? null,
});

async function boardCards(sb: Sandbox, query = ""): Promise<Card[]> {
  const res = await sb.api<{ cards: Card[] }>("GET", `/api/board${query}`);
  assert.equal(res.status, 200);
  return res.body.cards;
}

const hasSession = (sb: Sandbox, name: string): boolean =>
  spawnSync("tmux", ["-L", sb.tmuxLabel, "has-session", "-t", `=${name}`])
    .status === 0;

/** The text the fake shows on its pane, which is where it echoes each line a user submits. */
const paneOf = (sb: Sandbox, name: string): string =>
  spawnSync(
    "tmux",
    ["-L", sb.tmuxLabel, "capture-pane", "-p", "-t", `=${name}:`],
    {
      encoding: "utf8",
    },
  ).stdout;

const sha256 = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");

const sha = (file: string): string => sha256(fs.readFileSync(file));

const dbOf = (dir: string): string => path.join(dir, "board.db");

/** The folder's file names, with the SQLite sidecar files left out because they come and go with a connection. */
function folderListing(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => !f.endsWith("-wal") && !f.endsWith("-shm"))
    .sort();
}

/** The database file and every backup copy of it, which is what a boot must not add to. */
const backupListing = (dir: string): string[] =>
  folderListing(dir).filter((f) => f.startsWith("board.db"));

/** Run `fn` against a read-only handle of a database file, and close the handle after. */
function withDb<T>(file: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const schemaVersionOf = (file: string): number =>
  withDb(file, (db) => {
    const row = db
      .prepare(
        "SELECT json_extract(data, '$.schemaVersion') AS v FROM meta WHERE id = 0",
      )
      .get() as { v: number };
    return row.v;
  });

const dumpCards = (file: string): string =>
  withDb(file, (db) =>
    JSON.stringify(
      db.prepare("SELECT id, data, board_key FROM cards ORDER BY id").all(),
    ),
  );

/** Start a session through the v4.2.0 route and wait until the card shows its tmux session. */
async function startSession(
  sb: Sandbox,
  id: string,
  repo: string,
): Promise<void> {
  const res = await sb.api("POST", `/api/cards/${id}/start`, {
    folder: sb.workspaces,
    repos: [{ path: repo, base: "main" }],
  });
  assert.equal(res.status, 202);
  await waitFor(
    async () =>
      (await boardCards(sb)).find((c) => c.id === id)?.tmuxSession !==
      undefined,
    60_000,
    `${id} to show its tmux session`,
  );
}

/** Make a card through the v4.2.0 API for each column, then start two sessions, one after the other. */
async function seedOldBuild(old: Sandbox): Promise<void> {
  fs.writeFileSync(
    path.join(old.scenarios, "default.json"),
    JSON.stringify({ statusRows: readyRows(), reply: "ok" }),
  );
  const sample = makeSampleRepo(old.root, old.home);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const made = await old.api("POST", "/api/cards", {
      title: `Upgrade card ${n}`,
      description: `Card ${n} made on v4.2.0.`,
    });
    assert.equal(made.status, 201);
  }
  for (const [id, column] of COLUMN_MOVES) {
    const moved = await old.api("POST", `/api/cards/${id}/move`, { column });
    assert.equal(moved.status, 204);
  }
  for (const id of SESSION_CARDS) await startSession(old, id, sample.repo);
}

/** Read the server log of one run, which is the text of a boot. */
const logOf = (sb: Sandbox): string => fs.readFileSync(sb.serverLog, "utf8");

void test(
  "scenario 3: a v4.2.0 data folder upgrades with every card and running session kept",
  { timeout: 15 * MINUTE, skip: V420_SKIP },
  async () => {
    const sandboxes: Sandbox[] = [];
    const extra: string[] = [];
    try {
      const old = await startSandbox({ name: NAME, buildRoot: RELEASE_V420 });
      sandboxes.push(old);
      assert.match(
        logOf(old),
        /schema version now 2/,
        "the old build writes schema version 2",
      );
      await seedOldBuild(old);
      const before = (await boardCards(old)).map(factsOf);
      const sessions = before
        .filter((c) => c.tmuxSession !== null)
        .map((c) => c.tmuxSession as string);
      expectEqual("v4.2.0 started two sessions", 2, sessions.length);
      for (const name of sessions) {
        expectEqual(
          `before the upgrade, tmux has ${name}`,
          true,
          hasSession(old, name),
        );
      }
      extra.push(
        "## Cards before the upgrade (v4.2.0)",
        "",
        "```json",
        JSON.stringify(before, null, 2),
        "```",
        "",
      );
      await old.stopServer();
      expectEqual(
        "v4.2.0 schema version before the upgrade",
        2,
        schemaVersionOf(dbOf(old.dir)),
      );
      note("v4.2.0 server stopped, panes left running");

      for (const name of sessions) {
        expectEqual(
          `after the old server stops, tmux still lists ${name}`,
          true,
          hasSession(old, name),
        );
      }
      const dirBefore = folderListing(old.dir);
      expectEqual(
        "no pre-boards copy exists before the upgrade",
        false,
        dirBefore.includes("board.db.pre-boards"),
      );

      const fresh = await startSandbox({ name: NAME, reuseDir: true });
      sandboxes.push(fresh);
      note("new build booted on the v4.2.0 folder");
      const preBoards = path.join(fresh.dir, "board.db.pre-boards");
      expectEqual("board.db.pre-boards exists", true, fs.existsSync(preBoards));
      expectEqual(
        "the pre-boards copy holds schema version 2",
        2,
        schemaVersionOf(preBoards),
      );
      expectEqual(
        "meta schemaVersion after the upgrade (through the database)",
        3,
        schemaVersionOf(dbOf(fresh.dir)),
      );

      const after = (await boardCards(fresh, "?board=LOCAL")).map(factsOf);
      expectEqual(
        "the cards of board LOCAL, with column and status fields, equal the cards before",
        before,
        after,
      );
      extra.push(
        "## Cards after the upgrade (new build, board LOCAL)",
        "",
        "```json",
        JSON.stringify(after, null, 2),
        "```",
        "",
      );
      const keys = withDb(dbOf(fresh.dir), (db) =>
        db.prepare("SELECT id, board_key FROM cards ORDER BY id").all(),
      ).map((r) => `${String(r.id)}:${String(r.board_key)}`);
      expectEqual(
        "every card row carries board_key LOCAL",
        before.map((c) => `${c.id}:LOCAL`).sort(),
        keys,
      );
      expectEqual(
        "every card in the API carries boardKey LOCAL",
        before.map(() => "LOCAL"),
        (await boardCards(fresh, "?board=LOCAL")).map(
          (c) => c.boardKey ?? "(none)",
        ),
      );

      for (const name of sessions) {
        expectEqual(
          `after the upgrade, tmux still lists ${name}`,
          true,
          hasSession(fresh, name),
        );
        const card = after.find((c) => c.tmuxSession === name);
        expectEqual(
          `${card?.id} shows its session as live (tmuxSession ${name}, sessionLost not true)`,
          [name, false],
          [card?.tmuxSession, card?.sessionLost ?? false],
        );
      }
      const reconcile = logOf(fresh)
        .split("\n")
        .find((l) => l.startsWith("[reconcile]"));
      expectEqual(
        "reconcile log line reports no lost session",
        true,
        /session-lost sessions: 0;/.test(reconcile ?? ""),
      );
      const sent = "upgrade-input-check";
      const target = after.find((c) => c.id === SESSION_CARDS[0]);
      const input = await fresh.api(
        "POST",
        `/api/sessions/${target?.id}/input`,
        {
          text: sent,
        },
      );
      expectEqual(
        "input to a kept v4.2.0 session returns 200",
        200,
        input.status,
      );
      await waitFor(
        () => paneOf(fresh, target?.tmuxSession ?? "").includes(`> ${sent}`),
        30_000,
        "the kept session to show the text sent through the new build",
      );
      expectEqual(
        "the kept v4.2.0 session received the input sent through the new build",
        true,
        paneOf(fresh, target?.tmuxSession ?? "").includes(`> ${sent}`),
      );
      extra.push(
        "Reconcile line of the first new boot:",
        "",
        `    ${reconcile}`,
      );

      await fresh.stopServer();
      const firstDump = dumpCards(dbOf(fresh.dir));
      const firstFiles = backupListing(fresh.dir);
      const firstBackup = sha(preBoards);
      note("new build stopped after the first boot");

      const again = await startSandbox({ name: NAME, reuseDir: true });
      sandboxes.push(again);
      await again.stopServer();
      expectEqual(
        "the second boot changes no row of the cards table",
        sha256(firstDump),
        sha256(dumpCards(dbOf(again.dir))),
      );
      expectEqual(
        "the second boot writes no new board.db backup file",
        firstFiles,
        backupListing(again.dir),
      );
      expectEqual(
        "the pre-boards copy is the same bytes after the second boot",
        firstBackup,
        sha(preBoards),
      );
      expectEqual(
        "schemaVersion stays 3 after the second boot",
        3,
        schemaVersionOf(dbOf(again.dir)),
      );
      note("second boot is a no-op");

      const newerRoot = path.join(SANDBOX_ROOT, NEWER);
      const newerDir = path.join(newerRoot, "dispatch-dir");
      fs.rmSync(newerRoot, { recursive: true, force: true });
      fs.mkdirSync(newerRoot, { recursive: true });
      fs.cpSync(again.dir, newerDir, { recursive: true });
      const newerDb = new DatabaseSync(dbOf(newerDir));
      newerDb.exec(
        "UPDATE meta SET data = json_set(data, '$.schemaVersion', 4) WHERE id = 0",
      );
      newerDb.close();
      const newerHash = sha(dbOf(newerDir));
      let refusal = "";
      try {
        sandboxes.push(await startSandbox({ name: NEWER, reuseDir: true }));
      } catch (err) {
        refusal = err instanceof Error ? err.message : String(err);
      }
      const refusalLog = fs.readFileSync(
        path.join(newerRoot, "logs", "server.log"),
        "utf8",
      );
      expectEqual(
        "the new build exits with code 1 on a folder with schemaVersion 4",
        true,
        /exited with 1:/.test(refusal),
      );
      expectEqual(
        "the log names the newer board schema version 4",
        true,
        /NEWER version of dispatch than this one \(board schema version 4, this build understands 3\)/.test(
          refusalLog,
        ),
      );
      expectEqual(
        "the refusing boot leaves board.db unchanged",
        newerHash,
        sha(dbOf(newerDir)),
      );
      extra.push(
        "",
        "Refusal of schemaVersion 4 (server log):",
        "",
        `    ${refusalLog.replace(/\n/g, " ").slice(0, 500)}`,
      );
    } finally {
      try {
        writeReport(extra);
      } finally {
        for (const sb of sandboxes.reverse()) await sb.stop();
      }
    }
  },
);
