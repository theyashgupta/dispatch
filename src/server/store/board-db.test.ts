import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { isolateEnv } from "../test-support/fixtures.js";
import type { ArchivedGroup } from "../../shared/types.js";

isolateEnv();
const { openBoardDb, BOARD_DB_PATH } = await import("./board-db.js");

void test("archive rows round-trip across a reopen, newest first, and delete reports once", () => {
  const row = (id: string, archivedAt: string): ArchivedGroup => ({
    id,
    identifier: id,
    title: "t",
    archivedAt,
    destination: "todo",
    card: {
      id,
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
