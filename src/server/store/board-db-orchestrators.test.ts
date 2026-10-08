import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  DEFAULT_BOARD_KEY,
  defaultBoardPolicy,
  parseBoardKey,
} from "../../shared/board-key.js";
import type {
  Board,
  BoardKey,
  OrchestratorRecord,
} from "../../shared/types.js";

isolateEnv();
const { openBoardDb, BOARD_DB_PATH } = await import("./board-db.js");

const SBX = parseBoardKey("SBX") as BoardKey;

const main: OrchestratorRecord = {
  id: "main",
  name: "Main",
  role: "main",
  scope: { groupIds: [], ticketIds: [] },
  policyOverride: {},
  cardId: null,
  state: "stopped",
  createdAt: "2026-10-07T00:00:00.000Z",
};

const extra: OrchestratorRecord = {
  ...main,
  id: "infra",
  name: "Infra",
  role: "extra",
  scope: { groupIds: ["SBX-9"], ticketIds: [] },
  policyOverride: { concurrencyCap: 1, shipRights: "none" },
};

function board(orchestrators: OrchestratorRecord[]): Board {
  return {
    key: SBX,
    name: "Sandbox",
    workspaceRoot: null,
    repositories: [],
    linearTeamKeys: [],
    lastUsedFolder: null,
    policy: defaultBoardPolicy(SBX),
    orchestrators,
    createdAt: "2026-10-07T00:00:00.000Z",
    archived: false,
  };
}

function raw(): DatabaseSync {
  return new DatabaseSync(BOARD_DB_PATH);
}

function schemaVersion(db: DatabaseSync): unknown {
  return (
    db
      .prepare(
        "SELECT json_extract(data, '$.schemaVersion') AS v FROM meta WHERE id = 0",
      )
      .get() as { v: unknown } | undefined
  )?.v;
}

const db = openBoardDb();
db.persist([], { schemaVersion: 3 } as never, []);

void test("a fresh database has the orchestrators column and the default board reads none", () => {
  const local = db.readBoards().find((b) => b.key === DEFAULT_BOARD_KEY);
  assert.deepEqual(local?.orchestrators, []);
  const conn = raw();
  const column = conn
    .prepare(
      "SELECT dflt_value, \"notnull\" AS nn FROM pragma_table_info('boards') WHERE name = 'orchestrators'",
    )
    .get() as { dflt_value: string; nn: number };
  assert.equal(column.dflt_value, "'[]'");
  assert.equal(column.nn, 1);
  conn.close();
});

void test("the board upsert writes and reads the orchestrator records", () => {
  db.persist([], { schemaVersion: 3 } as never, [], undefined, [
    board([main, extra]),
  ]);
  const stored = openBoardDb()
    .readBoards()
    .find((b) => b.key === SBX);
  assert.deepEqual(stored?.orchestrators, [main, extra]);
});

void test("an older build's upsert, which does not name the column, keeps the records", () => {
  const conn = raw();
  conn
    .prepare(
      `INSERT INTO boards (key, name, workspace_root, repositories, linear_team_keys, last_used_folder, policy, created_at, archived)
       VALUES (?, 'Renamed', NULL, '[]', '[]', NULL, ?, ?, 0)
       ON CONFLICT(key) DO UPDATE SET name = excluded.name, policy = excluded.policy`,
    )
    .run(
      SBX,
      JSON.stringify(defaultBoardPolicy(SBX)),
      "2026-10-07T00:00:00.000Z",
    );
  conn.close();
  const stored = openBoardDb()
    .readBoards()
    .find((b) => b.key === SBX);
  assert.equal(stored?.name, "Renamed");
  assert.deepEqual(stored?.orchestrators, [main, extra]);
});

void test("an existing database without the column gains it on open with no schema version change", () => {
  const conn = raw();
  const before = schemaVersion(conn);
  conn.exec("ALTER TABLE boards DROP COLUMN orchestrators");
  const dropped = conn
    .prepare(
      "SELECT 1 AS ok FROM pragma_table_info('boards') WHERE name = 'orchestrators'",
    )
    .get();
  assert.equal(dropped, undefined);
  conn.close();

  const reopened = openBoardDb();
  const boards = reopened.readBoards();
  assert.ok(boards.length >= 2);
  assert.ok(boards.every((b) => Array.isArray(b.orchestrators)));
  assert.deepEqual(boards.find((b) => b.key === SBX)?.orchestrators, []);

  const after = raw();
  assert.equal(schemaVersion(after), before);
  after.close();
});
