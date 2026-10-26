import test from "node:test";
import assert from "node:assert/strict";
import { holdsReleased } from "./session-release.js";

void test("a stored released holds while the pane does not show Claude", () => {
  assert.equal(holdsReleased("released", false), true);
});

void test("a stored released ends its hold when the pane shows Claude", () => {
  assert.equal(holdsReleased("released", true), false);
});

void test("a stored state other than released holds nothing", () => {
  for (const stored of [
    "working",
    "idle",
    "shell_prompt",
    "lost",
    "paused",
  ] as const) {
    assert.equal(holdsReleased(stored, false), false, stored);
  }
  assert.equal(holdsReleased(null, false), false);
});
