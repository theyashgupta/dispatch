import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_STATES } from "./session-states.js";

test("the table holds the 14 states with the spec labels", () => {
  assert.equal(Object.keys(SESSION_STATES).length, 14);
  assert.equal(SESSION_STATES.frozen.label, "Frozen after compaction");
  assert.equal(SESSION_STATES.frozen.tone, "attention");
  assert.equal(SESSION_STATES.stale.label, "No progress");
  assert.equal(
    SESSION_STATES.usage_limit_wait.label,
    "Waiting for usage reset",
  );
  assert.equal(SESSION_STATES.lost.tone, "error");
  assert.equal(SESSION_STATES.paused.label, "Paused");
});
