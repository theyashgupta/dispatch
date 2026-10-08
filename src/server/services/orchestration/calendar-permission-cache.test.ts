import assert from "node:assert/strict";
import fs from "node:fs";
import { after, beforeEach, test } from "node:test";
import { installCalendarStubs } from "../../test-support/calendar-stubs.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const stubs = installCalendarStubs(env);
stubs.useScripts();

const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const { CONFIG_PATH } = await import("../infra/paths.js");
const {
  rebuildSources,
  setCredentialResolver,
  setMacCalendarReader,
  calendarReadStatus,
} = await import("../../adapters/source-gateway.js");
const { readMacEvents } = await import("../../adapters/calendar-mac.js");
const { stopPollers } = await import("../../adapters/poller.js");
const {
  applyCalendarSettings,
  calendarStatus,
  checkCalendarAccess,
  invalidatePermission,
  resolveIcalCredential,
} = await import("./calendar.js");

const freshConfig = (
  calendar: import("../../../shared/types.js").CalendarSourceConfig = {
    mode: "macos",
  },
): import("../../../shared/types.js").Config => ({
  linearApiKey: "",
  sources: { linear: { apiKey: "" }, calendar },
});

setOrchestrationConfig(freshConfig());
setMacCalendarReader(readMacEvents);
setCredentialResolver("calendar", resolveIcalCredential);
rebuildSources(freshConfig());
await store.load();
setBoardRepository(fakeBoardRepository({}));

after(() => {
  stopPollers();
  setBoardRepository(store);
  env.cleanup();
});

beforeEach(() => {
  stopPollers();
  invalidatePermission();
  stubs.reset();
  setOrchestrationConfig(freshConfig());
});

const statusCalls = (): number => stubs.calls("osa", "status");
const requestCalls = (): number => stubs.calls("osa", "request");

test("C1: two status reads 59 s apart read the permission once and a read at 61 s reads again", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await calendarStatus();
  t.mock.timers.tick(59_000);
  await calendarStatus();
  assert.equal(statusCalls(), 1);
  t.mock.timers.tick(2_000);
  await calendarStatus();
  assert.equal(statusCalls(), 2);
});

test("C3: with the connection off and status 2 the status reports denied and no read fields", async () => {
  stubs.osaStatus(2);
  const status = await calendarStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.permission, "denied");
  assert.equal("lastError" in status, false);
  assert.equal("lastPolledAt" in status, false);
  assert.equal(requestCalls(), 0);
});

test("C4: a saved calendar that this Mac no longer lists shows in missingCalendars", async () => {
  setOrchestrationConfig(
    freshConfig({ mode: "macos", calendars: ["Work", "Gone"] }),
  );
  stubs.osaReply("calendars", {
    calendars: [{ title: "Work", source: "iCloud" }],
  });
  const status = await calendarStatus();
  assert.equal(status.permission, "granted");
  assert.deepEqual(status.missingCalendars, ["Gone"]);
});

test("C5: Connect at not-asked runs one request, and at denied it runs none, answers calendar-denied and writes nothing", async () => {
  stubs.osaStatus(0);
  const on = await applyCalendarSettings({ enabled: true, calendars: [] });
  assert.equal(on.ok, true);
  assert.equal(requestCalls(), 1);
  assert.equal((await applyCalendarSettings({ enabled: false })).ok, true);

  stubs.osaStatus(2);
  const before = fs.readFileSync(CONFIG_PATH, "utf8");
  const denied = await applyCalendarSettings({ enabled: true });
  assert.deepEqual(denied, { ok: false, error: "calendar-denied" });
  assert.equal(requestCalls(), 1);
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), before);

  stubs.osaStatus(0);
  stubs.osaRequestResult(2);
  const refused = await applyCalendarSettings({ enabled: true });
  assert.deepEqual(refused, { ok: false, error: "calendar-denied" });
  assert.equal(requestCalls(), 2);
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), before);
});

test("C6: a save on a connection that is already enabled never requests access", async () => {
  stubs.osaStatus(0);
  const on = await applyCalendarSettings({ enabled: true, calendars: [] });
  assert.equal(on.ok, true);
  assert.equal(requestCalls(), 1);

  stubs.osaStatus(0);
  const save = await applyCalendarSettings({ calendars: ["Work"] });
  assert.deepEqual(save, { ok: false, error: "not-asked" });
  assert.equal(requestCalls(), 1);
  await applyCalendarSettings({ enabled: false });
});

test("C7: Connect and Check access that overlap share one request", async () => {
  stubs.osaStatus(0);
  stubs.osaDelay("request", 1);
  const [check, connect] = await Promise.all([
    checkCalendarAccess(),
    applyCalendarSettings({ enabled: true, calendars: [] }),
  ]);
  assert.equal(check.permission, "granted");
  assert.equal(connect.ok, true);
  assert.equal(requestCalls(), 1);
  await applyCalendarSettings({ enabled: false });
});

test("C8: in iCal mode the status reads no EventKit permission and reports unknown", async () => {
  setOrchestrationConfig(freshConfig({ mode: "ical" }));
  const status = await calendarStatus();
  assert.equal(status.permission, "unknown");
  assert.deepEqual(status.missingCalendars, []);
  assert.equal(stubs.calls("osa"), 0);
});

