import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../../../shared/types.js";
import { runningLoopKey } from "./running-loop-key.js";

const card = (over: Partial<Card>): Card =>
  ({ source: "group", column: "in_progress", ...over }) as Card;

test("runningLoopKey gives the same key for the same cards in another order", () => {
  const a = card({ id: "a", tmuxSession: "dsp-a" });
  const b = card({ id: "b", tmuxSession: "dsp-b" });
  assert.equal(runningLoopKey([a, b]), "a,b");
  assert.equal(runningLoopKey([b, a]), "a,b");
});

test("runningLoopKey skips a group card in Done", () => {
  assert.equal(
    runningLoopKey([card({ id: "a", column: "done", tmuxSession: "dsp-a" })]),
    "",
  );
});

test("runningLoopKey skips a ticket card", () => {
  assert.equal(
    runningLoopKey([card({ id: "a", source: "linear", tmuxSession: "dsp-a" })]),
    "",
  );
});

test("runningLoopKey includes a group card that is only provisioning", () => {
  assert.equal(
    runningLoopKey([card({ id: "a", provisioningStep: "worktree" })]),
    "a",
  );
});

test("runningLoopKey skips a group card with a lost session", () => {
  assert.equal(
    runningLoopKey([
      card({ id: "a", tmuxSession: "dsp-a", sessionLost: true }),
    ]),
    "",
  );
});

test("runningLoopKey is empty when no card runs", () => {
  assert.equal(runningLoopKey([card({ id: "a" })]), "");
  assert.equal(runningLoopKey([]), "");
});
