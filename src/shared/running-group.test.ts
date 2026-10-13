import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasLoopProgress,
  isActiveCard,
  isLoopCard,
  isRunningLoopCard,
} from "./running-group.js";
import type { Card, LoopProgress, LoopUnit } from "./types.js";

const group = (over: Partial<Card> = {}): Card =>
  ({ source: "group", column: "in_progress", ...over }) as Card;

test("a group in Done is not a running loop card", () => {
  assert.equal(
    isRunningLoopCard(group({ column: "done", tmuxSession: "dsp-1" })),
    false,
  );
});

test("a ticket with no launch is not a running loop card", () => {
  assert.equal(
    isRunningLoopCard(group({ source: "linear", tmuxSession: "dsp-1" })),
    false,
  );
});

test("a group with a lost session is not a running loop card", () => {
  assert.equal(
    isRunningLoopCard(group({ tmuxSession: "dsp-1", sessionLost: true })),
    false,
  );
});

test("a group with a provisioning step is a running loop card", () => {
  assert.equal(
    isRunningLoopCard(group({ provisioningStep: "worktrees" })),
    true,
  );
});

test("a group with a live session is a running loop card", () => {
  assert.equal(isRunningLoopCard(group({ tmuxSession: "dsp-1" })), true);
});

test("a group with no tmux session is not a running loop card", () => {
  assert.equal(isRunningLoopCard(group()), false);
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

const launched = (over: Partial<Card> = {}): Card =>
  ({
    source: "linear",
    column: "in_progress",
    launch: { direction: "x" },
    ...over,
  }) as Card;

test("a loop card is a group or a ticket with a launch", () => {
  assert.equal(isLoopCard(group()), true);
  assert.equal(isLoopCard(launched()), true);
  assert.equal(isLoopCard(group({ source: "linear" })), false);
});

test("a running loop card is a launched ticket with a live session", () => {
  assert.equal(isRunningLoopCard(launched({ tmuxSession: "dsp-1" })), true);
  assert.equal(
    isRunningLoopCard(launched({ tmuxSession: "dsp-1", column: "done" })),
    false,
  );
  assert.equal(
    isRunningLoopCard(group({ source: "linear", tmuxSession: "dsp-1" })),
    false,
  );
});
