import assert from "node:assert/strict";
import { test } from "node:test";
import { turnLabel } from "./running-sessions.js";

test("turn states read in words", () => {
  assert.equal(turnLabel("idle"), "Idle");
  assert.equal(turnLabel("busy"), "Working");
  assert.equal(turnLabel("limit"), "At usage limit");
  assert.equal(turnLabel("unknown"), "Unknown");
});
