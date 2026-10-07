import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { listCalendars } from "./connections-api.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("listCalendars sends a POST with no body and reads the calendars", async () => {
  const calls: { url: unknown; init?: RequestInit }[] = [];
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          calendars: [
            { title: "Work", source: "iCloud", ignoredByDefault: false },
          ],
        }),
        { status: 200 },
      ),
    );
  };
  assert.deepEqual(await listCalendars(), {
    ok: true,
    value: [{ title: "Work", source: "iCloud", ignoredByDefault: false }],
  });
  assert.equal(calls[0].url, "/api/calendar/calendars");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, undefined);
});
