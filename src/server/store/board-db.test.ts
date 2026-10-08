import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isolateEnv } from "../test-support/fixtures.js";
import type { ArchivedGroup } from "../../shared/types.js";

isolateEnv();
const { openBoardDb, migrateToBoards, assertSchemaOpenable, BOARD_DB_PATH } =
  await import("./board-db.js");

void test("archive rows round-trip across a reopen, newest first, and delete reports once", () => {
  const row = (id: string, archivedAt: string): ArchivedGroup => ({
    id,
    identifier: id,
    title: "t",
    archivedAt,
    destination: "todo",
    card: {
      id,
      boardKey: DEFAULT_BOARD_KEY,
      issueId: id,
      identifier: id,
      title: "t",
      description: null,
      priority: 0,
      column: "parked",
      updatedAt: archivedAt,
      source: "group",
    },
    members: [],
  });
  const first = openBoardDb();
  first.upsertArchive(row("GROUP-1", "2026-09-01T00:00:00.000Z"));
  first.upsertArchive(row("GROUP-2", "2026-09-02T00:00:00.000Z"));

  const again = openBoardDb();
  assert.deepEqual(
    again.listArchive().map((r) => r.id),
    ["GROUP-2", "GROUP-1"],
  );
  assert.equal(again.listArchive()[1]?.card.column, "parked");
  assert.equal(again.deleteArchive("GROUP-1"), true);
  assert.equal(again.deleteArchive("GROUP-1"), false);
  assert.deepEqual(
    again.listArchive().map((r) => r.id),
    ["GROUP-2"],
  );
});

void test("items persist with their own rows and read back after a reopen", () => {
  const db = openBoardDb();
  const { cards, meta } = db.readAll();
  const base = {
    syncedAt: meta.syncedAt ?? null,
    workspaceFolders: meta.workspaceFolders ?? [],
    lastUsed: meta.lastUsed ?? null,
    schemaVersion: meta.schemaVersion,
  };
  const row = {
    id: "fake:1",
    source: "fake",
    type: "pr_review",
    title: "t",
    snippet: "s",
    createdAt: "2026-09-24T09:00:00.000Z",
    priority: 50,
    state: "snoozed" as const,
    snoozedUntil: "2026-09-25T09:00:00.000Z",
    meta: { repo: "acme/app" },
  };
  db.persist(cards, base, [], { upserts: [row] });
  const again = openBoardDb();
  assert.deepEqual(again.readAllItems(), [row]);
  again.persist(cards, base, [], { upserts: [{ ...row, state: "done" }] });
  assert.equal(openBoardDb().readAllItems()[0]?.state, "done");
});

void test("an unreadable items row is skipped on read instead of failing the load", () => {
  const db = openBoardDb();
  const { cards, meta } = db.readAll();
  const base = {
    syncedAt: meta.syncedAt ?? null,
    workspaceFolders: meta.workspaceFolders ?? [],
    lastUsed: meta.lastUsed ?? null,
    schemaVersion: meta.schemaVersion,
  };
  const good = {
    id: "fake:good",
    source: "fake",
    type: "pr_review",
    title: "t",
    snippet: "s",
    createdAt: "2026-09-24T09:00:00.000Z",
    priority: 1,
    state: "unread" as const,
    meta: {},
  };
  db.persist(cards, base, [], { upserts: [good] });
  const raw = new DatabaseSync(BOARD_DB_PATH);
  raw
    .prepare("INSERT INTO items (id, source, state, data) VALUES (?, ?, ?, ?)")
    .run("fake:bad", "fake", "unread", "{not json");
  raw.close();
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args.join(" "));
  let rows: string[];
  try {
    rows = openBoardDb()
      .readAllItems()
      .map((r) => r.id)
      .filter((id) => id === "fake:good" || id === "fake:bad");
  } finally {
    console.error = original;
  }
  assert.deepEqual(rows, ["fake:good"]);
  const line = logged.find((l) => l.includes("fake:bad"));
  assert.ok(line, "the skip line names the row id");
  assert.equal(
    line.includes("not json"),
    false,
    "row bytes stay out of the log",
  );
});

