import assert from "node:assert/strict";
import { test } from "node:test";
import { CAROUSEL_QUERY, NARROW_QUERY } from "./media-queries.js";

test("the carousel query switches at 1023px", () => {
  assert.equal(CAROUSEL_QUERY, "(max-width: 1023px)");
});

test("the narrow query switches at 767px", () => {
  assert.equal(NARROW_QUERY, "(max-width: 767px)");
});
