import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicateName } from "./playbook-names.js";

test("no collision appends one copy suffix", () => {
  assert.equal(duplicateName(["Review", "Deploy"], "Review"), "Review copy");
});

test("one collision appends the suffix again", () => {
  assert.equal(
    duplicateName(["Review", "Review copy"], "Review"),
    "Review copy copy",
  );
});

test("two collisions append the suffix a third time", () => {
  assert.equal(
    duplicateName(["Review", "Review copy", "Review copy copy"], "Review"),
    "Review copy copy copy",
  );
});

test("the result never equals an existing name", () => {
  const existing = ["A", "A copy", "A copy copy", "B"];
  assert.equal(existing.includes(duplicateName(existing, "A")), false);
});

test("collisions are case-insensitive, matching the server", () => {
  assert.equal(
    duplicateName(["Review", "Review COPY"], "Review"),
    "Review copy copy",
  );
});

test("a long name is trimmed so the result fits the 80-character limit", () => {
  const long = "x".repeat(90);
  const result = duplicateName([], long);
  assert.equal(result.length <= 80, true);
  assert.equal(result.endsWith(" copy"), true);
  const second = duplicateName([result], long);
  assert.equal(second.length <= 80, true);
  assert.notEqual(second.toLowerCase(), result.toLowerCase());
});