/**
 * Build a version 2 board file, the shape Dispatch 4.2 writes, in its own folder.
 */
function versionTwoBoard(opts: { schemaVersion?: number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boards-migration-"));
  const db = new DatabaseSync(path.join(dir, "board.db"));
  db.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 0), data TEXT NOT NULL);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT, type TEXT NOT NULL, from_col TEXT,
      to_col TEXT, reason TEXT, source TEXT, ts TEXT NOT NULL
    );
    CREATE TABLE archive (id TEXT PRIMARY KEY, data TEXT NOT NULL, archived_at TEXT NOT NULL);
    CREATE TABLE items (id TEXT PRIMARY KEY, source TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
  `);
  for (const id of ["LOCAL-1", "LOCAL-2", "GROUP-1"]) {
    db.prepare("INSERT INTO cards (id, data) VALUES (?, ?)").run(
      id,
      JSON.stringify({ id, identifier: id, title: id, column: "todo" }),
    );
  }
  db.prepare("INSERT INTO meta (id, data) VALUES (0, ?)").run(
    JSON.stringify({
      syncedAt: null,
      workspaceFolders: ["/work/dispatch"],
      lastUsed: "/work/dispatch",
      identifierCounters: { LOCAL: 2, GROUP: 1 },
      schemaVersion: opts.schemaVersion ?? 2,
    }),
  );
  for (const cardId of ["LOCAL-1", "LOCAL-2", null]) {
    db.prepare(
      "INSERT INTO events (card_id, type, ts) VALUES (?, 'local_created', '2026-10-01T00:00:00.000Z')",
    ).run(cardId);
  }
  db.prepare(
    "INSERT INTO archive (id, data, archived_at) VALUES ('GROUP-0', ?, '2026-10-01T00:00:00.000Z')",
  ).run(JSON.stringify({ id: "GROUP-0", card: { id: "GROUP-0" } }));
  db.prepare(
    "INSERT INTO items (id, source, state, data) VALUES ('fake:1', 'fake', 'unread', '{}')",
  ).run();
  return { db, copyPath: path.join(dir, "board.db.pre-boards") };
}

function dump(db: DatabaseSync): string {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence' ORDER BY name",
    )
    .all() as { name: string }[];
  return JSON.stringify(
    tables.map(({ name }) => [
      name,
      db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ]),
  );
}

function count(db: DatabaseSync, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

void test("the boards migration puts every card, event and archive row on LOCAL and keeps the items", () => {
  const { db, copyPath } = versionTwoBoard();
  assert.equal(migrateToBoards(db, copyPath), true);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM cards"), 3);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM events"), 3);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM archive"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM items"), 1);
  for (const table of ["cards", "events", "archive"]) {
    assert.equal(
      count(
        db,
        `SELECT COUNT(*) AS n FROM ${table} WHERE board_key <> 'LOCAL'`,
      ),
      0,
    );
  }
  for (const table of ["cards", "archive"]) {
    assert.equal(
      count(
        db,
        `SELECT COUNT(*) AS n FROM ${table} WHERE json_extract(data, '$.boardKey') IS NOT 'LOCAL'`,
      ),
      0,
    );
  }
  const board = db.prepare("SELECT * FROM boards").all() as {
    key: string;
    name: string;
    workspace_root: string | null;
    repositories: string;
    policy: string;
    archived: number;
  }[];
  assert.equal(board.length, 1);
  assert.equal(board[0]?.key, "LOCAL");
  assert.equal(board[0]?.workspace_root, null);
  assert.equal(board[0]?.repositories, "[]");
  assert.equal(board[0]?.archived, 0);
  assert.equal(
    (JSON.parse(board[0]?.policy ?? "{}") as { supervisor?: string })
      .supervisor,
    "off",
  );
  assert.equal(
    count(db, "SELECT json_extract(data, '$.schemaVersion') AS n FROM meta"),
    3,
  );
  assert.equal(fs.statSync(copyPath).mode & 0o777, 0o600);
  const copy = new DatabaseSync(copyPath, { readOnly: true });
  assert.equal(count(copy, "SELECT COUNT(*) AS n FROM cards"), 3);
  assert.equal(
    count(
      copy,
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'boards'",
    ),
    0,
  );
});

void test("a second migration run changes nothing", () => {
  const { db, copyPath } = versionTwoBoard();
  migrateToBoards(db, copyPath);
  const first = dump(db);
  assert.equal(migrateToBoards(db, copyPath), false);
  assert.equal(dump(db), first);
});

void test("a failure inside the migration rolls every change back", () => {
  const { db, copyPath } = versionTwoBoard();
  const before = dump(db);
  assert.throws(
    () => migrateToBoards(db, copyPath, { failInTransaction: true }),
    /rolled back.*pre-migration copy is at/,
  );
  assert.equal(dump(db), before);
  assert.equal(fs.existsSync(copyPath), true);
});

void test("a failed pre-migration copy stops the migration before any change", () => {
  const { db } = versionTwoBoard();
  const before = dump(db);
  assert.throws(
    () => migrateToBoards(db, path.join(os.tmpdir(), "no-such-dir", "copy")),
    /could not write its pre-migration copy/,
  );
  assert.equal(dump(db), before);
});

void test("a re-upgrade after a rollback writes a fresh copy over the old one", () => {
  const { db, copyPath } = versionTwoBoard();
  fs.writeFileSync(copyPath, "stale");
  assert.equal(migrateToBoards(db, copyPath), true);
  const copy = new DatabaseSync(copyPath, { readOnly: true });
  assert.equal(count(copy, "SELECT COUNT(*) AS n FROM cards"), 3);
  copy.close();
});

void test("the copy is kept when an older build re-ran the migration on a boards database", () => {
  const { db, copyPath } = versionTwoBoard();
  migrateToBoards(db, copyPath);
  fs.writeFileSync(copyPath, "first copy");
  db.prepare("UPDATE cards SET data = json_remove(data, '$.boardKey')").run();
  assert.equal(migrateToBoards(db, copyPath), true);
  assert.equal(fs.readFileSync(copyPath, "utf8"), "first copy");
});

void test("the copy also lands at pre-v3 and an older pre-v3 is moved aside", () => {
  const { db, copyPath } = versionTwoBoard();
  const legacy = copyPath.replace(/\.pre-boards$/, ".pre-v3");
  fs.writeFileSync(legacy, "months old");
  migrateToBoards(db, copyPath);
  assert.equal(
    fs.readFileSync(`${legacy}.before-boards`, "utf8"),
    "months old",
  );
  assert.deepEqual(fs.readFileSync(legacy), fs.readFileSync(copyPath));
});

void test("a failed pre-v3 write is logged and the migration still runs", () => {
  const { db, copyPath } = versionTwoBoard();
  fs.mkdirSync(copyPath.replace(/\.pre-boards$/, ".pre-v3"));
  assert.equal(migrateToBoards(db, copyPath), true);
  assert.equal(fs.existsSync(copyPath), true);
  assert.equal(
    count(db, "SELECT COUNT(*) AS n FROM boards WHERE key = 'LOCAL'"),
    1,
  );
});

void test("a blob that lost its board key keeps the board of its row", () => {
  const { db, copyPath } = versionTwoBoard();
  migrateToBoards(db, copyPath);
  db.prepare(
    "UPDATE cards SET board_key = 'ACME', data = json_remove(data, '$.boardKey') WHERE rowid = 1",
  ).run();
  assert.equal(migrateToBoards(db, copyPath), true);
  const row = db
    .prepare(
      "SELECT board_key, json_extract(data, '$.boardKey') AS blob FROM cards WHERE rowid = 1",
    )
    .get() as { board_key: string; blob: string };
  assert.deepEqual({ ...row }, { board_key: "ACME", blob: "ACME" });
});

void test("each partial boards state makes the migration due and the run completes it", () => {
  const states: [string, string][] = [
    [
      "a missing board_key column",
      "DROP INDEX idx_archive_board_key; ALTER TABLE archive DROP COLUMN board_key;",
    ],
    [
      "a schema version below 3 alone",
      "UPDATE meta SET data = json_set(data, '$.schemaVersion', 2) WHERE id = 0;",
    ],
    [
      "an archive blob without boardKey",
      "UPDATE archive SET data = json_remove(data, '$.boardKey');",
    ],
  ];
  for (const [name, degrade] of states) {
    const { db, copyPath } = versionTwoBoard();
    migrateToBoards(db, copyPath);
    db.exec(degrade);
    assert.equal(migrateToBoards(db, copyPath), true, name);
    assert.equal(migrateToBoards(db, copyPath), false, name);
    assert.equal(
      count(
        db,
        "SELECT COUNT(*) AS n FROM archive WHERE json_extract(data, '$.boardKey') = 'LOCAL'",
      ),
      1,
      name,
    );
  }
});

void test("the forward guard refuses a board above version 3 and names the rollback copy", () => {
  assert.doesNotThrow(() => assertSchemaOpenable(3));
  assert.throws(() => assertSchemaOpenable(4), /board\.db\.pre-boards/);
});

void test("a fresh database gets the boards schema with no pre-migration copy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boards-fresh-"));
  const db = new DatabaseSync(path.join(dir, "board.db"));
  db.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 0), data TEXT NOT NULL);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT, type TEXT NOT NULL,
      from_col TEXT, to_col TEXT, reason TEXT, source TEXT, ts TEXT NOT NULL);
    CREATE TABLE archive (id TEXT PRIMARY KEY, data TEXT NOT NULL, archived_at TEXT NOT NULL);
  `);
  const copyPath = path.join(dir, "board.db.pre-boards");
  assert.equal(migrateToBoards(db, copyPath), true);
  assert.equal(
    count(db, "SELECT COUNT(*) AS n FROM boards WHERE key = 'LOCAL'"),
    1,
  );
  assert.equal(fs.existsSync(copyPath), false);
});

