import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnseen } from "./unseen-activity.js";

test("isUnseen is false when the output never changed", () => {
  assert.equal(isUnseen(undefined, undefined), false);
  assert.equal(isUnseen(undefined, "2026-09-24T10:00:00.000Z"), false);
});

test("isUnseen is true when the card was never opened and the output changed", () => {
  assert.equal(isUnseen("2026-09-24T10:00:00.000Z", undefined), true);
});

test("isUnseen is true when the output changed after the last open", () => {
  assert.equal(
    isUnseen("2026-09-24T11:00:00.000Z", "2026-09-24T10:00:00.000Z"),
    true,
  );
});

test("isUnseen is false when the output changed before or at the last open", () => {
  assert.equal(
    isUnseen("2026-09-24T09:00:00.000Z", "2026-09-24T10:00:00.000Z"),
    false,
  );
  assert.equal(
    isUnseen("2026-09-24T10:00:00.000Z", "2026-09-24T10:00:00.000Z"),
    false,
  );
});
