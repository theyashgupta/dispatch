import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Column } from "../../../../shared/types.js";
import {
  applyMoves,
  compensationTargets,
  groupMoveCandidates,
  planGroupMove,
  restoreMoves,
  strandedMoves,
} from "./group-move.js";

const card = (id: string, column: Column): Card =>
  ({ id, column }) as unknown as Card;
const ok = { status: "fulfilled", value: undefined } as const;
const bad = { status: "rejected", reason: new Error("no") } as const;

test("a card already in the target column is not a candidate", () => {
  const cards = [card("a", "todo"), card("b", "done"), card("c", "todo")];
  assert.deepEqual(
    groupMoveCandidates(cards, ["a", "b"], "done").map((c) => c.id),
    ["a"],
  );
});

test("a card outside the selected ids is not a candidate", () => {
  assert.deepEqual(groupMoveCandidates([card("a", "todo")], ["z"], "done"), []);
});

test("a target that takes no manual entry refuses the whole plan", () => {
  assert.deepEqual(planGroupMove([card("a", "todo")], "agent_done"), {
    refused: true,
  });
});

test("the plan lists each candidate with its column of origin", () => {
  assert.deepEqual(
    planGroupMove([card("a", "todo"), card("b", "parked")], "done"),
    {
      refused: false,
      moves: [
        { id: "a", from: "todo" },
        { id: "b", from: "parked" },
      ],
    },
  );
});

test("a candidate the manual allowlist refuses is dropped from the plan", () => {
  assert.deepEqual(
    planGroupMove([card("a", "todo"), card("b", "parked")], "in_progress"),
    { refused: false, moves: [{ id: "b", from: "parked" }] },
  );
});

test("applyMoves writes the target column onto the moved cards only", () => {
  const cards = [card("a", "todo"), card("b", "todo"), card("c", "parked")];
  const next = applyMoves(cards, [{ id: "a", from: "todo" }], "done");
  assert.deepEqual(
    next.map((c) => c.column),
    ["done", "todo", "parked"],
  );
});

test("restoreMoves puts a card still in the target back where it came from", () => {
  const cards = [card("a", "done"), card("b", "done")];
  const next = restoreMoves(
    cards,
    [
      { id: "a", from: "todo" },
      { id: "b", from: "parked" },
    ],
    "done",
  );
  assert.deepEqual(
    next.map((c) => c.column),
    ["todo", "parked"],
  );
});

test("restoreMoves leaves a card that moved on and a card that was never moved", () => {
  const cards = [card("a", "in_review"), card("b", "todo")];
  const next = restoreMoves(cards, [{ id: "a", from: "todo" }], "done");
  assert.deepEqual(
    next.map((c) => c.column),
    ["in_review", "todo"],
  );
});

test("succeeded moves whose return the allowlist accepts are compensated, the others stranded", () => {
  const moves = [
    { id: "a", from: "todo" as Column },
    { id: "b", from: "agent_done" as Column },
    { id: "c", from: "parked" as Column },
  ];
  const results = [ok, ok, bad];
  assert.deepEqual(compensationTargets(moves, results, "done"), [moves[0]]);
  assert.deepEqual(strandedMoves(moves, results, "done"), [moves[1]]);
});

test("a failed move is neither compensated nor stranded", () => {
  const moves = [{ id: "a", from: "agent_done" as Column }];
  assert.deepEqual(compensationTargets(moves, [bad], "done"), []);
  assert.deepEqual(strandedMoves(moves, [bad], "done"), []);
});
