import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCount } from "./p0-preferences.js";
import { parseRange } from "./today-view.js";

test("parseCount falls back to 3 for a missing or invalid value", () => {
  assert.equal(parseCount(null), 3);
  assert.equal(parseCount(""), 3);
  assert.equal(parseCount("abc"), 3);
  assert.equal(parseCount("NaN"), 3);
});

test("parseCount clamps an out-of-range value to 3 to 5 and keeps a valid one", () => {
  assert.equal(parseCount("0"), 3);
  assert.equal(parseCount("-4"), 3);
  assert.equal(parseCount("2"), 3);
  assert.equal(parseCount("6"), 5);
  assert.equal(parseCount("99"), 5);
  assert.equal(parseCount("4"), 4);
  assert.equal(parseCount("5"), 5);
});

test("parseRange falls back to today for a missing, invalid or unknown value", () => {
  assert.equal(parseRange(null), "today");
  assert.equal(parseRange(""), "today");
  assert.equal(parseRange("month"), "today");
  assert.equal(parseRange("WEEK"), "today");
  assert.equal(parseRange("week"), "week");
});
