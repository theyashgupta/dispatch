import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  getCalendarStatus,
  listCalendars,
  putCalendarSettings,
} from "./calendar-api.js";
import {
  calendarKeys,
  calendarStatusQueryOptions,
} from "./calendar-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown, statusText = ""): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(
      new Response(status === 204 ? null : text, { status, statusText }),
    );
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("calendarKeys has the documented shape", () => {
  assert.deepEqual(calendarKeys.all, ["calendar"]);
  assert.deepEqual(calendarKeys.status, ["calendar", "status"]);
});

test("calendarStatusQueryOptions requests the calendar status", async () => {
  const options = calendarStatusQueryOptions();
  assert.deepEqual(options.queryKey, ["calendar", "status"]);
  reply(200, { enabled: true });
  assert.deepEqual(await newClient().fetchQuery(options), { enabled: true });
  assert.equal(calls[0]?.url, "/api/calendar/status");
});

test("getCalendarStatus resolves the body on a 200", async () => {
  reply(200, { enabled: false });
  assert.deepEqual(await getCalendarStatus(), { enabled: false });
});

test("getCalendarStatus throws with the status only on a 404", async () => {
  reply(404, {}, "Not Found");
  await assert.rejects(
    getCalendarStatus(),
    new Error("getCalendarStatus failed: 404"),
  );
});

test("getCalendarStatus throws with the status only on a 500", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getCalendarStatus(),
    new Error("getCalendarStatus failed: 500"),
  );
});

test("listCalendars resolves the calendars on a 200", async () => {
  reply(200, { calendars: [{ id: "c1" }] });
  assert.deepEqual(await listCalendars(), {
    ok: true,
    value: [{ id: "c1" }],
  });
  assert.equal(calls[0]?.url, "/api/calendar/calendars");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
});

test("listCalendars carries the error code on a 409", async () => {
  reply(409, { error: "denied" });
  assert.deepEqual(await listCalendars(), { ok: false, error: "denied" });
});

test("listCalendars falls back to failed on a 409 with no code", async () => {
  reply(409, "");
  assert.deepEqual(await listCalendars(), { ok: false, error: "failed" });
});

test("listCalendars throws on any other failure status", async () => {
  reply(500, {});
  await assert.rejects(
    listCalendars(),
    new Error("calendar request failed: 500"),
  );
});

test("putCalendarSettings resolves the saved status on a 200", async () => {
  reply(200, { enabled: true });
  assert.deepEqual(await putCalendarSettings({ enabled: true }), {
    ok: true,
    value: { enabled: true },
  });
  assert.equal(calls[0]?.url, "/api/calendar/settings");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ enabled: true }));
});

test("putCalendarSettings carries the error code on a 409", async () => {
  reply(409, { error: "denied" });
  assert.deepEqual(await putCalendarSettings({ enabled: true }), {
    ok: false,
    error: "denied",
  });
});

test("putCalendarSettings throws on any other failure status", async () => {
  reply(400, {});
  await assert.rejects(
    putCalendarSettings({ enabled: true }),
    new Error("calendar request failed: 400"),
  );
});
