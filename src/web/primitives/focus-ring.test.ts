import { test } from "node:test";
import assert from "node:assert/strict";
import { focusRing } from "./focus-ring.js";

test("a focused ring is an outline, never a box-shadow", () => {
  for (const flush of [undefined, false, true]) {
    const ring = focusRing(true, flush);
    assert.equal(ring.outline, "2px solid var(--accent)");
    assert.equal("boxShadow" in ring, false);
  }
});

test("flush drops the offset to zero for clipping ancestors", () => {
  assert.equal(focusRing(true).outlineOffset, "2px");
  assert.equal(focusRing(true, true).outlineOffset, 0);
});

test("an unfocused element carries no outline", () => {
  assert.deepEqual(focusRing(false), { outline: "none", outlineOffset: 0 });
});
