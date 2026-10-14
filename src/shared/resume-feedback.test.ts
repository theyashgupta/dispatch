import assert from "node:assert/strict";
import { test } from "node:test";
import { RESUME_WATCHDOG_MS, resumeFailureCopy } from "./resume-feedback.js";

test("resumeFailureCopy shows the server resumeError verbatim first", () => {
  assert.equal(
    resumeFailureCopy("Worktree is gone", { status: 409 }),
    "Worktree is gone",
  );
  assert.equal(resumeFailureCopy("", null), "");
});

test("resumeFailureCopy gives the conflict copy for a 409 without a server error", () => {
  assert.equal(
    resumeFailureCopy(null, { status: 409 }),
    "Resume was rejected. The session may already be starting. Wait a moment and try Resume again.",
  );
});

test("resumeFailureCopy names the reason of a 409 memory-pressure refusal", () => {
  assert.equal(
    resumeFailureCopy(null, {
      status: 409,
      error: "memory-pressure",
      reason: "swap is full",
    }),
    "Not enough memory to resume: swap is full. Try again after a loop finishes.",
  );
  assert.equal(
    resumeFailureCopy(null, { status: 409, error: "memory-pressure" }),
    "Not enough memory to resume: memory is low. Try again after a loop finishes.",
  );
});

test("resumeFailureCopy lets a memory refusal win over a stale resumeError", () => {
  assert.equal(
    resumeFailureCopy("Worktree is gone", {
      status: 409,
      error: "memory-pressure",
      reason: "swap is full",
    }),
    "Not enough memory to resume: swap is full. Try again after a loop finishes.",
  );
});

test("resumeFailureCopy keeps the conflict copy for another 409 code and lets resumeError win", () => {
  assert.equal(
    resumeFailureCopy(null, { status: 409, error: "starting" }),
    "Resume was rejected. The session may already be starting. Wait a moment and try Resume again.",
  );
  assert.equal(
    resumeFailureCopy("Worktree is gone", { status: 409, error: "starting" }),
    "Worktree is gone",
  );
});

test("resumeFailureCopy gives the neutral copy for any other failure", () => {
  const neutral =
    "Resume didn't go through. Try Resume again, or use Restart to begin a fresh session in the same branch.";
  assert.equal(resumeFailureCopy(undefined, null), neutral);
  assert.equal(resumeFailureCopy(null, { status: 500 }), neutral);
});

test("the resume watchdog waits 30 seconds", () => {
  assert.equal(RESUME_WATCHDOG_MS, 30000);
});
