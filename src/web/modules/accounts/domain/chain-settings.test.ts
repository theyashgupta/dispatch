import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHysteresis, parseThreshold } from "./chain-settings.js";

test("a whole percent from 50 to 100 parses", () => {
  assert.equal(parseThreshold("50", 10), 50);
  assert.equal(parseThreshold("85", 10), 85);
  assert.equal(parseThreshold(" 100 ", 10), 100);
});

test("a value outside the range or not a whole number gives null", () => {
  assert.equal(parseThreshold("49", 10), null);
  assert.equal(parseThreshold("101", 10), null);
  assert.equal(parseThreshold("", 10), null);
  assert.equal(parseThreshold("90.5", 10), null);
  assert.equal(parseThreshold("-60", 10), null);
  assert.equal(parseThreshold("abc", 10), null);
});

test("a threshold at or below the saved hysteresis gives null", () => {
  assert.equal(parseThreshold("50", 50), null);
  assert.equal(parseThreshold("51", 50), 51);
});

test("a whole number of points from 0 to 50 parses as hysteresis", () => {
  assert.equal(parseHysteresis("0", 100), 0);
  assert.equal(parseHysteresis("50", 100), 50);
  assert.equal(parseHysteresis("10", 100), 10);
  assert.equal(parseHysteresis(" 10 ", 100), 10);
});

test("a hysteresis outside the range or not a whole number gives null", () => {
  assert.equal(parseHysteresis("51", 100), null);
  assert.equal(parseHysteresis("-1", 100), null);
  assert.equal(parseHysteresis("10.5", 100), null);
  assert.equal(parseHysteresis("", 100), null);
  assert.equal(parseHysteresis("abc", 100), null);
});

test("a hysteresis at or above the current threshold gives null", () => {
  assert.equal(parseHysteresis("50", 50), null);
  assert.equal(parseHysteresis("49", 50), 49);
  assert.equal(parseHysteresis("10", 10), null);
});
