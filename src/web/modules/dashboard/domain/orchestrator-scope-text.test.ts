import test from "node:test";
import assert from "node:assert/strict";
import { orchestratorScopeText } from "./orchestrator-scope-text.js";

const main = {
  name: "Main",
  role: "main" as const,
  scope: { groupIds: [], ticketIds: [] },
};
const payments = {
  name: "Payments",
  role: "extra" as const,
  scope: { groupIds: ["GRP-1"], ticketIds: ["PAY-1", "PAY-2"] },
};
const cards = [
  { id: "GRP-1", source: "group" as const },
  { id: "PAY-1", source: "linear" as const },
  { id: "PAY-2", source: "linear" as const },
];

test("no orchestrator gives no text", () => {
  assert.equal(orchestratorScopeText([], cards), null);
});

test("one main reads its name and Board", () => {
  assert.equal(orchestratorScopeText([main], cards), "Main: Board");
});

test("each orchestrator reads its scope, joined by a middle dot", () => {
  assert.equal(
    orchestratorScopeText([main, payments], cards),
    "Main: Board · Payments: Feature, 3 cards",
  );
});

test("a scope id with no card on the board is not counted", () => {
  assert.equal(
    orchestratorScopeText([payments], []),
    "Payments: Feature, 0 cards",
  );
});
