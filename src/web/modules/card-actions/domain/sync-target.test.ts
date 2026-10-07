import assert from "node:assert/strict";
import { test } from "node:test";
import { TEAM_DEFAULT_STATE, stateIdOf } from "./sync-target.js";

test("the team default sends no state", () => {
  assert.equal(stateIdOf(TEAM_DEFAULT_STATE), undefined);
});

test("a chosen state is sent as its id", () => {
  assert.equal(stateIdOf("s-123"), "s-123");
});
