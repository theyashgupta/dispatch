import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarStatus, GranolaStatus } from "./types.js";
import {
  CALENDAR_ERROR_COPY,
  CALENDAR_LOAD_FAILED_COPY,
  calendarCardStatus,
  CONNECTION_ERROR_COPY,
  cardStatusFrom,
  GRANOLA_ERROR_COPY,
  granolaCardStatus,
  granolaRunLine,
} from "./connection-status.js";
import { LINEAR_CONNECTION } from "./connection-meta.js";

test("no report yet reads as checking; an unconfigured source reads as disconnected", () => {
  assert.deepEqual(cardStatusFrom(null), { kind: "checking" });
  assert.deepEqual(cardStatusFrom({ configured: false, connected: false }), {
    kind: "disconnected",
  });
});

test("a connected source carries its account when the server sent one", () => {
  assert.deepEqual(
    cardStatusFrom({
      configured: true,
      connected: true,
      account: "Ada (a@x.dev)",
    }),
    { kind: "connected", account: "Ada (a@x.dev)" },
  );
  assert.deepEqual(cardStatusFrom({ configured: true, connected: true }), {
    kind: "connected",
  });
});

test("an error report maps to the exact copy, configured or not", () => {
  assert.deepEqual(
    cardStatusFrom({ configured: true, connected: false, error: "rejected" }),
    { kind: "error", message: CONNECTION_ERROR_COPY.rejected },
  );
  assert.deepEqual(
    cardStatusFrom({
      configured: false,
      connected: false,
      error: "unreachable",
    }),
    { kind: "error", message: CONNECTION_ERROR_COPY.unreachable },
  );
});

test("a configured source that is not connected and reports no error reads as disconnected", () => {
  assert.deepEqual(cardStatusFrom({ configured: true, connected: false }), {
    kind: "disconnected",
  });
});

test("connected false never maps to connected, even with an account present", () => {
  const status = cardStatusFrom({
    configured: true,
    connected: false,
    account: "Ada",
    error: "rejected",
  });
  assert.equal(status.kind, "error");
});

test("the rejected and unreachable copy match the first-run strings verbatim", () => {
  assert.equal(
    CONNECTION_ERROR_COPY.rejected,
    "Linear rejected that key. Double-check it and try again.",
  );
  assert.equal(
    CONNECTION_ERROR_COPY.unreachable,
    "Couldn't reach Linear. Check your connection and try again.",
  );
  assert.equal(
    CONNECTION_ERROR_COPY.superseded,
    "Linear was disconnected while this key was being checked. Paste it again to reconnect.",
  );
  assert.equal(
    CONNECTION_ERROR_COPY.failed,
    "Dispatch couldn't save the key. Check ~/.dispatch/config.json and try again.",
  );
});

test("the Linear metadata carries four steps, read and write scopes and the token page", () => {
  assert.equal(LINEAR_CONNECTION.steps.length, 4);
  assert.deepEqual(LINEAR_CONNECTION.scopes, ["read", "write"]);
  assert.equal(
    LINEAR_CONNECTION.tokenPageUrl,
    "https://linear.app/settings/account/security",
  );
  assert.equal(LINEAR_CONNECTION.credentialLabel, "Personal API key");
});

const base: GranolaStatus = { enabled: true, windowHours: 48, running: false };
const NOW = Date.parse("2026-09-25T12:00:00.000Z");

test("Granola status maps to checking, off, each error copy and connected with the server", () => {
  assert.deepEqual(granolaCardStatus(null), { kind: "checking" });
  assert.deepEqual(granolaCardStatus(null, null, true), {
    kind: "error",
    message: "Couldn't load the Granola status. Reload the page.",
  });
  assert.deepEqual(
    granolaCardStatus({ ...base, enabled: false, lastError: "failed" }),
    { kind: "off" },
  );
  for (const code of Object.keys(GRANOLA_ERROR_COPY) as Array<
    keyof typeof GRANOLA_ERROR_COPY
  >) {
    assert.deepEqual(granolaCardStatus({ ...base, lastError: code }), {
      kind: "error",
      message: GRANOLA_ERROR_COPY[code],
    });
  }
  assert.equal(
    GRANOLA_ERROR_COPY["claude-missing"],
    "Claude Code is not installed or not on PATH.",
  );
  assert.deepEqual(
    granolaCardStatus({ ...base, server: "claude.ai Granola" }),
    {
      kind: "connected",
      account: "claude.ai Granola",
    },
  );
  assert.deepEqual(granolaCardStatus(base), { kind: "connected" });
});

