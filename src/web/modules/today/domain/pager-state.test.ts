import assert from "node:assert/strict";
import { test } from "node:test";
import { pagerState } from "./pager-state.js";

test("the first page disables Previous only", () => {
  assert.deepEqual(pagerState(1, 3), {
    previousDisabled: true,
    nextDisabled: false,
  });
});

test("a middle page disables neither button", () => {
  assert.deepEqual(pagerState(2, 3), {
    previousDisabled: false,
    nextDisabled: false,
  });
});

test("the last page disables Next only", () => {
  assert.deepEqual(pagerState(3, 3), {
    previousDisabled: false,
    nextDisabled: true,
  });
});

test("a single page disables both buttons", () => {
  assert.deepEqual(pagerState(1, 1), {
    previousDisabled: true,
    nextDisabled: true,
  });
});
