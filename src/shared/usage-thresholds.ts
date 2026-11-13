export const LIMIT_WINDOW_KINDS = [
  "session",
  "weekly_all",
  "weekly_scoped",
] as const;

export type LimitWindowKind = (typeof LIMIT_WINDOW_KINDS)[number];

export type UsageTone = "ok" | "stale" | "down";

export type LimitSource = "claude" | "threshold";

export interface UsageThresholds {
  warningPercent: number;
  criticalPercent: number;
  limitPercent: Record<LimitWindowKind, number>;
}

export const CLAUDE_LIMIT_PERCENT = 100;

export const DEFAULT_USAGE_THRESHOLDS: UsageThresholds = {
  warningPercent: 70,
  criticalPercent: 90,
  limitPercent: {
    session: CLAUDE_LIMIT_PERCENT,
    weekly_all: CLAUDE_LIMIT_PERCENT,
    weekly_scoped: CLAUDE_LIMIT_PERCENT,
  },
};

const PERCENT_MIN = 1;
const PERCENT_MAX = 100;

export const USAGE_THRESHOLDS_ERRORS = {
  range: `Use whole numbers from ${PERCENT_MIN} to ${PERCENT_MAX}.`,
  order: "Warning must be below critical.",
  limit: "Critical must be at or below every limit.",
} as const;

type Validation =
  | { ok: true; value: UsageThresholds }
  | { ok: false; error: string };

function isPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= PERCENT_MIN &&
    value <= PERCENT_MAX
  );
}

/**
 * Validate a usage thresholds object: whole numbers 1 to 100, warning below critical, critical at or below every limit.
 *
 * @returns The thresholds with only the known keys, or the first rule that fails as a user message.
 */
export function validateUsageThresholds(input: unknown): Validation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: USAGE_THRESHOLDS_ERRORS.range };
  }
  const o = input as Record<string, unknown>;
  const limits = o.limitPercent;
  if (typeof limits !== "object" || limits === null || Array.isArray(limits)) {
    return { ok: false, error: USAGE_THRESHOLDS_ERRORS.range };
  }
  const l = limits as Record<string, unknown>;
  const limitPercent = Object.fromEntries(
    LIMIT_WINDOW_KINDS.map((kind) => [kind, l[kind]]),
  ) as Record<LimitWindowKind, unknown>;
  const { warningPercent, criticalPercent } = o;
  if (
    !isPercent(warningPercent) ||
    !isPercent(criticalPercent) ||
    !LIMIT_WINDOW_KINDS.every((kind) => isPercent(limitPercent[kind]))
  ) {
    return { ok: false, error: USAGE_THRESHOLDS_ERRORS.range };
  }
  if (warningPercent >= criticalPercent) {
    return { ok: false, error: USAGE_THRESHOLDS_ERRORS.order };
  }
  const value: UsageThresholds = {
    warningPercent,
    criticalPercent,
    limitPercent: limitPercent as Record<LimitWindowKind, number>,
  };
  if (
    LIMIT_WINDOW_KINDS.some(
      (kind) => value.limitPercent[kind] < criticalPercent,
    )
  ) {
    return { ok: false, error: USAGE_THRESHOLDS_ERRORS.limit };
  }
  return { ok: true, value };
}

/**
 * Map a used percent to a colour tone: calm below warning, warning below critical, critical from there.
 */
export function toneForPercent(
  percent: number,
  thresholds: Pick<UsageThresholds, "warningPercent" | "criticalPercent">,
): UsageTone {
  if (percent >= thresholds.criticalPercent) return "down";
  if (percent >= thresholds.warningPercent) return "stale";
  return "ok";
}

/**
 * Return the percent at which a window of `kind` counts as limited.
 *
 * @remarks The lower of the window kind's limit and the chain threshold governs, so either setting
 * left at 100 defers to the other. A kind outside the known three uses the chain threshold only.
 */
export function limitPercentFor(
  kind: string,
  thresholds: UsageThresholds,
  chainThresholdPercent: number = CLAUDE_LIMIT_PERCENT,
): number {
  const own = (LIMIT_WINDOW_KINDS as readonly string[]).includes(kind)
    ? thresholds.limitPercent[kind as LimitWindowKind]
    : CLAUDE_LIMIT_PERCENT;
  return Math.min(own, chainThresholdPercent);
}

/**
 * Name who set a limit: Claude when it reported the limit or a window is full, else the user's threshold.
 */
export function limitSourceOf(
  fullWindows: readonly { percent: number }[],
  claudeReported: boolean,
): LimitSource {
  return claudeReported ||
    fullWindows.some((w) => w.percent >= CLAUDE_LIMIT_PERCENT)
    ? "claude"
    : "threshold";
}
