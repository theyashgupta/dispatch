import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addKeyInputError,
  purposeInputError,
  valueInputError,
} from "./vault-input.js";

test("addKeyInputError refuses a lowercase or leading digit name before the purpose", () => {
  assert.equal(addKeyInputError("qa_lower", "A purpose"), "invalid-name");
  assert.equal(addKeyInputError("1KEY", "A purpose"), "invalid-name");
  assert.equal(addKeyInputError("", ""), "invalid-name");
});

test("addKeyInputError refuses an empty, multi-line or too long purpose", () => {
  assert.equal(addKeyInputError("QA_KEY", ""), "invalid-purpose");
  assert.equal(addKeyInputError("QA_KEY", "a\nb"), "invalid-purpose");
  assert.equal(addKeyInputError("QA_KEY", "x".repeat(201)), "invalid-purpose");
});

test("addKeyInputError accepts an upper snake name with a one line purpose", () => {
  assert.equal(addKeyInputError("QA_DUMMY_TWO", "x".repeat(200)), null);
  assert.equal(addKeyInputError("_PRIVATE", "Purpose"), null);
});

test("purposeInputError refuses a carriage return and accepts a plain line", () => {
  assert.equal(purposeInputError("a\rb"), "invalid-purpose");
  assert.equal(purposeInputError(""), "invalid-purpose");
  assert.equal(purposeInputError("Rotated monthly"), null);
});

test("valueInputError maps empty, multi-line and oversize values to their codes", () => {
  assert.equal(valueInputError(""), "missing-value");
  assert.equal(valueInputError("a\nb"), "invalid-value");
  assert.equal(valueInputError("é".repeat(4097)), "invalid-value");
  assert.equal(valueInputError("x".repeat(8192)), null);
});
