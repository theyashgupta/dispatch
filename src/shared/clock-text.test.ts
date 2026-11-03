import assert from "node:assert/strict";
import { test } from "node:test";
import { clock } from "./clock-text.js";

test("clock keeps a formatter per time zone", () => {
  const iso = "2026-10-08T12:00:00Z";
  assert.equal(clock(iso, "UTC", false), "12:00");
  assert.equal(clock(iso, "Asia/Kolkata", false), "17:30");
  assert.equal(clock(iso, "UTC", false), "12:00");
  assert.equal(clock(iso, "UTC", true), "Thu 12:00");
  assert.equal(clock("garbage", "UTC", false), null);
});
