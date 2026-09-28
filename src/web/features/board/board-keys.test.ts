import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../../shared/types.js";
import { boardLanes, nextFocusedCard } from "./board-keys.js";

const lanes = [["a1", "a2", "a3"], [], ["c1"], ["d1", "d2"]];

test("the first key with no focus, or a focus no longer on the board, lands on the first card of the first non-empty column", () => {
  assert.equal(nextFocusedCard(lanes, null, "j"), "a1");
  assert.equal(nextFocusedCard(lanes, null, "l"), "a1");
  assert.equal(nextFocusedCard(lanes, "gone", "k"), "a1");
  assert.equal(nextFocusedCard([[], []], null, "j"), null);
});

test("j and k move inside the column and clamp at its ends", () => {
  assert.equal(nextFocusedCard(lanes, "a1", "j"), "a2");
  assert.equal(nextFocusedCard(lanes, "a3", "j"), "a3");
  assert.equal(nextFocusedCard(lanes, "a2", "k"), "a1");
  assert.equal(nextFocusedCard(lanes, "a1", "k"), "a1");
});

test("h and l skip empty columns, clamp the row index and stay put at the board edge", () => {
  assert.equal(nextFocusedCard(lanes, "a3", "l"), "c1");
  assert.equal(nextFocusedCard(lanes, "c1", "l"), "d1");
  assert.equal(nextFocusedCard(lanes, "d2", "h"), "c1");
  assert.equal(nextFocusedCard(lanes, "c1", "h"), "a1");
  assert.equal(nextFocusedCard(lanes, "a2", "h"), "a2");
  assert.equal(nextFocusedCard(lanes, "d2", "l"), "d2");
});

test("board lanes follow the column order, drop grouped cards and list Done cards awaiting cleanup first", () => {
  const card = (id: string, extra: Partial<Card>): Card => ({
    id,
    issueId: id,
    identifier: id,
    title: id,
    description: null,
    priority: 0,
    column: "todo",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...extra,
  });
  const lanes = boardLanes([
    card("d-clean", { column: "done" }),
    card("t1", {}),
    card("member", { groupId: "g1" }),
    card("d-wt", { column: "done", workspacePath: "/ws" }),
    card("p1", { column: "parked" }),
  ]);
  assert.equal(lanes.length, 7);
  assert.deepEqual(lanes[0], ["t1"]);
  assert.deepEqual(lanes[5], ["p1"]);
  assert.deepEqual(lanes[6], ["d-wt", "d-clean"]);
});

test("with no focus the first key starts at the given lane and wraps to earlier lanes", () => {
  assert.equal(nextFocusedCard(lanes, null, "j", 2), "c1");
  assert.equal(nextFocusedCard(lanes, null, "j", 1), "c1");
  assert.equal(nextFocusedCard([["a"], [], []], null, "j", 2), "a");
});
