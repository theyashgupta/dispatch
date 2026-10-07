import assert from "node:assert/strict";
import { test } from "node:test";
import { moveChainOrder } from "./chain-order.js";

const ids = ["default", "a", "b"];

test("moving an item one slot up swaps it with the one above", () => {
  assert.deepEqual(moveChainOrder(ids, 1, 0), ["a", "default", "b"]);
  assert.deepEqual(moveChainOrder(ids, 2, 1), ["default", "b", "a"]);
});

test("moving an item one slot down swaps it with the one below", () => {
  assert.deepEqual(moveChainOrder(ids, 0, 1), ["a", "default", "b"]);
  assert.deepEqual(moveChainOrder(ids, 1, 2), ["default", "b", "a"]);
});

test("the top item cannot move up and the bottom item cannot move down", () => {
  assert.deepEqual(moveChainOrder(ids, 0, -1), ids);
  assert.deepEqual(moveChainOrder(ids, 2, 3), ids);
});

test("a move from each index to each index of a three item list", () => {
  const expected: Record<string, string[]> = {
    "0-0": ["default", "a", "b"],
    "0-1": ["a", "default", "b"],
    "0-2": ["a", "b", "default"],
    "1-0": ["a", "default", "b"],
    "1-1": ["default", "a", "b"],
    "1-2": ["default", "b", "a"],
    "2-0": ["b", "default", "a"],
    "2-1": ["default", "b", "a"],
    "2-2": ["default", "a", "b"],
  };
  for (let from = 0; from < 3; from++) {
    for (let to = 0; to < 3; to++) {
      assert.deepEqual(
        moveChainOrder(ids, from, to),
        expected[`${from}-${to}`],
        `${from} to ${to}`,
      );
    }
  }
});

test("an out of range index returns the order unchanged", () => {
  assert.deepEqual(moveChainOrder(ids, -1, 1), ids);
  assert.deepEqual(moveChainOrder(ids, 0, 3), ids);
  assert.deepEqual(moveChainOrder(ids, 7, 6), ids);
});

test("every move holds each id once and leaves the input alone", () => {
  const input = [...ids];
  const out = moveChainOrder(input, 2, 0);
  assert.deepEqual([...out].sort(), [...ids].sort());
  assert.deepEqual(input, ids);
  assert.notEqual(moveChainOrder(input, 0, -1), input);
});
