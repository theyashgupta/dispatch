import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getCalendarStatus } from "./calendar-status-api.js";
import {
  calendarStatusKeys,
  calendarStatusQueryOptions,
} from "./calendar-status-queries.js";

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

test("calendarStatusKeys has the documented shape", () => {
  assert.deepEqual(calendarStatusKeys.status, ["calendar", "status"]);
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
