import assert from "node:assert/strict";
import { test } from "node:test";
import {
  permissionErrorCode,
  permissionFromStatus,
} from "./calendar-permission.js";

test("M1: permissionFromStatus maps 0 to 4 to their states and anything else to unknown", () => {
  const table: [number | null, string][] = [
    [0, "not-asked"],
    [1, "restricted"],
    [2, "denied"],
    [3, "granted"],
    [4, "write-only"],
    [5, "unknown"],
    [-1, "unknown"],
    [null, "unknown"],
  ];
  for (const [raw, permission] of table) {
    assert.equal(permissionFromStatus(raw), permission, String(raw));
  }
});

test("M2: permissionErrorCode gives calendar-denied for denied and the same name for the rest", () => {
  assert.equal(permissionErrorCode("denied"), "calendar-denied");
  for (const permission of [
    "not-asked",
    "restricted",
    "write-only",
    "prompt-timeout",
    "read-timeout",
    "unknown",
  ] as const) {
    assert.equal(permissionErrorCode(permission), permission);
  }
});
