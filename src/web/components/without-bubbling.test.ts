import test from "node:test";
import assert from "node:assert/strict";
import type { MouseEvent } from "react";
import { withoutBubbling } from "./without-bubbling.js";

void test("withoutBubbling stops propagation, then runs the action", () => {
  const calls: string[] = [];
  const event = {
    stopPropagation: () => calls.push("stop"),
  } as unknown as MouseEvent;
  withoutBubbling(() => calls.push("run"))(event);
  assert.deepEqual(calls, ["stop", "run"]);
});
