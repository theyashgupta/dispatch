import {
  SETUP_STEPS,
  type SetupStep,
} from "../../../../shared/setup-wizard.js";

export const STEP_TITLE: Record<SetupStep, string> = {
  welcome: "Welcome to Dispatch",
  linear: "Connect Linear",
  sources: "More sources are on the way",
  workspace: "Add a workspace",
  finish: "You're set up",
};

export interface StepProgress {
  stepNumber: number;
  total: number;
  segments: { step: SetupStep; value: number }[];
}

/**
 * Describe the wizard's position.
 *
 * @remarks
 * The result holds the one-based step number, the step count and one progress value per step. A
 * segment is full (100) when its index is below the step number and empty (0) otherwise, so the
 * current step's own segment stays empty, as the legacy bar drew it.
 */
export function stepProgress(step: SetupStep): StepProgress {
  const stepNumber = SETUP_STEPS.indexOf(step) + 1;
  return {
    stepNumber,
    total: SETUP_STEPS.length,
    segments: SETUP_STEPS.map((s, i) => ({
      step: s,
      value: i < stepNumber ? 100 : 0,
    })),
  };
}
