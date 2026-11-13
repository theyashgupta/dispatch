import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_USAGE_THRESHOLDS,
  USAGE_THRESHOLDS_ERRORS,
} from "../../../../shared/usage-thresholds.js";
import {
  USAGE_THRESHOLDS_EMPTY_ERROR,
  parseUsageThresholdsDraft,
  usageThresholdsDraftFrom,
  type UsageThresholdsDraft,
} from "./usage-thresholds-draft.js";

const defaults = usageThresholdsDraftFrom(DEFAULT_USAGE_THRESHOLDS);

const withField = (patch: Partial<UsageThresholdsDraft>) => ({
  ...defaults,
  ...patch,
});

void test("the defaults round trip through the draft", () => {
  assert.deepEqual(defaults, {
    warning: "70",
    critical: "90",
    session: "100",
    weekly_all: "100",
    weekly_scoped: "100",
  });
  assert.deepEqual(parseUsageThresholdsDraft(defaults), {
    ok: true,
    value: DEFAULT_USAGE_THRESHOLDS,
  });
});

void test("custom values parse with surrounding spaces", () => {
  assert.deepEqual(
    parseUsageThresholdsDraft({
      warning: " 50 ",
      critical: "80",
      session: "95",
      weekly_all: "85",
      weekly_scoped: "80",
    }),
    {
      ok: true,
      value: {
        warningPercent: 50,
        criticalPercent: 80,
        limitPercent: { session: 95, weekly_all: 85, weekly_scoped: 80 },
      },
    },
  );
});

void test("an empty field asks to fill in every field", () => {
  for (const field of Object.keys(defaults)) {
    assert.deepEqual(parseUsageThresholdsDraft(withField({ [field]: " " })), {
      ok: false,
      error: USAGE_THRESHOLDS_EMPTY_ERROR,
    });
  }
});

void test("a non number, a fraction or an out of range value fails the range rule", () => {
  for (const text of ["abc", "1.5", "-1", "1e2", "0x10", "0", "101"]) {
    assert.deepEqual(parseUsageThresholdsDraft(withField({ critical: text })), {
      ok: false,
      error: USAGE_THRESHOLDS_ERRORS.range,
    });
  }
});

void test("warning at or above critical fails the order rule", () => {
  assert.deepEqual(parseUsageThresholdsDraft(withField({ warning: "90" })), {
    ok: false,
    error: USAGE_THRESHOLDS_ERRORS.order,
  });
});

void test("a limit below critical fails the limit rule", () => {
  assert.deepEqual(
    parseUsageThresholdsDraft(withField({ weekly_scoped: "85" })),
    { ok: false, error: USAGE_THRESHOLDS_ERRORS.limit },
  );
});
