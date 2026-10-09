import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasLoopProgress,
  isActiveCard,
  isRunningGroup,
} from "./running-group.js";
import type { Card, LoopProgress, LoopUnit } from "./types.js";

const group = (over: Partial<Card> = {}): Card =>
  ({ source: "group", column: "in_progress", ...over }) as Card;

test("a group in Done is not running", () => {
  assert.equal(
    isRunningGroup(group({ column: "done", tmuxSession: "dsp-1" })),
    false,
  );
});

test("a ticket is not a running group", () => {
  assert.equal(
    isRunningGroup(group({ source: "linear", tmuxSession: "dsp-1" })),
    false,
  );
});

test("a group with a lost session is not running", () => {
  assert.equal(
    isRunningGroup(group({ tmuxSession: "dsp-1", sessionLost: true })),
    false,
  );
});

test("a group with a provisioning step is running", () => {
  assert.equal(isRunningGroup(group({ provisioningStep: "worktrees" })), true);
});

test("a group with a live session is running", () => {
  assert.equal(isRunningGroup(group({ tmuxSession: "dsp-1" })), true);
});

test("a group with no tmux session is not running", () => {
  assert.equal(isRunningGroup(group()), false);
});

test("loop progress counts only with at least one unit", () => {
  const loop = (units: LoopUnit[]) => ({ units }) as LoopProgress;
  assert.equal(hasLoopProgress(group()), false);
  assert.equal(hasLoopProgress(group({ loopProgress: loop([]) })), false);
  assert.equal(
    hasLoopProgress(group({ loopProgress: loop([{} as LoopUnit]) })),
    true,
  );
});

test("an active card is not Done and has a live session or a provisioning step", () => {
  assert.equal(isActiveCard(group({ tmuxSession: "dsp-1" })), true);
  assert.equal(isActiveCard(group({ provisioningStep: "worktrees" })), true);
  assert.equal(isActiveCard(group()), false);
  assert.equal(
    isActiveCard(group({ column: "done", tmuxSession: "dsp-1" })),
    false,
  );
  assert.equal(
    isActiveCard(group({ source: "linear", tmuxSession: "dsp-1" })),
    true,
  );
});
