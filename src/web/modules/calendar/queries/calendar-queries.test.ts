import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarKeys,
  calendarStatusQueryOptions,
} from "./calendar-queries.js";

test("calendarKeys has the documented shape", () => {
  assert.deepEqual(calendarKeys.all, ["calendar"]);
  assert.deepEqual(calendarKeys.status, ["calendar", "status"]);
});

test("calendarStatusQueryOptions keys on the calendar status", () => {
  assert.deepEqual(calendarStatusQueryOptions().queryKey, calendarKeys.status);
});
