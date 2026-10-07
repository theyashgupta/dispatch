import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCountdown, formatTimeLeft } from "./countdown-format.js";

const now = Date.parse("2026-01-01T00:00:00.000Z");
const at = (ms: number) => new Date(now + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("minutes", () => {
  assert.equal(formatCountdown(at(5 * MIN), now), "Resets in 5 min");
  assert.equal(formatCountdown(at(59 * MIN + 59_000), now), "Resets in 59 min");
});

test("under a minute", () => {
  assert.equal(formatCountdown(at(30_000), now), "Resets in under a minute");
  assert.equal(formatCountdown(at(1), now), "Resets in under a minute");
});

test("hours and minutes", () => {
  assert.equal(
    formatCountdown(at(2 * HOUR + 14 * MIN), now),
    "Resets in 2 h 14 min",
  );
  assert.equal(formatCountdown(at(3 * HOUR), now), "Resets in 3 h");
});

test("days and hours", () => {
  assert.equal(
    formatCountdown(at(3 * DAY + 4 * HOUR), now),
    "Resets in 3 d 4 h",
  );
  assert.equal(formatCountdown(at(2 * DAY + 20 * MIN), now), "Resets in 2 d");
});

test("a past, current, missing or unreadable instant gives null", () => {
  assert.equal(formatCountdown(at(-MIN), now), null);
  assert.equal(formatCountdown(at(0), now), null);
  assert.equal(formatCountdown(null, now), null);
  assert.equal(formatCountdown("not a date", now), null);
});

test("the bare time left carries no prefix", () => {
  assert.equal(formatTimeLeft(at(HOUR + MIN), now), "1 h 1 min");
  assert.equal(formatTimeLeft(null, now), null);
});
