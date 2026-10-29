import assert from "node:assert/strict";
import { test } from "node:test";
import { needsAttention } from "../../../../shared/card-attention.js";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import { COLUMNS, type Card, type Column } from "../../../../shared/types.js";
import { showsSessionRecovery } from "./session-recovery.js";

function lostCard(column: Column): Card {
  return {
    id: "c1",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "i1",
    identifier: "LOCAL-1",
    title: "A card",
    description: null,
    priority: 0,
    column,
    updatedAt: "2026-10-15T00:00:00.000Z",
    sessionLost: true,
  };
}

test("the card face hides session recovery in In Review, Parked and Done", () => {
  for (const column of ["in_review", "parked", "done"] as const) {
    assert.equal(showsSessionRecovery(lostCard(column)), false, column);
  }
});

test("the card face shows session recovery in To Do, In Progress, Needs Input and Agent done", () => {
  for (const column of [
    "todo",
    "in_progress",
    "needs_input",
    "agent_done",
  ] as const) {
    assert.equal(showsSessionRecovery(lostCard(column)), true, column);
  }
});

test("a lost session needs attention in exactly the columns that show session recovery", () => {
  for (const column of COLUMNS) {
    const card = lostCard(column);
    assert.equal(needsAttention(card), showsSessionRecovery(card), column);
  }
});
