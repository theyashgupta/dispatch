import assert from "node:assert/strict";
import { test } from "node:test";
import { SETUP_STEPS } from "../../../../shared/setup-wizard.js";
import { STEP_TITLE, stepProgress } from "./step-progress.js";

test("the first step is number 1 of 5 with one full segment", () => {
  const progress = stepProgress("welcome");
  assert.equal(progress.stepNumber, 1);
  assert.equal(progress.total, 5);
  assert.deepEqual(
    progress.segments.map((s) => s.value),
    [100, 0, 0, 0, 0],
  );
});

test("the last step fills every segment", () => {
  const progress = stepProgress("finish");
  assert.equal(progress.stepNumber, 5);
  assert.deepEqual(
    progress.segments.map((s) => s.value),
    [100, 100, 100, 100, 100],
  );
});

test("segments follow the step order", () => {
  assert.deepEqual(
    stepProgress("workspace").segments.map((s) => s.step),
    [...SETUP_STEPS],
  );
});

test("every step has the legacy title", () => {
  assert.deepEqual(STEP_TITLE, {
    welcome: "Welcome to Dispatch",
    linear: "Connect Linear",
    sources: "More sources are on the way",
    workspace: "Add a workspace",
    finish: "You're set up",
  });
});
