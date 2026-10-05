import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceConnected } from "./linear-lit.js";

test("Linear is connected only when the connection is on", () => {
  assert.equal(sourceConnected("linear", true), true);
  assert.equal(sourceConnected("linear", false), false);
});

test("no other source reads as connected", () => {
  assert.equal(sourceConnected("github", true), false);
  assert.equal(sourceConnected("slack", true), false);
});
