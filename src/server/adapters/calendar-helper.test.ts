import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import {
  codeOf,
  FROM,
  installCalendarStubs,
  TO,
} from "../test-support/calendar-stubs.js";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
process.env.TMPDIR = env.root;
const stubs = installCalendarStubs(env);

const { helperPath, parseHelperAnswer } = await import("./calendar-helper.js");
const {
  listMacCalendars,
  readMacEvents,
  readPermission,
  requestCalendarAccess,
} = await import("./calendar-mac.js");

after(() => env.cleanup());

beforeEach(() => {
  stubs.reset();
  stubs.useHelper();
});

function tempDirCount(): number {
  return fs
    .readdirSync(os.tmpdir())
    .filter((name) => name.startsWith("dispatch-cal-")).length;
}

test("parseHelperAnswer reads a valid status and rejects empty, garbage, out of range, wrong type and non-object answers", () => {
  assert.equal(parseHelperAnswer('{"status":3,"calendars":[]}').status, 3);
  assert.equal(parseHelperAnswer("").status, null);
  assert.equal(parseHelperAnswer("not json").status, null);
  assert.equal(parseHelperAnswer('{"status":7}').status, null);
  assert.equal(parseHelperAnswer('{"status":"3"}').status, null);
  assert.equal(parseHelperAnswer("[1]").status, null);
});

test("helperPath returns the app only when its executable exists, and an empty override counts as unset", () => {
  assert.equal(helperPath(stubs.fakeApp, "/no/built.app"), stubs.fakeApp);
  assert.equal(helperPath(stubs.missingApp, stubs.fakeApp), null);
  const bare = path.join(env.root, "Bare.app");
  fs.mkdirSync(path.join(bare, "Contents", "MacOS"), { recursive: true });
  assert.equal(helperPath(bare, stubs.fakeApp), null);
  fs.writeFileSync(
    path.join(bare, "Contents", "MacOS", "DispatchCalendar"),
    "",
    {
      mode: 0o644,
    },
  );
  assert.equal(helperPath(bare, stubs.fakeApp), null);
  assert.equal(helperPath("", stubs.fakeApp), stubs.fakeApp);
  assert.equal(helperPath(undefined, stubs.fakeApp), stubs.fakeApp);
});

test("an app folder without the executable falls back to osascript and open is not called", async () => {
  const bare = path.join(env.root, "NoBinary.app");
  fs.mkdirSync(bare, { recursive: true });
  process.env.DISPATCH_CALENDAR_HELPER = bare;
  stubs.osaStatus(2);
  assert.equal(await readPermission(), "denied");
  assert.equal(stubs.calls("open"), 0);
});

test("an existing helper app answers the status read through open and osascript is not called", async () => {
  stubs.helperReply({ status: 3 });
  assert.equal(await readPermission(), "granted");
  const argv = stubs.openArgv();
  assert.deepEqual(argv.slice(0, 6), [
    "-n",
    "-W",
    "-g",
    "-a",
    stubs.fakeApp,
    "--stdout",
  ]);
  assert.deepEqual(argv.slice(argv.indexOf("--args") + 1), ["status"]);
  assert.equal(stubs.calls("osa"), 0);
});

test("a missing helper app falls back to osascript and open is not called", async () => {
  stubs.useScripts();
  stubs.osaStatus(2);
  assert.equal(await readPermission(), "denied");
  assert.equal(stubs.calls("osa", "status"), 1);
  assert.equal(stubs.calls("open"), 0);
  assert.match(stubs.osaStdin(), /authorizationStatusForEntityType/);
  assert.equal(stubs.osaStdin().includes("requestFullAccess"), false);
  assert.equal(stubs.osaStdin().includes("requestAccess"), false);
});

test("the helper events answer keeps valid events and the partial flag, and sends one JSON argv element", async () => {
  stubs.helperReply({
    status: 3,
    events: [
      {
        uid: "u1",
        title: "Design sync",
        start: "2026-11-02T15:00:00.000Z",
        end: "2026-11-02T15:30:00.000Z",
        allDay: false,
        calendar: "Work",
      },
      {
        uid: "",
        title: "no uid",
        start: "2026-11-02T15:00:00.000Z",
        end: "2026-11-02T15:30:00.000Z",
        allDay: false,
        calendar: "Work",
      },
    ],
    partial: true,
  });
  const { events, partial } = await readMacEvents(FROM, TO, ["Work"]);
  assert.deepEqual(
    events.map((e) => e.uid),
    ["u1"],
  );
  assert.equal(partial, true);
  const argv = stubs.openArgv();
  const after = argv.slice(argv.indexOf("--args") + 1);
  assert.equal(after.length, 2);
  assert.equal(after[0], "events");
  const args = JSON.parse(after[1]) as {
    from: string;
    to: string;
    calendars: string[];
  };
  assert.equal(args.from, FROM.toISOString());
  assert.equal(args.to, TO.toISOString());
  assert.deepEqual(args.calendars, ["Work"]);
});

