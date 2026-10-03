import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCleanupDelay } from "./cleanup-delay.js";

void test("a whole number in range parses", () => {
  assert.equal(parseCleanupDelay("0"), 0);
  assert.equal(parseCleanupDelay(" 7 "), 7);
  assert.equal(parseCleanupDelay("90"), 90);
});

void test("blank, fractional, negative and out of range input is invalid", () => {
  for (const text of ["", "  ", "1.5", "-1", "91", "abc"]) {
    assert.equal(parseCleanupDelay(text), null);
  }
});
