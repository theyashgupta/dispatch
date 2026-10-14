import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryRefusalCopy, startRefusalText } from "./memory-refusal.js";

test("each subject reads into the sentence with the reason", () => {
  assert.equal(
    memoryRefusalCopy("start", "swap is full"),
    "Not enough memory to start: swap is full. Try again after a loop finishes.",
  );
  assert.equal(
    memoryRefusalCopy("start the group", "swap is full"),
    "Not enough memory to start the group: swap is full. Try again after a loop finishes.",
  );
  assert.equal(
    memoryRefusalCopy("resume", "swap is full"),
    "Not enough memory to resume: swap is full. Try again after a loop finishes.",
  );
});

test("a missing or empty reason falls back to memory is low", () => {
  const expected =
    "Not enough memory to start: memory is low. Try again after a loop finishes.";
  assert.equal(memoryRefusalCopy("start", undefined), expected);
  assert.equal(memoryRefusalCopy("start", ""), expected);
});

test("a refused start reads as the memory sentence for the memory variant and the server text otherwise", () => {
  assert.equal(
    startRefusalText({ error: "swap is full", variant: "memory" }),
    "Not enough memory to start: swap is full. Try again after a loop finishes.",
  );
  assert.equal(
    startRefusalText({ error: "repo gone", variant: "config" }),
    "repo gone",
  );
  assert.equal(startRefusalText({ error: "plain" }), "plain");
});
