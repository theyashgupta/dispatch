import test from "node:test";
import assert from "node:assert/strict";
import { isHiddenCard } from "./hidden-card.js";

void test("only an orchestrator card is hidden", () => {
  assert.equal(isHiddenCard({ source: "orchestrator" }), true);
  for (const source of ["local", "group", "linear", undefined]) {
    assert.equal(isHiddenCard({ source }), false);
  }
});
