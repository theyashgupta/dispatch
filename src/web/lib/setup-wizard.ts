export const SETUP_STEPS = [
  "welcome",
  "linear",
  "sources",
  "workspace",
  "finish",
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

/** Decides whether the wizard opens on its own: only for a first run, with no Linear key and onboarding not done. */
export function shouldOpenSetupWizard(status: {
  needsKey: boolean;
  onboardingDone: boolean;
}): boolean {
  return status.needsKey && !status.onboardingDone;
}

/**
 * Decides whether a load writes onboardingDone without showing the wizard.
 *
 * @remarks
 * A user who set a key before the flag existed never sees the wizard; without the flag, a later
 * disconnect would open it on boot for a long-time user (changed-decisions R-18).
 */
export function shouldMarkOnboardingDone(status: {
  needsKey: boolean;
  onboardingDone: boolean;
}): boolean {
  return !status.needsKey && !status.onboardingDone;
}

/** Next is held only on the Linear step until Linear is connected. */
export function canGoNext(step: SetupStep, linearConnected: boolean): boolean {
  return step !== "linear" || linearConnected;
}

/** The step Next leads to; it stays put when Next is held or on the last step. */
export function nextStep(step: SetupStep, linearConnected: boolean): SetupStep {
  if (!canGoNext(step, linearConnected)) return step;
  const i = SETUP_STEPS.indexOf(step);
  return SETUP_STEPS[Math.min(i + 1, SETUP_STEPS.length - 1)];
}

/** Skip this connection moves past the Linear step without a connection; other steps stay put. */
export function skipConnection(step: SetupStep): SetupStep {
  return step === "linear" ? nextStep(step, true) : step;
}

/** The step Back leads to; it stays put on the first step. */
export function previousStep(step: SetupStep): SetupStep {
  return SETUP_STEPS[Math.max(SETUP_STEPS.indexOf(step) - 1, 0)];
}
