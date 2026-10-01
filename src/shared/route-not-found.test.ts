import { test } from "node:test";
import assert from "node:assert/strict";
import { notFoundTarget } from "./route.js";

test("an unknown page redirects to the board", () => {
  assert.equal(notFoundTarget("/nope"), "/board");
  assert.equal(notFoundTarget("/nope/123"), "/board");
});

test("a raw multi-segment tail becomes one encoded id", () => {
  assert.equal(notFoundTarget("/vault/a/b"), "/vault/a%2Fb");
});

test("a target equal to the incoming path falls back to the board", () => {
  assert.equal(notFoundTarget("/board"), "/board");
  assert.equal(notFoundTarget("/vault/a%2Fb"), "/board");
});

test("the root and an empty path redirect to the board", () => {
  assert.equal(notFoundTarget("/"), "/board");
  assert.equal(notFoundTarget(""), "/board");
});
