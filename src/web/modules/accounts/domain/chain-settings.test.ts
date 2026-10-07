import assert from "node:assert/strict";
import { test } from "node:test";
import { parseThreshold } from "./chain-settings.js";

test("a whole percent from 50 to 100 parses", () => {
  assert.equal(parseThreshold("50"), 50);
  assert.equal(parseThreshold("85"), 85);
  assert.equal(parseThreshold(" 100 "), 100);
});

test("a value outside the range or not a whole number gives null", () => {
  assert.equal(parseThreshold("49"), null);
  assert.equal(parseThreshold("101"), null);
  assert.equal(parseThreshold(""), null);
  assert.equal(parseThreshold("90.5"), null);
  assert.equal(parseThreshold("-60"), null);
  assert.equal(parseThreshold("abc"), null);
});