test("a helper status other than 3 throws its own code, calendars-missing keeps its code and bad-args is failed", async () => {
  stubs.helperReply({ status: 0 });
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "not-asked");
  assert.equal(await codeOf(listMacCalendars()), "not-asked");
  assert.equal(stubs.openArgv().includes("request"), false);
  stubs.helperReply({ status: 3, error: "calendars-missing" });
  assert.equal(
    await codeOf(readMacEvents(FROM, TO, ["Work"])),
    "calendars-missing",
  );
  stubs.helperReply({ error: "bad-args" });
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "failed");
});

test("a missing or invalid status maps to unknown on the helper path and on the JXA path", async () => {
  stubs.helperReply({});
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "unknown");
  stubs.helperReply({ status: 9 });
  assert.equal(await readPermission(), "unknown");
  stubs.useScripts();
  stubs.osaReply("events", { error: "calendar-denied" });
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "unknown");
  stubs.osaReply("status", {});
  assert.equal(await readPermission(), "unknown");
});

test("a JXA read at status 0 rejects not-asked and write-only is rejected on both paths", async () => {
  stubs.useScripts();
  stubs.osaReply("events", { error: "calendar-denied", status: 0 });
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "not-asked");
  assert.equal(stubs.osaStdin().includes("requestFullAccess"), false);
  assert.equal(stubs.osaStdin().includes("requestAccess"), false);
  stubs.osaReply("events", { error: "calendar-denied", status: 4 });
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "write-only");
  stubs.osaReply("calendars", { error: "calendar-denied", status: 1 });
  assert.equal(await codeOf(listMacCalendars()), "restricted");
  stubs.useHelper();
  stubs.helperReply({ status: 4 });
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "write-only");
});

test("a calendars-missing answer rejects calendars-missing on both paths", async () => {
  stubs.helperReply({ status: 3, error: "calendars-missing" });
  assert.equal(
    await codeOf(readMacEvents(FROM, TO, ["Gone"])),
    "calendars-missing",
  );
  stubs.useScripts();
  stubs.osaReply("events", { error: "calendars-missing" });
  assert.equal(
    await codeOf(readMacEvents(FROM, TO, ["Gone"])),
    "calendars-missing",
  );
});

test("requestCalendarAccess passes the wait in seconds and returns the permission state", async () => {
  stubs.helperReply({ status: 3 });
  assert.equal(await requestCalendarAccess(3000), "granted");
  const argv = stubs.openArgv();
  assert.deepEqual(argv.slice(argv.indexOf("--args") + 1), ["request", "3"]);
  stubs.helperReply({ status: 0, timedOut: true });
  assert.equal(await requestCalendarAccess(3000), "prompt-timeout");
});

test("a request that timed out after the user granted access is granted", async () => {
  stubs.helperReply({ status: 3, timedOut: true });
  assert.equal(await requestCalendarAccess(3000), "granted");
});

test("requestCalendarAccess never throws: a failed helper or a -1743 from osascript gives unknown", async () => {
  stubs.helperMode("fail");
  assert.equal(await requestCalendarAccess(3000), "unknown");
  stubs.helperMode("ok");
  stubs.useScripts();
  stubs.osaMode("stderr");
  assert.equal(await requestCalendarAccess(3000), "unknown");
});

test("a killed read is read-timeout and a request with no answer is prompt-timeout on both paths", async () => {
  stubs.helperMode("slow");
  assert.equal(await codeOf(readMacEvents(FROM, TO, [], 300)), "read-timeout");
  assert.equal(await requestCalendarAccess(300), "prompt-timeout");
  stubs.useScripts();
  stubs.osaMode("slow");
  assert.equal(await codeOf(readMacEvents(FROM, TO, [], 300)), "read-timeout");
  assert.equal(await requestCalendarAccess(300), "prompt-timeout");
});

test("a helper that never answers is killed at the timeout and its temp dir is removed", async () => {
  stubs.helperMode("slow");
  const before = tempDirCount();
  const started = Date.now();
  assert.equal(await readPermission(500), "read-timeout");
  assert.ok(Date.now() - started < 10_000);
  assert.equal(tempDirCount(), before);
});

test("an open that exits 1 with Unable to block after the helper wrote its whole answer still yields it", async () => {
  stubs.helperMode("early-exit");
  assert.equal(await readPermission(5000), "granted");
});

test("an open that exits 0 with no answer fails within 2 s of the exit, not at the deadline", async () => {
  stubs.helperMode("no-answer");
  const started = Date.now();
  assert.equal(await codeOf(readMacEvents(FROM, TO, [], 20_000)), "failed");
  assert.ok(Date.now() - started < 8000);
});

test("an open that fails without Unable to block fails at once", async () => {
  stubs.helperMode("fail");
  const started = Date.now();
  assert.equal(await codeOf(readMacEvents(FROM, TO, [], 20_000)), "failed");
  assert.ok(Date.now() - started < 3000);
});

test("an answer file over 16 MiB is failed", async () => {
  stubs.helperReply(
    JSON.stringify({
      status: 3,
      events: [],
      pad: "x".repeat(17 * 1024 * 1024),
    }),
  );
  assert.equal(await codeOf(readMacEvents(FROM, TO, [])), "failed");
});