test("C9: a failed calendar list keeps the permission that was read", async () => {
  setOrchestrationConfig(
    freshConfig({ mode: "macos", calendars: ["Work", "Gone"] }),
  );
  stubs.osaReply("calendars", "not json");
  const status = await calendarStatus();
  assert.equal(status.permission, "granted");
  assert.deepEqual(status.missingCalendars, []);
});

test("C10: a saved change shows in the next status at once, not after the cache ages out", async () => {
  setOrchestrationConfig(
    freshConfig({ mode: "macos", calendars: ["Work", "Gone"] }),
  );
  stubs.osaReply("calendars", {
    calendars: [{ title: "Work", source: "iCloud" }],
  });
  assert.deepEqual((await calendarStatus()).missingCalendars, ["Gone"]);
  const saved = await applyCalendarSettings({ calendars: ["Work"] });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.ok && saved.status.missingCalendars, []);
  assert.deepEqual((await calendarStatus()).missingCalendars, []);
});

test("C2: a poll newer than the cached permission makes the next status read refresh it once", async () => {
  setOrchestrationConfig(freshConfig({ mode: "macos", pollIntervalMs: 1500 }));
  const on = await applyCalendarSettings({ enabled: true, calendars: [] });
  assert.equal(on.ok, true);
  const polledAt = async (after?: string): Promise<string> => {
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      const polled = calendarReadStatus().lastPolledAt;
      if (polled !== undefined && polled !== after) return polled;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("no poll");
  };
  const first = await polledAt();
  await calendarStatus();
  await polledAt(first);
  await new Promise((r) => setTimeout(r, 20));
  const before = statusCalls();
  await calendarStatus();
  assert.equal(statusCalls(), before + 1);
  await calendarStatus();
  assert.equal(statusCalls(), before + 1);
});

test("C11: in iCal mode a Check access answer shows in the next status with no EventKit read, and with no check the status is unknown", async () => {
  setOrchestrationConfig(freshConfig({ mode: "ical" }));
  assert.equal((await calendarStatus()).permission, "unknown");
  assert.equal(stubs.calls("osa"), 0);

  stubs.osaRequestResult(2);
  const checked = await checkCalendarAccess();
  assert.equal(checked.permission, "denied");
  assert.equal(requestCalls(), 1);
  const reads = statusCalls();
  const status = await calendarStatus();
  assert.equal(status.permission, "denied");
  assert.deepEqual(status.missingCalendars, []);
  assert.equal(statusCalls(), reads);
  assert.equal(requestCalls(), 1);
});

test("C12: in iCal mode a Check access answer older than 60 s is unknown again", async (t) => {
  setOrchestrationConfig(freshConfig({ mode: "ical" }));
  t.mock.timers.enable({ apis: ["Date"], now: 2_000_000 });
  await checkCalendarAccess();
  t.mock.timers.tick(59_000);
  assert.equal((await calendarStatus()).permission, "granted");
  t.mock.timers.tick(2_000);
  assert.equal((await calendarStatus()).permission, "unknown");
  assert.equal(statusCalls(), 0);
});

const eventCalls = (): number => stubs.calls("osa", "events");

