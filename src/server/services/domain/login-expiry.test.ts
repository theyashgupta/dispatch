import test from "node:test";
import assert from "node:assert/strict";
import { shouldWarnLoginExpiry } from "./login-expiry.js";

const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number): string => new Date(NOW + ms).toISOString();

void test("an expiry 2 days out with nothing notified warns", () => {
  assert.equal(shouldWarnLoginExpiry(at(2 * DAY), undefined, NOW), true);
});

void test("an expiry equal to the notified value does not warn again", () => {
  assert.equal(shouldWarnLoginExpiry(at(2 * DAY), at(2 * DAY), NOW), false);
});

void test("an expiry that differs from the notified value warns", () => {
  assert.equal(shouldWarnLoginExpiry(at(2 * DAY), at(DAY), NOW), true);
});

void test("an expiry 4 days out does not warn", () => {
  assert.equal(shouldWarnLoginExpiry(at(4 * DAY), undefined, NOW), false);
});

void test("an expiry exactly 3 days out warns", () => {
  assert.equal(shouldWarnLoginExpiry(at(3 * DAY), undefined, NOW), true);
});

void test("an expiry in the past or at now warns", () => {
  assert.equal(shouldWarnLoginExpiry(at(-DAY), undefined, NOW), true);
  assert.equal(shouldWarnLoginExpiry(at(0), undefined, NOW), true);
});

void test("a past expiry equal to the notified value does not warn again", () => {
  assert.equal(shouldWarnLoginExpiry(at(-DAY), at(-DAY), NOW), false);
});

void test("an expiry that is not a date does not warn", () => {
  assert.equal(shouldWarnLoginExpiry("not a date", undefined, NOW), false);
});
