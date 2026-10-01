import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  checkGranola,
  createMeetingItems,
  getGranola,
  getMeetingTranscript,
  putGranola,
  runGranola,
} from "./meetings-api.js";
import {
  granolaQueryOptions,
  meetingTranscriptQueryOptions,
  meetingsKeys,
} from "./meetings-queries.js";

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

const drafts = [{ key: "k", title: "T", description: "D" }];

test("meetingsKeys has the documented shape", () => {
  assert.deepEqual(meetingsKeys.all, ["meetings"]);
  assert.deepEqual(meetingsKeys.granola, ["meetings", "granola"]);
  assert.deepEqual(meetingsKeys.transcript("m1"), [
    "meetings",
    "transcript",
    "m1",
  ]);
});

test("granolaQueryOptions requests the Granola status", async () => {
  const options = granolaQueryOptions();
  assert.deepEqual(options.queryKey, ["meetings", "granola"]);
  reply(200, { state: "off" });
  assert.deepEqual(await newClient().fetchQuery(options), { state: "off" });
  assert.equal(calls[0]?.url, "/api/meetings/granola");
});

test("meetingTranscriptQueryOptions keys on the meeting and requests its transcript", async () => {
  const options = meetingTranscriptQueryOptions("m 1");
  assert.deepEqual(options.queryKey, ["meetings", "transcript", "m 1"]);
  reply(200, { text: "hello" });
  assert.equal(await newClient().fetchQuery(options), "hello");
  assert.equal(calls[0]?.url, "/api/meetings/transcript?meetingId=m%201");
});

test("createMeetingItems resolves the counts and notesSaved on a 200", async () => {
  reply(200, { created: 2, updated: 1 });
  assert.deepEqual(await createMeetingItems("m1", drafts, "notes"), {
    ok: true,
    created: 2,
    updated: 1,
    notesSaved: true,
  });
  assert.equal(calls[0]?.url, "/api/meetings/items");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ meeting: "m1", drafts, notes: "notes" }),
  );
});

test("createMeetingItems resolves ok with notesSaved false on a transcript-write-failed 500", async () => {
  reply(500, { error: "transcript-write-failed", created: 1, updated: 0 });
  assert.deepEqual(await createMeetingItems("m1", drafts), {
    ok: true,
    created: 1,
    updated: 0,
    notesSaved: false,
  });
});

test("createMeetingItems carries the error when the counts are missing", async () => {
  reply(400, { error: "invalid" });
  assert.deepEqual(await createMeetingItems("m1", drafts), {
    ok: false,
    error: "invalid",
  });
});

test("createMeetingItems carries the error on a failure with counts and another error", async () => {
  reply(500, { error: "boom", created: 1, updated: 0 });
  assert.deepEqual(await createMeetingItems("m1", drafts), {
    ok: false,
    error: "boom",
  });
});

test("createMeetingItems resolves a null error on an unreadable failure body", async () => {
  reply(500, "<html>");
  assert.deepEqual(await createMeetingItems("m1", drafts), {
    ok: false,
    error: null,
  });
});

test("createMeetingItems resolves a null error on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  assert.deepEqual(await createMeetingItems("m1", drafts), {
    ok: false,
    error: null,
  });
});

test("getMeetingTranscript throws with the status only on a failure", async () => {
  reply(404, {}, "Not Found");
  await assert.rejects(
    getMeetingTranscript("m1"),
    new Error("getMeetingTranscript failed: 404"),
  );
});

test("getGranola resolves the status on a 200", async () => {
  reply(200, { state: "idle" });
  assert.deepEqual(await getGranola(), { state: "idle" });
});

test("getGranola throws with the status only on a failure", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(getGranola(), new Error("getGranola failed: 500"));
});

test("putGranola resolves the status after the change on a 200", async () => {
  reply(200, { state: "idle" });
  assert.deepEqual(await putGranola({ enabled: true }), {
    state: "idle",
  });
  assert.equal(calls[0]?.url, "/api/meetings/granola");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ enabled: true }));
});

test("putGranola throws with the status only on a failure", async () => {
  reply(400, {}, "Bad Request");
  await assert.rejects(
    putGranola({ enabled: true }),
    new Error("putGranola failed: 400"),
  );
});

test("checkGranola resolves the check result on a 200", async () => {
  reply(200, { ok: true });
  assert.deepEqual(await checkGranola(), { ok: true });
  assert.equal(calls[0]?.url, "/api/meetings/granola/check");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("checkGranola throws with the status only on a failure", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(checkGranola(), new Error("checkGranola failed: 500"));
});

test("runGranola posts and resolves nothing, even on a 409", async () => {
  reply(409, {});
  assert.equal(await runGranola(), undefined);
  assert.equal(calls[0]?.url, "/api/meetings/granola/run");
  assert.equal(calls[0]?.init?.method, "POST");
});