test("a failed Check connection sets the error chip while enabled, and never while off", () => {
  const connected = { ...base, server: "claude.ai Granola" };
  assert.deepEqual(granolaCardStatus(connected, { state: "not-found" }), {
    kind: "error",
    message: GRANOLA_ERROR_COPY["not-found"],
  });
  assert.deepEqual(granolaCardStatus(connected, { state: "connected" }), {
    kind: "connected",
    account: "claude.ai Granola",
  });
  assert.deepEqual(
    granolaCardStatus({ ...base, enabled: false }, { state: "needs-auth" }),
    { kind: "off" },
  );
});

test("the run line reads running, not run yet, and the last run with a singular for one", () => {
  assert.equal(
    granolaRunLine({ ...base, running: true }, NOW),
    "Analyzing meetings",
  );
  assert.equal(granolaRunLine(base, NOW), "Not run yet");
  const lastRunAt = "2026-09-25T11:55:00.000Z";
  assert.equal(
    granolaRunLine({ ...base, lastRunAt, lastCount: 4 }, NOW),
    "Last run 5m ago, 4 action items",
  );
  assert.equal(
    granolaRunLine({ ...base, lastRunAt, lastCount: 1 }, NOW),
    "Last run 5m ago, 1 action item",
  );
  assert.equal(granolaRunLine({ ...base, lastRunAt }, NOW), "Last run 5m ago");
});

test("Calendar status maps off to disconnected, errors to their copy and connected to the account line", () => {
  const base: CalendarStatus = {
    enabled: true,
    mode: "macos",
    calendars: [],
    icalFilled: false,
  };
  assert.deepEqual(calendarCardStatus(null), { kind: "checking" });
  assert.deepEqual(calendarCardStatus(null, null, true), {
    kind: "error",
    message: CALENDAR_LOAD_FAILED_COPY,
  });
  assert.deepEqual(calendarCardStatus({ ...base, enabled: false }), {
    kind: "disconnected",
  });
  assert.deepEqual(calendarCardStatus(base), {
    kind: "connected",
    account: "All calendars",
  });
  assert.deepEqual(calendarCardStatus({ ...base, calendars: ["Work"] }), {
    kind: "connected",
    account: "1 calendars",
  });
  assert.deepEqual(
    calendarCardStatus({ ...base, calendars: ["Work", "Home"] }),
    { kind: "connected", account: "2 calendars" },
  );
  assert.deepEqual(calendarCardStatus({ ...base, mode: "ical" }), {
    kind: "connected",
    account: "iCal URL",
  });
  assert.deepEqual(calendarCardStatus({ ...base, lastError: "timeout" }), {
    kind: "error",
    message: CALENDAR_ERROR_COPY.timeout,
  });
  assert.deepEqual(
    calendarCardStatus({ ...base, enabled: false }, "calendar-denied"),
    {
      kind: "error",
      message: CALENDAR_ERROR_COPY["calendar-denied"],
    },
  );
});

test("every calendar error code has its verbatim U4-08 copy", () => {
  assert.equal(
    CALENDAR_ERROR_COPY["calendar-denied"],
    "Dispatch needs access to your calendars. Open System Settings, Privacy and Security, Calendars, and allow the app that runs Dispatch.",
  );
  assert.equal(
    CALENDAR_ERROR_COPY["ical-url-missing"],
    "Fill CALENDAR_ICAL_URL in Settings, Vault first.",
  );
  assert.equal(
    CALENDAR_ERROR_COPY["ical-url-invalid"],
    "The iCal URL in the Vault is not a valid https address.",
  );
  assert.equal(
    CALENDAR_ERROR_COPY["ical-unreachable"],
    "Couldn't fetch the iCal URL. Check the address in the Vault.",
  );
  assert.equal(
    CALENDAR_ERROR_COPY["ical-invalid"],
    "The iCal URL did not return a calendar.",
  );
  assert.equal(
    CALENDAR_ERROR_COPY["ical-too-large"],
    "The calendar is larger than 5 MB.",
  );
  assert.equal(
    CALENDAR_ERROR_COPY.timeout,
    "Reading the calendar took longer than 30 seconds.",
  );
  assert.equal(CALENDAR_ERROR_COPY.failed, "Couldn't read the calendar.");
});
