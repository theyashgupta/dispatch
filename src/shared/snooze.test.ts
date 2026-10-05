process.env.TZ = "America/New_York";

import assert from "node:assert/strict";
import { test } from "node:test";
import { snoozeUntil, wakeItems } from "./snooze.js";

const tuesday = new Date(2026, 8, 22, 14, 30);

test("1h and 4h add exactly 60 and 240 minutes", () => {
  assert.equal(
    snoozeUntil("1h", tuesday).getTime() - tuesday.getTime(),
    60 * 60_000,
  );
  assert.equal(
    snoozeUntil("4h", tuesday).getTime() - tuesday.getTime(),
    240 * 60_000,
  );
});

test("tomorrow is the next calendar day at 09:00 local, also from 23:50", () => {
  const t = snoozeUntil("tomorrow", tuesday);
  assert.deepEqual([t.getDate(), t.getHours(), t.getMinutes()], [23, 9, 0]);
  const late = snoozeUntil("tomorrow", new Date(2026, 8, 22, 23, 50));
  assert.deepEqual([late.getDate(), late.getHours()], [23, 9]);
});

test("monday from a Tuesday is the coming Monday at 09:00", () => {
  const m = snoozeUntil("monday", tuesday);
  assert.deepEqual([m.getDay(), m.getDate(), m.getHours()], [1, 28, 9]);
});

test("monday from a Monday 08:00 is today at 09:00; from 10:00 it is next week", () => {
  const early = snoozeUntil("monday", new Date(2026, 8, 21, 8, 0));
  assert.deepEqual([early.getDate(), early.getHours()], [21, 9]);
  const late = snoozeUntil("monday", new Date(2026, 8, 21, 10, 0));
  assert.deepEqual([late.getDate(), late.getHours()], [28, 9]);
});

test("a DST transition day still wakes at 09:00 wall-clock", () => {
  const t = snoozeUntil("tomorrow", new Date(2026, 2, 7, 23, 0));
  assert.deepEqual([t.getMonth(), t.getDate(), t.getHours()], [2, 8, 9]);
  assert.equal(t.getTimezoneOffset(), 240, "the wake time is inside DST");
});

test("every preset resolves to a future time", () => {
  for (const preset of ["1h", "4h", "tomorrow", "monday"] as const) {
    assert.ok(snoozeUntil(preset, tuesday) > tuesday, preset);
  }
});

test("wakeItems presents an expired snooze unread and hides a live snooze and a done row", () => {
  const now = Date.parse("2026-09-24T12:00:00.000Z");
  const base = {
    source: "fake",
    type: "pr",
    title: "t",
    snippet: "s",
    createdAt: "2026-09-24T10:00:00.000Z",
    priority: 1,
    meta: {},
  };
  const woken = wakeItems(
    [
      { ...base, id: "fake:u", state: "unread" },
      {
        ...base,
        id: "fake:x",
        state: "snoozed",
        snoozedUntil: "2026-09-24T11:59:59.000Z",
      },
      {
        ...base,
        id: "fake:f",
        state: "snoozed",
        snoozedUntil: "2026-09-24T12:00:01.000Z",
      },
      { ...base, id: "fake:d", state: "done" },
      { ...base, id: "fake:n", state: "snoozed" },
    ],
    now,
  );
  assert.deepEqual(
    woken.map((i) => [i.id, i.state]),
    [
      ["fake:u", "unread"],
      ["fake:x", "unread"],
      ["fake:n", "unread"],
    ],
  );
  assert.equal("snoozedUntil" in (woken[1] ?? {}), false);
});
