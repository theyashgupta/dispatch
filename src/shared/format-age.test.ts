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

const NOW = Date.parse("2026-09-24T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("formatAge reports seconds under a minute", () => {
  assert.equal(formatAge(ago(0), NOW), "0s ago");
  assert.equal(formatAge(ago(59_999), NOW), "59s ago");
});

test("formatAge reports minutes under an hour", () => {
  assert.equal(formatAge(ago(60_000), NOW), "1m ago");
  assert.equal(formatAge(ago(59 * 60_000), NOW), "59m ago");
});

test("formatAge reports hours under a day", () => {
  assert.equal(formatAge(ago(3_600_000), NOW), "1h ago");
  assert.equal(formatAge(ago(23 * 3_600_000), NOW), "23h ago");
});

test("formatAge reports days from 24 hours", () => {
  assert.equal(formatAge(ago(24 * 3_600_000), NOW), "1d ago");
  assert.equal(formatAge(ago(10 * 24 * 3_600_000), NOW), "10d ago");
});
