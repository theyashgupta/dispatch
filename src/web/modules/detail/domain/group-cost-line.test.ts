import assert from "node:assert/strict";
import { test } from "node:test";
import { groupCostLine } from "./group-cost-line.js";

const group = { id: "g1", source: "group" };

test("a group in the summary shows its cost against the budget", () => {
  assert.equal(
    groupCostLine(group, [{ cardId: "g1", cost: 8.5, budget: 10 }]),
    "Cost $8.50 of $10.00",
  );
});

test("a group with no budget shows the cost alone", () => {
  assert.equal(
    groupCostLine(group, [{ cardId: "g1", cost: 8.5, budget: null }]),
    "Cost $8.50",
  );
});

test("a card that is not a group shows no cost line", () => {
  assert.equal(
    groupCostLine({ id: "g1", source: "linear" }, [
      { cardId: "g1", cost: 8.5, budget: 10 },
    ]),
    null,
  );
  assert.equal(groupCostLine(null, []), null);
});

test("a group missing from the summary shows no cost line", () => {
  assert.equal(
    groupCostLine(group, [{ cardId: "g2", cost: 1, budget: null }]),
    null,
  );
});
