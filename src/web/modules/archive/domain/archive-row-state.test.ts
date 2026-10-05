import test from "node:test";
import assert from "node:assert/strict";
import { IDLE_ROW } from "./archive-row-state.js";

void test("IDLE_ROW is neither busy nor failed", () => {
  assert.deepEqual(IDLE_ROW, { busy: false, error: null });
});
