import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import type { ArchivedGroup } from "../../shared/types.js";

isolateEnv();
const { openBoardDb } = await import("./board-db.js");

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
