import assert from "node:assert/strict";
import { test } from "node:test";
import { dollars, spentOfBudget } from "./cost-text.js";

test("an amount reads as dollars with two decimals", () => {
  assert.equal(dollars(12.4), "$12.40");
  assert.equal(dollars(0), "$0.00");
});

test("a cost with a budget reads as spent of budget", () => {
  assert.equal(spentOfBudget(8.5, 10), "$8.50 of $10.00");
  assert.equal(spentOfBudget(0, 20), "$0.00 of $20.00");
});

test("a cost with no budget reads as the cost alone", () => {
  assert.equal(spentOfBudget(8.5, null), "$8.50");
});
