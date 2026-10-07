import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCleanupCountdown } from "./format-cleanup-countdown.js";

const NOW = 1_000_000_000_000;

test("a due or past time reads under a minute", () => {
  assert.equal(formatCleanupCountdown(NOW + 30_000, NOW), "cleans in <1m");
  assert.equal(formatCleanupCountdown(NOW - 60_000, NOW), "cleans in <1m");
});

test("the countdown picks minutes, hours and days", () => {
  assert.equal(formatCleanupCountdown(NOW + 5 * 60_000, NOW), "cleans in 5m");
  assert.equal(
    formatCleanupCountdown(NOW + 3 * 3_600_000, NOW),
    "cleans in 3h",
  );
  assert.equal(
    formatCleanupCountdown(NOW + 2 * 86_400_000, NOW),
    "cleans in 2d",
  );
});

test("a non-finite due time returns empty", () => {
  assert.equal(formatCleanupCountdown(Number.NaN, NOW), "");
});
