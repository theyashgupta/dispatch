import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCount } from "./format-count.js";

test("formatCount adds thousands separators from 1000", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1,000");
  assert.equal(formatCount(1284), "1,284");
  assert.equal(formatCount(576002), "576,002");
});
