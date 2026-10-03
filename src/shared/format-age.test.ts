import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAge, nowMs } from "./format-age.js";

test("nowMs reads the current epoch milliseconds", () => {
  const before = Date.now();
  const read = nowMs();
  assert.ok(read >= before && read <= Date.now());
});

test("formatAge picks seconds, minutes, hours and days", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  assert.equal(formatAge("2026-01-10T11:59:30Z", now), "30s ago");
  assert.equal(formatAge("2026-01-10T11:55:00Z", now), "5m ago");
  assert.equal(formatAge("2026-01-10T09:00:00Z", now), "3h ago");
  assert.equal(formatAge("2026-01-07T12:00:00Z", now), "3d ago");
});

test("formatAge clamps a future time to 0s and returns empty for an unparseable one", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  assert.equal(formatAge("2026-01-10T12:00:10Z", now), "0s ago");
  assert.equal(formatAge("not a date", now), "");
});
