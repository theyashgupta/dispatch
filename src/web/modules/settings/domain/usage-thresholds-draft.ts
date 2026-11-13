import {
  LIMIT_WINDOW_KINDS,
  USAGE_THRESHOLDS_ERRORS,
  validateUsageThresholds,
  type UsageThresholds,
} from "../../../../shared/usage-thresholds.js";

export const USAGE_THRESHOLD_FIELDS = [
  "warning",
  "critical",
  ...LIMIT_WINDOW_KINDS,
] as const;

export type UsageThresholdField = (typeof USAGE_THRESHOLD_FIELDS)[number];

export type UsageThresholdsDraft = Record<UsageThresholdField, string>;

export const USAGE_THRESHOLDS_EMPTY_ERROR = "Fill in every field.";

/**
 * Turn saved thresholds into the five text fields of the form.
 */
export function usageThresholdsDraftFrom(
  thresholds: UsageThresholds,
): UsageThresholdsDraft {
  return {
    warning: String(thresholds.warningPercent),
    critical: String(thresholds.criticalPercent),
    session: String(thresholds.limitPercent.session),
    weekly_all: String(thresholds.limitPercent.weekly_all),
    weekly_scoped: String(thresholds.limitPercent.weekly_scoped),
  };
}

/**
 * Parse the five text fields into thresholds, or the first message that tells the user what to fix.
 *
 * @remarks Only plain digits count as a number, so "1e2" or "0x10" fail with the range message
 * instead of turning into a value the user did not type.
 */
export function parseUsageThresholdsDraft(
  draft: UsageThresholdsDraft,
): { ok: true; value: UsageThresholds } | { ok: false; error: string } {
  const texts = USAGE_THRESHOLD_FIELDS.map((field) => draft[field].trim());
  if (texts.some((text) => text === "")) {
    return { ok: false, error: USAGE_THRESHOLDS_EMPTY_ERROR };
  }
  if (!texts.every((text) => /^\d+$/.test(text))) {
    return { ok: false, error: USAGE_THRESHOLDS_ERRORS.range };
  }
  const [warning, critical, session, weeklyAll, weeklyScoped] =
    texts.map(Number);
  return validateUsageThresholds({
    warningPercent: warning,
    criticalPercent: critical,
    limitPercent: {
      session,
      weekly_all: weeklyAll,
      weekly_scoped: weeklyScoped,
    },
  });
}
