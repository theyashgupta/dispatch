import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMN_LABELS } from "./column-labels.js";
import { COLUMNS } from "./types.js";

test("every board column and the inbox has a label", () => {
  for (const column of [...COLUMNS, "inbox" as const])
    assert.ok(COLUMN_LABELS[column]);
  assert.equal(Object.keys(COLUMN_LABELS).length, COLUMNS.length + 1);
});

test("the labels keep their Title Case strings", () => {
  assert.deepEqual(COLUMN_LABELS, {
    todo: "To Do",
    in_progress: "In Progress",
    needs_input: "Needs Input",
    agent_done: "Agent Done",
    in_review: "In Review",
    parked: "Parked",
    done: "Done",
    inbox: "Inbox",
  });
});
