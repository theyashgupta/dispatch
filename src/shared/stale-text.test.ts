import assert from "node:assert/strict";
import { test } from "node:test";
import { staleText } from "./stale-text.js";

test("the stale text is the spec badge copy with a 24-hour time", () => {
  const at = Date.parse("2026-10-08T12:41:00.000Z");
  assert.equal(staleText(true, at, "UTC"), "Data from 12:41");
  assert.equal(staleText(false, at, "UTC"), null);
  assert.equal(staleText(true, 0, "UTC"), null);
});
