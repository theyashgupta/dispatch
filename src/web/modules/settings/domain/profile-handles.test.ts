import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHandles, parseHandles } from "./profile-handles.js";

test("parseHandles splits on commas and trims each handle", () => {
  assert.deepEqual(parseHandles(" yash ,  @theyashgupta,yg "), [
    "yash",
    "@theyashgupta",
    "yg",
  ]);
});

test("parseHandles drops empty entries", () => {
  assert.deepEqual(parseHandles("a,, ,b,"), ["a", "b"]);
});

test("parseHandles de-duplicates and keeps the first order", () => {
  assert.deepEqual(parseHandles("b, a, b, c, a"), ["b", "a", "c"]);
});

test("parseHandles returns an empty list for empty or blank input", () => {
  assert.deepEqual(parseHandles(""), []);
  assert.deepEqual(parseHandles("  ,  "), []);
});

test("formatHandles joins with a comma and a space", () => {
  assert.equal(formatHandles(["a", "b", "c"]), "a, b, c");
  assert.equal(formatHandles([]), "");
});

test("formatHandles output parses back to the same list", () => {
  const list = ["yash", "@theyashgupta"];
  assert.deepEqual(parseHandles(formatHandles(list)), list);
});
