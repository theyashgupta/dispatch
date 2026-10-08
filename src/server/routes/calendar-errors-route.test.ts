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
const { rebuildSources, setCredentialResolver, setMacCalendarReader } =
  await import("../adapters/source-gateway.js");
const { readMacEvents } = await import("../adapters/calendar-mac.js");
const { stopPollers } = await import("../adapters/poller.js");
const { resolveIcalCredential } =
  await import("../services/orchestration/calendar.js");
const { calendarRouter } = await import("./calendar.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const config: import("../../shared/types.js").Config = {
  linearApiKey: "",
  sources: { linear: { apiKey: "" }, calendar: { mode: "macos" } },
};
setOrchestrationConfig(config);
setMacCalendarReader(readMacEvents);
setCredentialResolver("calendar", resolveIcalCredential);
rebuildSources(config);
await store.load();

const app = express();
app.use("/api", express.json(), calendarRouter);
app.use(httpErrorHandler);
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
  stubs.osaReply("calendars", {
    calendars: [{ title: "Work", source: "iCloud" }],
  });
}

mode("ok");

async function send(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, text: await res.text() };
}

const put = (body?: unknown) => send("PUT", "/calendar/settings", body);

test("PUT settings answers 400 with the first wrong field's code and writes nothing", async () => {
  const before = fs.readFileSync(CONFIG_PATH, "utf8");
  const cases: [unknown, string][] = [
    [undefined, "invalid-body"],
    [[], "invalid-body"],
    [["enabled"], "invalid-body"],
    [{ mode: "x" }, "invalid-mode"],
    [{ mode: null }, "invalid-mode"],
    [{ mode: 5 }, "invalid-mode"],
    [{ calendars: "Work" }, "invalid-calendars"],
    [{ calendars: null }, "invalid-calendars"],
    [
      { calendars: Array.from({ length: 51 }, (_, i) => `C${i}`) },
      "invalid-calendars",
    ],
    [{ calendars: ["x".repeat(201)] }, "invalid-calendars"],
    [{ calendars: ["  "] }, "invalid-calendars"],
    [{ calendars: [5] }, "invalid-calendars"],
    [{ enabled: "yes" }, "invalid-enabled"],
    [{ enabled: null }, "invalid-enabled"],
    [{ mode: "x", calendars: "Work", enabled: "yes" }, "invalid-mode"],
    [{ calendars: "Work", enabled: "yes" }, "invalid-calendars"],
    [{ mode: "ical", calendars: "Work", enabled: "yes" }, "invalid-calendars"],
  ];
  for (const [body, error] of cases) {
    const res = await put(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.text, JSON.stringify({ error }), JSON.stringify(body));
  }
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), before);
});

test("PUT settings answers 409 with the test read's code and writes nothing", async () => {
  const before = fs.readFileSync(CONFIG_PATH, "utf8");
  for (const stub of ["denied", "stderr"]) {
    mode(stub);
    const res = await put({ enabled: true, calendars: ["Work"] });
    assert.equal(res.status, 409);
    assert.equal(res.text, '{"error":"calendar-denied"}');
  }
  mode("ok");
  const ical = await put({ enabled: true, mode: "ical" });
  assert.equal(ical.status, 409);
  assert.equal(ical.text, '{"error":"ical-url-missing"}');
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), before);
});

test("POST calendars answers 409 with the read's code", async () => {
  for (const stub of ["denied", "stderr"]) {
    mode(stub);
    const res = await send("POST", "/calendar/calendars");
    assert.equal(res.status, 409);
    assert.equal(res.text, '{"error":"calendar-denied"}');
  }
});

test("GET status answers 500 status-failed when the held config throws on read", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  setOrchestrationConfig({
    linearApiKey: "",
    sources: {
      linear: { apiKey: "" },
      get calendar(): never {
        throw new Error("config unreadable");
      },
    },
  });
  const res = await send("GET", "/calendar/status");
  setOrchestrationConfig(config);
  assert.equal(res.status, 500);
  assert.equal(res.text, '{"error":"status-failed"}');
});

test("PUT settings answers 500 settings-failed when config.json is missing", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  mode("ok");
  const saved = fs.readFileSync(CONFIG_PATH, "utf8");
  fs.rmSync(CONFIG_PATH);
  const res = await put({ enabled: false });
  fs.writeFileSync(CONFIG_PATH, saved, { mode: 0o600 });
  assert.equal(res.status, 500);
  assert.equal(res.text, '{"error":"settings-failed"}');
});
