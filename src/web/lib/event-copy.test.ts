import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS } from "../../shared/types.js";
import type { ActivityEvent } from "../../shared/types.js";
import { COLUMN_LABELS, describeEvent } from "./event-copy.js";

const at = (
  type: ActivityEvent["type"],
  fromCol: ActivityEvent["fromCol"],
  toCol: ActivityEvent["toCol"],
): ActivityEvent => ({
  id: 1,
  cardId: "LOCAL-1",
  type,
  fromCol,
  toCol,
  reason: null,
  source: null,
  ts: "2026-09-10T00:00:00.000Z",
});

test("moves into and out of Parked read as Parked in the feed", () => {
  assert.equal(
    describeEvent(at("move_manual", "in_progress", "parked")),
    "moved In Progress → Parked",
  );
  assert.equal(
    describeEvent(at("move_auto", "parked", "in_progress")),
    "auto-moved Parked → In Progress",
  );
});

test("every rendered column has a Title Case feed label", () => {
  for (const column of COLUMNS) {
    assert.ok(COLUMN_LABELS[column].length > 0, `${column} feed label`);
  }
  assert.equal(COLUMN_LABELS.parked, "Parked");
});

test("unwind, restore and archive delete events read as prose with the destination column", () => {
  assert.equal(
    describeEvent(at("group_unwound", "in_progress", "todo")),
    "unwound, members sent to To Do",
  );
  assert.equal(describeEvent(at("group_unwound", null, null)), "unwound");
  assert.equal(
    describeEvent(at("group_restored", "inbox", "parked")),
    "restored to Parked",
  );
  assert.equal(describeEvent(at("group_restored", null, null)), "restored");
  assert.equal(
    describeEvent(at("archive_deleted", null, null)),
    "archived workspace deleted",
  );
});
