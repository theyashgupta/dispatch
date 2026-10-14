import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Card } from "../../../../shared/types.js";
import {
  pauseAction,
  pauseFailureCopy,
  pausedNote,
  runClaudeBlocked,
} from "./pause-copy.js";

function card(extra: Partial<Card>): Card {
  return {
    id: "c1",
    boardKey: DEFAULT_BOARD_KEY,
    issueId: "c1",
    identifier: "LOCAL-1",
    title: "A card",
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ...extra,
  };
}

const mark = (by: "memory" | "user") => ({
  at: "2026-10-14T00:00:00.000Z",
  by,
  sessionId: "s1",
  pids: [1],
});

test("each refusal code maps to its copy", () => {
  const status = 409;
  assert.equal(
    pauseFailureCopy({ status, error: "already-paused" }),
    "This loop is already paused.",
  );
  assert.equal(
    pauseFailureCopy({ status, error: "not-paused" }),
    "This loop is not paused.",
  );
  assert.equal(
    pauseFailureCopy({ status, error: "not-pausable", reason: "no session" }),
    "Can't pause: no session.",
  );
  assert.equal(
    pauseFailureCopy({ status, error: "busy" }),
    "Another action is running on this card. Try again.",
  );
  assert.equal(
    pauseFailureCopy({
      status,
      error: "unpause-incomplete",
      reason: "pid gone",
    }),
    "Can't resume: pid gone.",
  );
});

test("a 404 reads as a vanished card and anything else as the network copy", () => {
  assert.equal(
    pauseFailureCopy({ status: 404, error: "unknown card id: c1" }),
    "This card no longer exists.",
  );
  assert.equal(
    pauseFailureCopy({ status: null }),
    "Couldn't reach the server. Try again.",
  );
  assert.equal(
    pauseFailureCopy({ status: 500 }),
    "Couldn't reach the server. Try again.",
  );
});

test("a paused card shows the note of who paused it and a running card none", () => {
  assert.equal(
    pausedNote(card({ paused: mark("memory") })),
    "Paused for memory. Dispatch resumes it when swap falls.",
  );
  assert.equal(
    pausedNote(card({ paused: mark("user") })),
    "Paused. Resume it when you are ready.",
  );
  assert.equal(pausedNote(card({})), null);
  assert.equal(pausedNote(card({ paused: null })), null);
});

test("Pause shows for a loop card with a live session, Resume for a paused card, else neither", () => {
  const live = { tmuxSession: "dispatch-1" };
  assert.equal(pauseAction(card({ source: "group", ...live })), "pause");
  assert.equal(
    pauseAction(card({ launch: { direction: "go" }, ...live })),
    "pause",
  );
  assert.equal(pauseAction(card({ ...live })), null);
  assert.equal(
    pauseAction(card({ source: "group", ...live, sessionLost: true })),
    null,
  );
  assert.equal(pauseAction(card({ source: "group" })), null);
  assert.equal(
    pauseAction(card({ source: "group", ...live, paused: mark("user") })),
    "resume",
  );
});

test("Run Claude is blocked with its title only on a paused card", () => {
  assert.equal(
    runClaudeBlocked(card({ paused: mark("memory") })),
    "Resume the loop first",
  );
  assert.equal(runClaudeBlocked(card({})), null);
});
