import test from "node:test";
import assert from "node:assert/strict";
import type { ClaudeUsageSnapshot } from "../../../../shared/types.js";
import { DEFAULT_USAGE_THRESHOLDS } from "../../../../shared/usage-thresholds.js";
import { chipState, compactPercent } from "./usage-format.js";

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
      compactLabel: "",
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

const atPercent = (percent: number): ClaudeUsageSnapshot => ({
  ...snapshot("ok"),
  windows: [{ ...snapshot("ok").windows[0], percent }],
});

void test("compactPercent keeps two digits and shows 99+ from three digits", () => {
  assert.deepEqual([0, 7, 75, 99, 99.4, 99.5, 100, 140].map(compactPercent), [
    "0",
    "7",
    "75",
    "99",
    "99",
    "99+",
    "99+",
    "99+",
  ]);
});

void test("chipState gives the collapsed rail the compact percent next to the full label", () => {
  const chip = chipState(atPercent(75), DEFAULT_USAGE_THRESHOLDS);
  assert.equal(chip.label, "75%");
  assert.equal(chip.compactLabel, "75");
  assert.equal(chip.tone, "stale");
});

void test("chipState shows 99+ at the Claude limit of 100 and 95 at a user limit of 95, both in the critical tone", () => {
  const thresholdLimit = {
    ...DEFAULT_USAGE_THRESHOLDS,
    limitPercent: { ...DEFAULT_USAGE_THRESHOLDS.limitPercent, session: 95 },
  };
  assert.deepEqual(
    [
      chipState(atPercent(100), DEFAULT_USAGE_THRESHOLDS),
      chipState(atPercent(95), thresholdLimit),
    ].map(({ compactLabel, tone }) => ({ compactLabel, tone })),
    [
      { compactLabel: "99+", tone: "down" },
      { compactLabel: "95", tone: "down" },
    ],
  );
});

void test("chipState has no compact label for unavailable usage, so the rail shows only the muted dot", () => {
  const chip = chipState(
    { status: "unavailable", windows: [], fetchedAt: null },
    DEFAULT_USAGE_THRESHOLDS,
  );
  assert.equal(chip.compactLabel, "");
  assert.equal(chip.tone, "muted");
});
