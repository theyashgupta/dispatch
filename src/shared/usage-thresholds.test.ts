import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_USAGE_THRESHOLDS,
  USAGE_THRESHOLDS_ERRORS,
  limitPercentFor,
  limitSourceOf,
  toneForPercent,
  validateUsageThresholds,
  type UsageThresholds,
} from "./usage-thresholds.js";

const custom: UsageThresholds = {
  warningPercent: 60,
  criticalPercent: 80,
  limitPercent: { session: 100, weekly_all: 85, weekly_scoped: 90 },
};

test("the defaults keep today's numbers: warn 70, critical 90, Claude's limit", () => {
  assert.deepEqual(DEFAULT_USAGE_THRESHOLDS, {
    warningPercent: 70,
    criticalPercent: 90,
    limitPercent: { session: 100, weekly_all: 100, weekly_scoped: 100 },
  });
});

test("toneForPercent follows the default and custom numbers at each edge", () => {
  const d = DEFAULT_USAGE_THRESHOLDS;
  assert.equal(toneForPercent(69, d), "ok");
  assert.equal(toneForPercent(70, d), "stale");
  assert.equal(toneForPercent(89, d), "stale");
  assert.equal(toneForPercent(90, d), "down");
  assert.equal(toneForPercent(59, custom), "ok");
  assert.equal(toneForPercent(60, custom), "stale");
  assert.equal(toneForPercent(79, custom), "stale");
  assert.equal(toneForPercent(80, custom), "down");
});

test("limitPercentFor takes the lower of the kind limit and the chain threshold", () => {
  assert.equal(limitPercentFor("weekly_all", custom), 85);
  assert.equal(limitPercentFor("weekly_all", custom, 80), 80);
  assert.equal(limitPercentFor("session", custom, 95), 95);
  assert.equal(limitPercentFor("other_kind", custom), 100);
  assert.equal(limitPercentFor("other_kind", custom, 90), 90);
});

test("limitSourceOf names Claude for a report or a full window, else the threshold", () => {
  assert.equal(limitSourceOf([{ percent: 86 }], false), "threshold");
  assert.equal(
    limitSourceOf([{ percent: 86 }, { percent: 100 }], false),
    "claude",
  );
  assert.equal(limitSourceOf([], true), "claude");
});

test("validateUsageThresholds accepts valid numbers and keeps only known keys", () => {
  const result = validateUsageThresholds({
    ...custom,
    extra: 1,
    limitPercent: { ...custom.limitPercent, other: 5 },
  });
  assert.deepEqual(result, { ok: true, value: custom });
  assert.deepEqual(validateUsageThresholds(DEFAULT_USAGE_THRESHOLDS), {
    ok: true,
    value: DEFAULT_USAGE_THRESHOLDS,
  });
});

test("validateUsageThresholds refuses each broken rule with its message", () => {
  const cases: [unknown, string][] = [
    [null, USAGE_THRESHOLDS_ERRORS.range],
    [{ ...custom, limitPercent: null }, USAGE_THRESHOLDS_ERRORS.range],
    [{ ...custom, warningPercent: 0 }, USAGE_THRESHOLDS_ERRORS.range],
    [{ ...custom, criticalPercent: 101 }, USAGE_THRESHOLDS_ERRORS.range],
    [{ ...custom, warningPercent: 60.5 }, USAGE_THRESHOLDS_ERRORS.range],
    [{ ...custom, warningPercent: "60" }, USAGE_THRESHOLDS_ERRORS.range],
    [
      { ...custom, limitPercent: { session: 100, weekly_all: 85 } },
      USAGE_THRESHOLDS_ERRORS.range,
    ],
    [{ ...custom, warningPercent: 80 }, USAGE_THRESHOLDS_ERRORS.order],
    [{ ...custom, warningPercent: 81 }, USAGE_THRESHOLDS_ERRORS.order],
    [
      { ...custom, limitPercent: { ...custom.limitPercent, session: 79 } },
      USAGE_THRESHOLDS_ERRORS.limit,
    ],
  ];
  for (const [input, error] of cases) {
    assert.deepEqual(validateUsageThresholds(input), { ok: false, error });
  }
  assert.equal(
    validateUsageThresholds({
      ...custom,
      limitPercent: { ...custom.limitPercent, session: 80 },
    }).ok,
    true,
  );
});
