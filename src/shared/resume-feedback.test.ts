import assert from "node:assert/strict";
import { test } from "node:test";
import { RESUME_WATCHDOG_MS, resumeFailureCopy } from "./resume-feedback.js";

test("resumeFailureCopy shows the server resumeError verbatim first", () => {
  assert.equal(resumeFailureCopy("Worktree is gone", 409), "Worktree is gone");
  assert.equal(resumeFailureCopy("", null), "");
});

test("resumeFailureCopy gives the conflict copy for a 409 without a server error", () => {
  assert.equal(
    resumeFailureCopy(null, 409),
    "Resume was rejected. The session may already be starting. Wait a moment and try Resume again.",
  );
});

test("resumeFailureCopy gives the neutral copy for any other failure", () => {
  const neutral =
    "Resume didn't go through. Try Resume again, or use Restart to begin a fresh session in the same branch.";
  assert.equal(resumeFailureCopy(undefined, null), neutral);
  assert.equal(resumeFailureCopy(null, 500), neutral);
});

test("the resume watchdog waits 30 seconds", () => {
  assert.equal(RESUME_WATCHDOG_MS, 30000);
});
