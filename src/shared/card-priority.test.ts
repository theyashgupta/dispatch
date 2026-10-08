import assert from "node:assert/strict";
import { test } from "node:test";
import { cardPriorityScore } from "./card-priority.js";

test("Linear priorities map onto the 0 to 100 item scale", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 0].map(cardPriorityScore),
    [100, 75, 50, 25, 0],
  );
});

test("an unknown priority maps to 0", () => {
  assert.equal(cardPriorityScore(7), 0);
});
