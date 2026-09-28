import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createMeetingItems, listCalendars } from "./api.js";

const realFetch = globalThis.fetch;
const drafts = [{ key: "send-report", title: "Send it", description: "> q" }];

function reply(status: number, body: unknown): void {
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("createMeetingItems resolves ok with notesSaved true on 201", async () => {
  reply(201, { created: 1, updated: 0, ids: ["a"] });
  assert.deepEqual(await createMeetingItems("Sync", drafts, "notes"), {
    ok: true,
    created: 1,
    updated: 0,
    notesSaved: true,
  });
});

test("a 500 transcript-write-failed with counts resolves ok with notesSaved false", async () => {
  reply(500, { error: "transcript-write-failed", created: 0, updated: 1 });
  assert.deepEqual(await createMeetingItems("Sync", drafts, "notes"), {
    ok: true,
    created: 0,
    updated: 1,
    notesSaved: false,
  });
});

test("a refusal, a bodiless 500 and a network error resolve not ok", async () => {
  reply(400, { error: "invalid-drafts" });
  assert.deepEqual(await createMeetingItems("Sync", drafts), {
    ok: false,
    error: "invalid-drafts",
  });
  reply(500, { error: "create-failed" });
  assert.deepEqual(await createMeetingItems("Sync", drafts), {
    ok: false,
    error: "create-failed",
  });
  globalThis.fetch = () => Promise.reject(new Error("down"));
  assert.deepEqual(await createMeetingItems("Sync", drafts), {
    ok: false,
    error: null,
  });
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
