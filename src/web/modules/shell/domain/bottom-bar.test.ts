import { test } from "node:test";
import assert from "node:assert/strict";
import { BOTTOM_BAR_SLOTS, currentSlotId } from "./bottom-bar.js";

test("the slots read Today, Inbox, New ticket, Board, Orchestrator in order", () => {
  assert.deepEqual(
    BOTTOM_BAR_SLOTS.map((slot) => slot.label),
    ["Today", "Inbox", "New ticket", "Board", "Orchestrator"],
  );
});

test("each slot page maps to its own slot id", () => {
  assert.equal(currentSlotId("today"), "today");
  assert.equal(currentSlotId("inbox"), "inbox");
  assert.equal(currentSlotId("board"), "board");
  assert.equal(currentSlotId("orchestrator"), "orchestrator");
});

test("a page with no slot maps to null", () => {
  assert.equal(currentSlotId("sessions"), null);
  assert.equal(currentSlotId("dashboard"), null);
});
