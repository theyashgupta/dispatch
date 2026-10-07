import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { DEFAULT_BOARD_KEY as LOCAL } from "../../../../shared/board-key.js";
import { createMeetingItems, getMeetingTranscript } from "./meetings-api.js";
import {
  createMeetingMutationOptions,
  draftMeetingMutationOptions,
  meetingTranscriptQueryOptions,
  meetingsKeys,
  runAgentMutationOptions,
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
  assert.deepEqual(meetingsKeys.transcript("m1"), [
    "meetings",
    "transcript",
    "m1",
  ]);
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

test("meetingTranscriptQueryOptions always refetches", () => {
  assert.equal(meetingTranscriptQueryOptions("m1").staleTime, 0);
});

test("draftMeetingMutationOptions posts the notes and resolves the drafts", async () => {
  reply(200, { drafts });
  const signal = new AbortController().signal;
  assert.deepEqual(
    await draftMeetingMutationOptions.mutationFn({
      meeting: "m1",
      notes: "n",
      me: "ana",
      signal,
    }),
    { ok: true, drafts },
  );
  assert.equal(calls[0]?.url, "/api/cards/draft-many");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ meeting: "m1", notes: "n", me: "ana" }),
  );
  assert.equal(calls[0]?.init?.signal, signal);
});

test("draftMeetingMutationOptions resolves the server error code on a refusal", async () => {
  reply(409, { error: "generate-in-progress" });
  assert.deepEqual(
    await draftMeetingMutationOptions.mutationFn({
      meeting: "m1",
      notes: "n",
      me: "",
      signal: new AbortController().signal,
    }),
    { ok: false, error: "generate-in-progress" },
  );
});

test("draftMeetingMutationOptions rejects when the request is aborted", async () => {
  const controller = new AbortController();
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  const pending = draftMeetingMutationOptions.mutationFn({
    meeting: "m1",
    notes: "n",
    me: "",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("createMeetingMutationOptions sends only the drafts it is given and resolves the counts", async () => {
  reply(200, { created: 1, updated: 0 });
  assert.deepEqual(
    await createMeetingMutationOptions.mutationFn({
      meeting: "m1",
      drafts,
      notes: "notes",
    }),
    { ok: true, created: 1, updated: 0, notesSaved: true },
  );
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ meeting: "m1", drafts, notes: "notes" }),
  );
});

test("createMeetingMutationOptions resolves a typed failure for a refused create", async () => {
  reply(400, { error: "invalid-meeting" });
  assert.deepEqual(
    await createMeetingMutationOptions.mutationFn({
      meeting: "",
      drafts,
      notes: "",
    }),
    { ok: false, error: "invalid-meeting" },
  );
});

test("runAgentMutationOptions promotes the item and moves its card to To Do", async () => {
  reply(200, { card: { id: "c1", identifier: "DSP-1" } });
  const result = await runAgentMutationOptions(LOCAL).mutationFn({
    itemId: "i1",
  });
  assert.deepEqual(result, {
    card: { id: "c1", identifier: "DSP-1" },
    moved: true,
  });
  assert.equal(calls[0]?.url, "/api/items/i1/promote");
  assert.equal(calls[1]?.url, "/api/cards/c1/move");
  assert.equal(calls[1]?.init?.body, JSON.stringify({ column: "todo" }));
});

test("runAgentMutationOptions resolves moved false when the move is refused", async () => {
  let n = 0;
  globalThis.fetch = (url: string | URL | Request) => {
    calls.push({ url: typeof url === "string" ? url : "" });
    n += 1;
    return Promise.resolve(
      n === 1
        ? new Response(JSON.stringify({ card: { id: "c1", identifier: "D" } }))
        : new Response("{}", { status: 500 }),
    );
  };
  assert.deepEqual(
    await runAgentMutationOptions(LOCAL).mutationFn({ itemId: "i1" }),
    {
      card: { id: "c1", identifier: "D" },
      moved: false,
    },
  );
});

test("runAgentMutationOptions rejects with the server reason when the promote is refused", async () => {
  reply(409, { error: "promoted" });
  await assert.rejects(
    runAgentMutationOptions(LOCAL).mutationFn({ itemId: "i1" }),
    new Error("promoted"),
  );
  assert.equal(calls.length, 1);
});
