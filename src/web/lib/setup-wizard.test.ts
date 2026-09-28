import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SETUP_STEPS,
  canGoNext,
  nextStep,
  previousStep,
  shouldMarkOnboardingDone,
  shouldOpenSetupWizard,
  skipConnection,
} from "./setup-wizard.js";

test("the wizard opens only with no key and onboarding not done", () => {
  assert.equal(
    shouldOpenSetupWizard({ needsKey: true, onboardingDone: false }),
    true,
  );
  assert.equal(
    shouldOpenSetupWizard({ needsKey: true, onboardingDone: true }),
    false,
  );
  assert.equal(
    shouldOpenSetupWizard({ needsKey: false, onboardingDone: false }),
    false,
  );
  assert.equal(
    shouldOpenSetupWizard({ needsKey: false, onboardingDone: true }),
    false,
  );
});

test("a load marks onboarding done only with a key and no flag", () => {
  assert.equal(
    shouldMarkOnboardingDone({ needsKey: false, onboardingDone: false }),
    true,
  );
  assert.equal(
    shouldMarkOnboardingDone({ needsKey: false, onboardingDone: true }),
    false,
  );
  assert.equal(
    shouldMarkOnboardingDone({ needsKey: true, onboardingDone: false }),
    false,
  );
  assert.equal(
    shouldMarkOnboardingDone({ needsKey: true, onboardingDone: true }),
    false,
  );
});

test("steps run Welcome, Linear, More sources, Workspace, Finish", () => {
  assert.deepEqual(SETUP_STEPS, [
    "welcome",
    "linear",
    "sources",
    "workspace",
    "finish",
  ]);
  assert.equal(nextStep("welcome", false), "linear");
  assert.equal(nextStep("linear", true), "sources");
  assert.equal(nextStep("sources", false), "workspace");
  assert.equal(nextStep("workspace", false), "finish");
  assert.equal(previousStep("finish"), "workspace");
  assert.equal(previousStep("workspace"), "sources");
  assert.equal(previousStep("sources"), "linear");
  assert.equal(previousStep("linear"), "welcome");
});

test("Next is held on the Linear step only while Linear is not connected", () => {
  for (const step of SETUP_STEPS) {
    assert.equal(canGoNext(step, false), step !== "linear", step);
    assert.equal(canGoNext(step, true), true, step);
  }
  assert.equal(nextStep("linear", false), "linear");
});

test("Skip this connection moves past Linear and does nothing elsewhere", () => {
  assert.equal(skipConnection("linear"), "sources");
  for (const step of SETUP_STEPS.filter((s) => s !== "linear")) {
    assert.equal(skipConnection(step), step);
  }
});

test("Back never moves before Welcome and Next never moves past Finish", () => {
  assert.equal(previousStep("welcome"), "welcome");
  assert.equal(nextStep("finish", true), "finish");
  assert.equal(nextStep("finish", false), "finish");
});
