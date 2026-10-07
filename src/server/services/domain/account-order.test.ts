import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidChainOrder } from "./account-order.js";

const current = ["default", "a", "b"];

void test("a permutation of every current id is valid", () => {
  assert.equal(isValidChainOrder(current, ["b", "default", "a"]), true);
  assert.equal(isValidChainOrder(current, current), true);
});

void test("a missing, extra or repeated id is invalid", () => {
  assert.equal(isValidChainOrder(current, ["default", "a"]), false);
  assert.equal(isValidChainOrder(current, ["default", "a", "b", "c"]), false);
  assert.equal(isValidChainOrder(current, ["default", "a", "a"]), false);
  assert.equal(isValidChainOrder(current, ["default", "a", "c"]), false);
  assert.equal(isValidChainOrder(["default"], []), false);
});
