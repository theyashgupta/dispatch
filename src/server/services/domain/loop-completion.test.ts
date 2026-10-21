import test from "node:test";
import assert from "node:assert/strict";
import { loopCompletionOf } from "./loop-completion.js";

const LOCAL_159 =
  "All 7 phases of unit A and unit B are green.\n<promise>RALPH COMPLETE local-159</promise>\nDISPATCH_STATUS: DONE - LOCAL-159 built, awaiting ship";

void test("loopCompletionOf reads the promise and the DONE line of a LOCAL-159 text", () => {
  assert.deepEqual(loopCompletionOf(LOCAL_159, "local-159"), {
    promise: true,
    done: true,
  });
});

void test("loopCompletionOf refuses a promise for another slug", () => {
  assert.deepEqual(loopCompletionOf(LOCAL_159, "local-160"), {
    promise: false,
    done: true,
  });
});

void test("loopCompletionOf refuses a slug that is only a prefix", () => {
  assert.equal(
    loopCompletionOf("<promise>RALPH COMPLETE local-159</promise>", "local-15")
      .promise,
    false,
  );
});

void test("loopCompletionOf tolerates whitespace inside the promise tags", () => {
  assert.equal(
    loopCompletionOf("<promise> RALPH COMPLETE x </promise>", "x").promise,
    true,
  );
});

void test("loopCompletionOf refuses the bare phrase from the loop prompt", () => {
  assert.deepEqual(
    loopCompletionOf(
      "When and only when both units have gate=pass for every phase, output the phrase RALPH COMPLETE local-159 wrapped in promise tags.",
      "local-159",
    ),
    { promise: false, done: false },
  );
});

void test("loopCompletionOf reads a DONE line alone", () => {
  assert.deepEqual(
    loopCompletionOf("⏺ DISPATCH_STATUS: DONE - built", "local-159"),
    { promise: false, done: true },
  );
});

void test("loopCompletionOf reads a DONE line with CRLF line ends", () => {
  assert.equal(
    loopCompletionOf("text\r\nDISPATCH_STATUS: DONE\r\n", "x").done,
    true,
  );
});

void test("loopCompletionOf gives false for null, undefined and empty text", () => {
  const none = { promise: false, done: false };
  assert.deepEqual(loopCompletionOf(null, "local-159"), none);
  assert.deepEqual(loopCompletionOf(undefined, "local-159"), none);
  assert.deepEqual(loopCompletionOf("", "local-159"), none);
});

void test("loopCompletionOf matches a slug with dots only exactly", () => {
  assert.equal(
    loopCompletionOf("<promise>RALPH COMPLETE a.b-c</promise>", "a.b-c")
      .promise,
    true,
  );
  assert.equal(
    loopCompletionOf("<promise>RALPH COMPLETE aXb-c</promise>", "a.b-c")
      .promise,
    false,
  );
});

void test("loopCompletionOf gives false for an empty slug", () => {
  assert.equal(
    loopCompletionOf("<promise>RALPH COMPLETE </promise>", "").promise,
    false,
  );
});
