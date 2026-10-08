import assert from "node:assert/strict";
import { test } from "node:test";
import { chainStateBadge, moveReasonLabel } from "./chain-state.js";

test("each chain state has a label and a tone", () => {
  assert.deepEqual(chainStateBadge("available"), {
    label: "Available",
    tone: "success",
  });
  assert.deepEqual(chainStateBadge("near-limit"), {
    label: "Near limit",
    tone: "warning",
  });
  assert.deepEqual(chainStateBadge("limited"), {
    label: "Limited",
    tone: "danger",
  });
  assert.deepEqual(chainStateBadge("login-expired"), {
    label: "Login expired",
    tone: "danger",
  });
  assert.deepEqual(chainStateBadge("unknown"), {
    label: "Unknown",
    tone: "neutral",
  });
});

test("a move reason reads in words", () => {
  assert.equal(moveReasonLabel("switch-now"), "Switched now");
  assert.equal(moveReasonLabel("reset"), "After a reset");
  assert.equal(moveReasonLabel("usage at the threshold"), "Usage limit");
});
