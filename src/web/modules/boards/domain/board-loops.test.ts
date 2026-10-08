import assert from "node:assert/strict";
import { test } from "node:test";
import { loopsLabels } from "./board-loops.js";

const loop = (n: number) => ({ groupId: `GROUP-${n}`, percent: n * 10 });

test("no loops gives null so the cell shows 0", () => {
  assert.equal(loopsLabels([]), null);
});

test("one loop shows its group id and percent", () => {
  assert.deepEqual(loopsLabels([loop(5)]), ["GROUP-5 50%"]);
});

test("three loops show all of them with no more line", () => {
  assert.deepEqual(loopsLabels([loop(1), loop(2), loop(3)]), [
    "GROUP-1 10%",
    "GROUP-2 20%",
    "GROUP-3 30%",
  ]);
});

test("five loops show three then +2 more", () => {
  assert.deepEqual(loopsLabels([loop(1), loop(2), loop(3), loop(4), loop(5)]), [
    "GROUP-1 10%",
    "GROUP-2 20%",
    "GROUP-3 30%",
    "+2 more",
  ]);
});
