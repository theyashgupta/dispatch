import assert from "node:assert/strict";
import { test } from "node:test";
import { costText } from "./cost-text.js";

test("a cost with a budget reads as spent of budget", () => {
  assert.equal(costText(8.5, 10), "$8.50 of $10.00");
  assert.equal(costText(0, 20), "$0.00 of $20.00");
});

test("a cost with no budget reads as the cost alone", () => {
  assert.equal(costText(8.5, null), "$8.50");
});
