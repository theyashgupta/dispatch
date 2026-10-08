import assert from "node:assert/strict";
import { test } from "node:test";
import { costRows } from "./cost-rows.js";

function row(cost: number, budget: number | null) {
  const [first] = costRows([
    { cardId: "c1", groupId: "GROUP-1", cost, budget },
  ]);
  assert.ok(first);
  return first;
}

test("below the near ratio the text is plain", () => {
  assert.deepEqual(row(12.4, 20), {
    cardId: "c1",
    groupId: "GROUP-1",
    percent: 62,
    text: "$12.40 of $20.00, 62%",
    near: false,
  });
});

test("0.79 is not near and 0.80 is", () => {
  assert.equal(row(79, 100).near, false);
  assert.equal(row(79, 100).text, "$79.00 of $100.00, 79%");
  assert.equal(row(80, 100).near, true);
  assert.equal(row(80, 100).text, "$80.00 of $100.00, 80%, near budget");
});

test("86 percent reads near budget", () => {
  const near = row(17.1, 20);
  assert.equal(near.text, "$17.10 of $20.00, 86%, near budget");
  assert.equal(near.percent, 86);
});

test("no budget shows the cost only", () => {
  assert.deepEqual(row(12.4, null), {
    cardId: "c1",
    groupId: "GROUP-1",
    percent: null,
    text: "$12.40, no budget",
    near: false,
  });
});

test("the row names the group by the identifier of the summary", () => {
  const [first] = costRows([
    { cardId: "zz", groupId: "GROUP-9", cost: 1, budget: null },
  ]);
  assert.equal(first?.groupId, "GROUP-9");
});

test("a budget set by an owner override names the owner", () => {
  const [first] = costRows([
    {
      cardId: "c1",
      groupId: "GROUP-1",
      cost: 6,
      budget: 12,
      ownerName: "Release extra",
    },
  ]);
  assert.equal(
    first?.text,
    "$6.00 of $12.00, 50%, budget set by Release extra",
  );
});
