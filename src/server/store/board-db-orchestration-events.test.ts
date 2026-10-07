import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, OrchestrationEvent } from "../../shared/types.js";

isolateEnv();
const { openBoardDb, BOARD_DB_PATH } = await import("./board-db.js");

const ACME = parseBoardKey("ACME") as BoardKey;

function event(boardKey: BoardKey, n: number): Omit<OrchestrationEvent, "id"> {
  return {
    boardKey,
    cardId: `${boardKey}-1`,
    sessionId: null,
    kind: "loop_gate",
    data: { n },
    ts: `2026-10-06T00:00:0${n}.000Z`,
  };
}

const db = openBoardDb();

void test("the orchestration_events table exists", () => {
  const raw = new DatabaseSync(BOARD_DB_PATH, { readOnly: true });
  const row = raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_events'",
    )
    .get();
  assert.equal((row as { name: string }).name, "orchestration_events");
});

void test("append returns increasing ids", () => {
  const first = db.appendOrchestrationEvent(event(DEFAULT_BOARD_KEY, 1));
  const second = db.appendOrchestrationEvent(event(DEFAULT_BOARD_KEY, 2));
  assert.ok(second > first);
});

void test("list returns only later rows of the board in id order and respects the limit", () => {
  db.appendOrchestrationEvent(event(ACME, 3));
  db.appendOrchestrationEvent(event(DEFAULT_BOARD_KEY, 4));
  db.appendOrchestrationEvent(event(DEFAULT_BOARD_KEY, 5));
  const all = db.listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 100);
  assert.deepEqual(
    all.map((e) => e.data.n),
    [1, 2, 4, 5],
  );
  assert.ok(all.every((e) => e.boardKey === DEFAULT_BOARD_KEY));
  assert.deepEqual(
    all.map((e) => e.id),
    [...all.map((e) => e.id)].sort((a, b) => a - b),
  );
  const after = db.listOrchestrationEvents(DEFAULT_BOARD_KEY, all[1].id, 100);
  assert.deepEqual(
    after.map((e) => e.data.n),
    [4, 5],
  );
  assert.equal(db.listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 2).length, 2);
});

void test("list after the highest id returns no rows", () => {
  const all = db.listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 100);
  const last = all.at(-1)?.id;
  assert.ok(last !== undefined);
  assert.deepEqual(
    db.listOrchestrationEvents(DEFAULT_BOARD_KEY, last, 100),
    [],
  );
});

void test("rows of another board are not returned", () => {
  const acme = db.listOrchestrationEvents(ACME, 0, 100);
  assert.deepEqual(
    acme.map((e) => e.data.n),
    [3],
  );
  assert.equal(acme[0]?.cardId, "ACME-1");
  assert.equal(acme[0]?.sessionId, null);
});

void test("an unparsable data cell reads back as an empty object", () => {
  const raw = new DatabaseSync(BOARD_DB_PATH);
  raw
    .prepare(
      "INSERT INTO orchestration_events (board_key, kind, data, ts) VALUES ('BAD', 'loop_gate', 'not json', '2026-10-06T00:00:00.000Z')",
    )
    .run();
  const rows = db.listOrchestrationEvents("BAD" as BoardKey, 0, 10);
  assert.deepEqual(rows[0]?.data, {});
});

void test("an existing version 3 database opens with the table added and stays at version 3", () => {
  const raw = new DatabaseSync(BOARD_DB_PATH);
  raw.exec("DROP TABLE orchestration_events");
  raw
    .prepare(
      "INSERT OR REPLACE INTO meta (id, data) VALUES (0, '{\"schemaVersion\":3}')",
    )
    .run();
  const versionBefore = raw
    .prepare("SELECT json_extract(data, '$.schemaVersion') AS v FROM meta")
    .get() as { v: number } | undefined;
  assert.equal(versionBefore?.v, 3);
  openBoardDb();
  const table = raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_events'",
    )
    .get();
  assert.equal((table as { name: string }).name, "orchestration_events");
  const after = raw
    .prepare("SELECT json_extract(data, '$.schemaVersion') AS v FROM meta")
    .get() as { v: number };
  assert.equal(after.v, 3);
});
