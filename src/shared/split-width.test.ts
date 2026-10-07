import test from "node:test";
import assert from "node:assert/strict";
import { clampSplitWidth } from "./split-width.js";

void test("a missing value gives the default width", () => {
  assert.equal(clampSplitWidth(undefined), 480);
  assert.equal(clampSplitWidth(null), 480);
});

void test("a value that is not a number gives the default width", () => {
  assert.equal(clampSplitWidth("600"), 480);
  assert.equal(clampSplitWidth(Number.NaN), 480);
  assert.equal(clampSplitWidth(Number.POSITIVE_INFINITY), 480);
  assert.equal(clampSplitWidth({ width: 600 }), 480);
});

void test("a value below 320 clamps to 320", () => {
  assert.equal(clampSplitWidth(100), 320);
  assert.equal(clampSplitWidth(-50), 320);
  assert.equal(clampSplitWidth(319.6), 320);
});

void test("a value above 720 clamps to 720", () => {
  assert.equal(clampSplitWidth(721), 720);
  assert.equal(clampSplitWidth(5000), 720);
});

void test("a value inside the range is kept and rounded to whole pixels", () => {
  assert.equal(clampSplitWidth(320), 320);
  assert.equal(clampSplitWidth(600), 600);
  assert.equal(clampSplitWidth(720), 720);
  assert.equal(clampSplitWidth(512.4), 512);
});
