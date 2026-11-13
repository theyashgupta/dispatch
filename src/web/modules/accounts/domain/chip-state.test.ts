import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeUsageSnapshot } from "../../../../shared/types.js";
import { DEFAULT_USAGE_THRESHOLDS } from "../../../../shared/usage-thresholds.js";
import { chipState } from "./usage-format.js";

const snapshot = (
  status: ClaudeUsageSnapshot["status"],
): ClaudeUsageSnapshot => ({
  status,
  windows: [
    {
      kind: "session",
      label: "Session",
      percent: 95,
      resetsAt: null,
      isActive: true,
      periodStart: null,
      periodEnd: null,
    },
  ],
  fetchedAt: "2026-10-02T09:00:00Z",
});

void test("chipState shows the status copy in the stale tone for error, rate-limited and stale, ignoring the windows", () => {
  for (const [status, copy] of [
    ["error", "Usage could not be fetched"],
    ["rate-limited", "Usage rate limited, try again later"],
    ["stale", "Usage stale, refreshes on the next session"],
  ] as const) {
    assert.deepEqual(chipState(snapshot(status), DEFAULT_USAGE_THRESHOLDS), {
      tone: "stale",
      summary: copy,
      label: copy,
    });
  }
});

void test("chipState colours the tightest window by custom warning 60 and critical 80", () => {
  const custom = {
    ...DEFAULT_USAGE_THRESHOLDS,
    warningPercent: 60,
    criticalPercent: 80,
  };
  const toneAt = (percent: number) =>
    chipState(
      {
        ...snapshot("ok"),
        windows: [{ ...snapshot("ok").windows[0], percent }],
      },
      custom,
    ).tone;
  assert.deepEqual([59, 60, 79, 80].map(toneAt), [
    "ok",
    "stale",
    "stale",
    "down",
  ]);
  assert.equal(
    chipState({
      ...snapshot("ok"),
      windows: [{ ...snapshot("ok").windows[0], percent: 79 }],
    }).tone,
    "stale",
  );
});
