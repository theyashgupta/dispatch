import assert from "node:assert/strict";
import { test } from "node:test";
import { CALENDAR_ERROR_COPY } from "../../../../shared/connection-status.js";
import type {
  CalendarPermission,
  CalendarStatus,
} from "../../../../shared/types.js";
import { calendarAccessView } from "./calendar-permission.js";

const NOW = new Date("2026-10-06T12:00:00Z");

function status(overrides: Partial<CalendarStatus> = {}): CalendarStatus {
  return {
    enabled: false,
    mode: "macos",
    calendars: [],
    icalFilled: false,
    permission: "granted",
    missingCalendars: [],
    ...overrides,
  };
}

test("each permission maps to its label and its two buttons", () => {
  const table: [CalendarPermission, string, boolean, boolean][] = [
    ["granted", "Allowed", false, false],
    ["not-asked", "Not asked", true, true],
    ["denied", "Denied", true, true],
    ["restricted", "Restricted", false, false],
    ["write-only", "Write only", false, true],
    ["prompt-timeout", "No answer", true, false],
    ["read-timeout", "Read timed out", false, false],
    ["unknown", "Unknown", true, false],
  ];
  for (const [permission, label, check, settings] of table) {
    const view = calendarAccessView(status({ permission }), NOW);
    assert.equal(view.label, label, permission);
    assert.equal(view.showCheckAccess, check, permission);
    assert.equal(view.showSystemSettings, settings, permission);
  }
});

test("granted has no message; denied and not-asked have different copy", () => {
  assert.equal(calendarAccessView(status(), NOW).message, null);
  const denied = calendarAccessView(status({ permission: "denied" }), NOW);
  const notAsked = calendarAccessView(status({ permission: "not-asked" }), NOW);
  assert.equal(denied.message, CALENDAR_ERROR_COPY["calendar-denied"]);
  assert.equal(notAsked.message, CALENDAR_ERROR_COPY["not-asked"]);
  assert.notEqual(denied.message, notAsked.message);
});

test("details are null when off and count events when on", () => {
  assert.equal(calendarAccessView(status(), NOW).details, null);
  const one = calendarAccessView(
    status({
      enabled: true,
      eventCount: 1,
      lastPolledAt: "2026-10-06T11:55:00Z",
    }),
    NOW,
  );
  assert.equal(one.details?.eventCount, "1 event in the next 48 hours");
  assert.equal(one.details?.lastPoll, "Last read 5m ago");
  const three = calendarAccessView(
    status({ enabled: true, eventCount: 3, lastError: "timeout" }),
    NOW,
  );
  assert.equal(three.details?.eventCount, "3 events in the next 48 hours");
  assert.equal(three.details?.lastPoll, "Not read yet");
});

test("missing titles pass through in order and the app name is fixed", () => {
  const view = calendarAccessView(
    status({ missingCalendars: ["Work", "Home"] }),
    NOW,
  );
  assert.deepEqual(view.missing, ["Work", "Home"]);
  assert.equal(view.appName, "Dispatch Calendar");
});