const settled = async (read: () => number): Promise<number> => {
  let last = read();
  for (let quiet = 0; quiet < 10;) {
    await new Promise((r) => setTimeout(r, 50));
    const now = read();
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
  return last;
};

test("C13: a granted Check access on an enabled macOS connection starts one calendar poll", async () => {
  setOrchestrationConfig(
    freshConfig({ mode: "macos", pollIntervalMs: 600_000 }),
  );
  const on = await applyCalendarSettings({ enabled: true, calendars: [] });
  assert.equal(on.ok, true);
  const before = await settled(eventCalls);
  const status = await checkCalendarAccess();
  assert.equal(status.permission, "granted");
  assert.equal(await settled(eventCalls), before + 1);
  assert.equal(requestCalls(), 1);
  await applyCalendarSettings({ enabled: false });
});

test("C14: a Check access that is denied, or runs on a disabled connection, starts no poll", async () => {
  setOrchestrationConfig(
    freshConfig({ mode: "macos", pollIntervalMs: 600_000 }),
  );
  const on = await applyCalendarSettings({ enabled: true, calendars: [] });
  assert.equal(on.ok, true);
  const before = await settled(eventCalls);
  stubs.osaRequestResult(2);
  assert.equal((await checkCalendarAccess()).permission, "denied");
  assert.equal(await settled(eventCalls), before);
  await applyCalendarSettings({ enabled: false });

  stubs.reset();
  const idle = await checkCalendarAccess();
  assert.equal(idle.permission, "granted");
  assert.equal(await settled(eventCalls), 0);
});

test("C15: a refresh in flight when the permission is invalidated does not fill the cache", async () => {
  stubs.osaStatus(2);
  stubs.osaDelay("status", 1);
  const stale = calendarStatus();
  while (statusCalls() === 0) await new Promise((r) => setTimeout(r, 10));
  invalidatePermission();
  assert.equal((await stale).permission, "denied");
  stubs.osaDelay("status", 0);
  stubs.osaStatus(3);
  assert.equal((await calendarStatus()).permission, "granted");
  assert.equal(statusCalls(), 2);
});

test("C16: a status read after an invalidate starts a new read and does not join the one in flight", async () => {
  stubs.osaStatus(2);
  stubs.osaDelay("status", 1);
  const first = calendarStatus();
  while (statusCalls() === 0) await new Promise((r) => setTimeout(r, 10));
  invalidatePermission();
  const second = calendarStatus();
  await Promise.all([first, second]);
  assert.equal(statusCalls(), 2);
});

test("C17: a Check access that a save overtakes while it lists calendars does not cache its older list", async () => {
  setOrchestrationConfig(
    freshConfig({ mode: "macos", calendars: ["Work", "Gone"] }),
  );
  stubs.osaReply("calendars", {
    calendars: [{ title: "Work", source: "iCloud" }],
  });
  stubs.osaDelay("calendars", 1);
  const check = checkCalendarAccess();
  while (stubs.calls("osa", "calendars") === 0) {
    await new Promise((r) => setTimeout(r, 10));
  }
  setOrchestrationConfig(freshConfig({ mode: "macos", calendars: ["Work"] }));
  invalidatePermission();
  assert.deepEqual((await check).missingCalendars, []);
});

test("C18: Connect in iCal mode on a not-asked Mac never requests access", async () => {
  setOrchestrationConfig(freshConfig({ mode: "ical" }));
  stubs.osaStatus(0);
  await applyCalendarSettings({ enabled: true });
  assert.equal(requestCalls(), 0);
  assert.equal(statusCalls(), 0);
  await applyCalendarSettings({ enabled: true, mode: "ical" });
  assert.equal(requestCalls(), 0);
});

test("C19: a status read that fails with a non-timeout error caches unknown", async () => {
  stubs.osaMode("stderr");
  const first = await calendarStatus();
  assert.equal(first.permission, "unknown");
  assert.deepEqual(first.missingCalendars, []);
  assert.equal(statusCalls(), 1);
  assert.equal((await calendarStatus()).permission, "unknown");
  assert.equal(statusCalls(), 1);
});

test("C20: status reads that overlap share one permission read", async () => {
  stubs.osaStatus(2);
  stubs.osaDelay("status", 0.3);
  const all = await Promise.all([
    calendarStatus(),
    calendarStatus(),
    calendarStatus(),
  ]);
  assert.deepEqual(
    all.map((status) => status.permission),
    ["denied", "denied", "denied"],
  );
  assert.equal(statusCalls(), 1);
});

const startRunningPoll = async (): Promise<number> => {
  setOrchestrationConfig(
    freshConfig({ mode: "macos", pollIntervalMs: 600_000 }),
  );
  const on = await applyCalendarSettings({ enabled: true, calendars: [] });
  assert.equal(on.ok, true);
  return settled(eventCalls);
};

test("C21: a granted Check access while the saved connection is off does not poll, though a poll loop is running", async () => {
  const before = await startRunningPoll();
  assert.ok(before >= 1);
  setOrchestrationConfig(
    freshConfig({ mode: "macos", enabled: false, pollIntervalMs: 600_000 }),
  );
  const status = await checkCalendarAccess();
  assert.equal(status.permission, "granted");
  assert.equal(await settled(eventCalls), before);
  stopPollers();
});

test("C22: a granted Check access in iCal mode does not poll, though a poll loop is running", async () => {
  const before = await startRunningPoll();
  assert.ok(before >= 1);
  setOrchestrationConfig(
    freshConfig({ mode: "ical", enabled: true, pollIntervalMs: 600_000 }),
  );
  const status = await checkCalendarAccess();
  assert.equal(status.permission, "granted");
  assert.equal(await settled(eventCalls), before);
  stopPollers();
});

test("C23: two Check access calls that join one request both keep its prompt-timeout answer", async () => {
  stubs.osaStatus(0);
  stubs.osaRequestResult(0);
  stubs.osaDelay("request", 1);
  const [first, second] = await Promise.all([
    checkCalendarAccess(),
    checkCalendarAccess(),
  ]);
  assert.equal(requestCalls(), 1);
  assert.equal(first.permission, "prompt-timeout");
  assert.equal(second.permission, "prompt-timeout");
  assert.equal((await calendarStatus()).permission, "prompt-timeout");
});

test("C24: a granted Check access answers with the read of the poll it started", async () => {
  setOrchestrationConfig(
    freshConfig({ mode: "macos", pollIntervalMs: 600_000 }),
  );
  const on = await applyCalendarSettings({ enabled: true, calendars: [] });
  assert.equal(on.ok, true);
  assert.equal(on.ok && on.status.lastError, undefined);
  stubs.osaReply("events", { error: "boom" });
  stubs.osaDelay("events", 1);
  const status = await checkCalendarAccess();
  assert.equal(status.permission, "granted");
  assert.equal(status.lastError, "failed");
  await applyCalendarSettings({ enabled: false });
});