void test("a board from a newer build is left for the forward guard and not migrated", () => {
  const { db, copyPath } = versionTwoBoard({ schemaVersion: 4 });
  const before = dump(db);
  assert.equal(migrateToBoards(db, copyPath), false);
  assert.equal(dump(db), before);
  assert.equal(fs.existsSync(copyPath), false);
});

void test("persist writes the board key column and the boardKey field for each card", () => {
  const db = openBoardDb();
  const { cards, meta } = db.readAll();
  const card = {
    id: "LOCAL-900",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "LOCAL-900",
    identifier: "LOCAL-900",
    title: "t",
    description: null,
    priority: 0,
    column: "todo" as const,
    updatedAt: "2026-10-06T00:00:00.000Z",
    source: "local" as const,
  };
  db.persist(
    [...cards, card],
    {
      syncedAt: meta.syncedAt ?? null,
      workspaceFolders: meta.workspaceFolders ?? [],
      lastUsed: meta.lastUsed ?? null,
      schemaVersion: 3,
    },
    [
      {
        cardId: "LOCAL-900",
        type: "local_created",
        fromCol: null,
        toCol: null,
        reason: null,
        source: null,
        ts: "2026-10-06T00:00:00.000Z",
      },
    ],
  );
  const raw = new DatabaseSync(BOARD_DB_PATH, { readOnly: true });
  assert.equal(
    count(
      raw,
      "SELECT COUNT(*) AS n FROM cards WHERE id = 'LOCAL-900' AND board_key = 'LOCAL' AND json_extract(data, '$.boardKey') = 'LOCAL'",
    ),
    1,
  );
  assert.equal(
    count(
      raw,
      "SELECT COUNT(*) AS n FROM events WHERE card_id = 'LOCAL-900' AND board_key = 'LOCAL'",
    ),
    1,
  );
  raw.close();
});
