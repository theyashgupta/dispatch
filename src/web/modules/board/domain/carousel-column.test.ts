import assert from "node:assert/strict";
import { test } from "node:test";
import { pickActiveColumn } from "./carousel-column.js";

test("the entry with the highest ratio at or above 0.6 wins", () => {
  assert.equal(
    pickActiveColumn(
      [
        { column: "todo", ratio: 0.2 },
        { column: "in_progress", ratio: 0.7 },
        { column: "done", ratio: 0.9 },
      ],
      "todo",
    ),
    "done",
  );
});

test("a ratio of exactly 0.6 qualifies", () => {
  assert.equal(
    pickActiveColumn([{ column: "parked", ratio: 0.6 }], null),
    "parked",
  );
});

test("a ratio of 0.59 keeps the current column", () => {
  assert.equal(
    pickActiveColumn([{ column: "parked", ratio: 0.59 }], "todo"),
    "todo",
  );
});

test("no entries keep the current column, including none", () => {
  assert.equal(pickActiveColumn([], "in_review"), "in_review");
  assert.equal(pickActiveColumn([], null), null);
});

test("a tie keeps the first entry", () => {
  assert.equal(
    pickActiveColumn(
      [
        { column: "needs_input", ratio: 0.8 },
        { column: "agent_done", ratio: 0.8 },
      ],
      "todo",
    ),
    "needs_input",
  );
});
