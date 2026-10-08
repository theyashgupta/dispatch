import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { installCalendarStubs } from "../test-support/calendar-stubs.js";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const stubs = installCalendarStubs(env);
stubs.useScripts();

const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { CONFIG_PATH } = await import("../services/infra/paths.js");
const {
  rebuildSources,
  setCredentialResolver,
  setMacCalendarReader,
  sourceState,
} = await import("../adapters/source-gateway.js");
const { readMacEvents } = await import("../adapters/calendar-mac.js");
const { stopPollers } = await import("../adapters/poller.js");
const { resolveIcalCredential } =
  await import("../services/orchestration/calendar.js");
const { createKey, setValue } = await import("../services/infra/vault.js");
const { calendarRouter } = await import("./calendar.route.js");

const config: import("../../shared/types.js").Config = {
  linearApiKey: "",
  sources: { linear: { apiKey: "" }, calendar: { mode: "macos" } },
};
setOrchestrationConfig(config);
setMacCalendarReader(readMacEvents);
setCredentialResolver("calendar", resolveIcalCredential);
rebuildSources(config);
await store.load();

const isSourceEnabled = (id: string) => sourceState(id) === "enabled";

const app = express();
app.use("/api", express.json(), calendarRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  stopPollers();
  server.close();
  env.cleanup();
});

function mode(value: string): void {
  stubs.reset();
  if (value === "denied") {
    stubs.osaStatus(2);
    return;
  }
  if (value === "stderr") {
    stubs.osaMode("stderr");
    return;
  }
  const t = Date.now() + 600_000;
  stubs.osaReply("events", {
    events: [
      {
        uid: "e1",
        title: "Sync",
        start: new Date(t).toISOString(),
        end: new Date(t + 1_800_000).toISOString(),
        allDay: false,
        calendar: "Work",
      },
    ],
  });
  stubs.osaReply("calendars", {
    calendars: [
      { title: "Work", source: "iCloud" },
      { title: "Birthdays", source: "Other" },
      { title: "US Holidays", source: "Subscribed" },
      { title: "Siri Suggestions", source: "Other" },
    ],
  });
}

mode("ok");

function put(body: unknown): Promise<Response> {
  return fetch(`${base}/calendar/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function statusBody(): Promise<Record<string, unknown>> {
  return (await (await fetch(`${base}/calendar/status`)).json()) as Record<
    string,
    unknown
  >;
}

const configBytes = () => fs.readFileSync(CONFIG_PATH, "utf8");

test("the status starts off, in macos mode, with the Vault key empty", async () => {
  assert.deepEqual(await statusBody(), {
    enabled: false,
    mode: "macos",
    calendars: [],
    icalFilled: false,
    permission: "granted",
    missingCalendars: [],
  });
});

test("the calendar list is a POST and marks Birthdays, holidays and Siri Suggestions as ignored by default", async () => {
  mode("ok");
  assert.equal((await fetch(`${base}/calendar/calendars`)).status, 404);
  const res = await fetch(`${base}/calendar/calendars`, { method: "POST" });
  assert.equal(res.status, 200);
  const { calendars } = (await res.json()) as {
    calendars: { title: string; ignoredByDefault: boolean }[];
  };
  assert.deepEqual(
    calendars.map((c) => [c.title, c.ignoredByDefault]),
    [
      ["Work", false],
      ["Birthdays", true],
      ["US Holidays", true],
      ["Siri Suggestions", true],
    ],
  );
  mode("denied");
  const denied = await fetch(`${base}/calendar/calendars`, {
    method: "POST",
  });
  assert.equal(denied.status, 409);
  assert.deepEqual(await denied.json(), { error: "calendar-denied" });
});

test("wrong shapes answer 400 and write nothing", async () => {
  const before = configBytes();
  const cases: [unknown, string][] = [
    [{ mode: "x" }, "invalid-mode"],
    [
      { calendars: Array.from({ length: 51 }, (_, i) => `C${i}`) },
      "invalid-calendars",
    ],
    [{ calendars: ["x".repeat(201)] }, "invalid-calendars"],
    [{ calendars: ["  "] }, "invalid-calendars"],
    [{ calendars: "Work" }, "invalid-calendars"],
    [{ enabled: "yes" }, "invalid-enabled"],
    [["enabled"], "invalid-body"],
  ];
  for (const [body, error] of cases) {
    const res = await put(body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error });
  }
  assert.equal(configBytes(), before);
});

test("a failed test read answers 409 with its code and leaves config.json byte-identical", async () => {
  const before = configBytes();
  for (const [stub, code] of [
    ["denied", "calendar-denied"],
    ["stderr", "calendar-denied"],
  ]) {
    mode(stub);
    const res = await put({ enabled: true, calendars: ["Work"] });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: code });
  }
  mode("ok");
  const ical = await put({ enabled: true, mode: "ical" });
  assert.equal(ical.status, 409);
  assert.deepEqual(await ical.json(), { error: "ical-url-missing" });
  assert.equal(configBytes(), before);
  assert.equal(isSourceEnabled("calendar"), false);
});

test("enabling with a good read writes the settings, enables the source and the event appears", async () => {
  mode("ok");
  const res = await put({ enabled: true, calendars: ["Work"] });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.enabled, true);
  assert.deepEqual(body.calendars, ["Work"]);
  const saved = JSON.parse(configBytes()) as { sources: { calendar: unknown } };
  assert.deepEqual(saved.sources.calendar, {
    enabled: true,
    calendars: ["Work"],
  });
  assert.equal(isSourceEnabled("calendar"), true);
  const end = Date.now() + 5000;
  while (
    Date.now() < end &&
    !store.listItems().some((i) => i.source === "calendar")
  ) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(store.listItems().some((i) => i.id.startsWith("calendar:e1:")));
  const status = await statusBody();
  assert.equal(status.eventCount, 1);
});

test("the status never carries the iCal URL, a connected macOS calendar still reports the filled iCal key, and disabling stops the source", async () => {
  mode("ok");
  assert.equal((await put({ enabled: false })).status, 200);
  await createKey({ name: "CALENDAR_ICAL_URL", purpose: "test" });
  await setValue("CALENDAR_ICAL_URL", "   ");
  assert.equal((await statusBody()).icalFilled, false);
  await setValue(
    "CALENDAR_ICAL_URL",
    "https://calendar.example/private-canary-path/basic.ics",
  );
  const status = await statusBody();
  assert.equal(status.icalFilled, true);
  assert.equal(JSON.stringify(status).includes("canary"), false);
  const on = await put({ enabled: true, mode: "macos", calendars: ["Work"] });
  assert.equal(on.status, 200);
  const connected = await statusBody();
  assert.equal(connected.icalFilled, true);
  assert.equal(JSON.stringify(connected).includes("canary"), false);
  const off = await put({ enabled: false });
  assert.equal(off.status, 200);
  assert.equal(((await off.json()) as { enabled: boolean }).enabled, false);
  assert.equal(isSourceEnabled("calendar"), false);
});
