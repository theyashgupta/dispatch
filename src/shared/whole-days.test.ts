import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWholeDays } from "./whole-days.js";

test("parseWholeDays accepts whole numbers from 0 to max, trimming spaces", () => {
  assert.equal(parseWholeDays("0", 90), 0);
  assert.equal(parseWholeDays(" 7 ", 90), 7);
  assert.equal(parseWholeDays("90", 90), 90);
});

test("parseWholeDays rejects empty, fractional, negative, non-numeric and too large input", () => {
  assert.equal(parseWholeDays("", 90), null);
  assert.equal(parseWholeDays("   ", 90), null);
  assert.equal(parseWholeDays("1.5", 90), null);
  assert.equal(parseWholeDays("-1", 90), null);
  assert.equal(parseWholeDays("abc", 90), null);
  assert.equal(parseWholeDays("91", 90), null);
});
