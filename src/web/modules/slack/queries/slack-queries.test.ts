import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getSlackThread } from "@/queries/slack-thread-api";
import type { Item } from "../../../../shared/types.js";
import {
  draftReplyMutationOptions,
  slackKeys,
  slackThreadQueryOptions,
} from "./slack-queries.js";

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

test("slackThreadQueryOptions rereads on mount once the data is 2 s old", () => {
  assert.equal(slackThreadQueryOptions("i1").staleTime, 2_000);
});

test("slackKeys has the documented shape", () => {
  assert.deepEqual(slackKeys.all, ["slack"]);
  assert.deepEqual(slackKeys.thread("i1"), ["slack", "thread", "i1"]);
});

test("slackThreadQueryOptions keys on the item and requests its thread", async () => {
  const options = slackThreadQueryOptions("i 1");
  assert.deepEqual(options.queryKey, ["slack", "thread", "i 1"]);
  reply(200, { messages: [] });
  assert.deepEqual(await newClient().fetchQuery(options), {
    ok: true,
    thread: { messages: [], truncated: false },
  });
  assert.equal(calls[0]?.url, "/api/slack/thread/i%201");
  assert.ok(calls[0]?.init?.signal);
});

test("getSlackThread resolves the thread and the truncated flag on a 200", async () => {
  reply(200, { messages: [{ text: "hi" }], truncated: true });
  assert.deepEqual(await getSlackThread("i1"), {
    ok: true,
    thread: { messages: [{ text: "hi" }], truncated: true },
  });
});

test("getSlackThread reads a rejected body as rejected with a plain provider code", async () => {
  reply(401, { error: "rejected", providerError: "invalid_auth" });
  assert.deepEqual(await getSlackThread("i1"), {
    ok: false,
    reason: "rejected",
    providerError: "invalid_auth",
  });
});

test("getSlackThread drops a provider code that is not plain", async () => {
  reply(401, { error: "rejected", providerError: "Bad Code!" });
  assert.deepEqual(await getSlackThread("i1"), {
    ok: false,
    reason: "rejected",
  });
});

test("getSlackThread reads any other failure body as unreachable", async () => {
  reply(502, { error: "unreachable" });
  assert.deepEqual(await getSlackThread("i1"), {
    ok: false,
    reason: "unreachable",
  });
});

test("getSlackThread reads a 200 without a messages array as unreachable", async () => {
  reply(200, { thread: [] });
  assert.deepEqual(await getSlackThread("i1"), {
    ok: false,
    reason: "unreachable",
  });
});

test("getSlackThread reads an unreadable failure body as unreachable", async () => {
  reply(500, "<html>");
  assert.deepEqual(await getSlackThread("i1"), {
    ok: false,
    reason: "unreachable",
  });
});

test("getSlackThread reads a network failure as unreachable", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  assert.deepEqual(await getSlackThread("i1"), {
    ok: false,
    reason: "unreachable",
  });
});

function slackItem(meta: Record<string, string>): Item {
  return {
    id: "slack:C1:1.1",
    source: "slack",
    type: "mention",
    title: "t",
    snippet: "can you check the deploy plan?",
    url: "https://acme.slack.com/archives/C1/p11",
    createdAt: "2026-09-28T09:00:00.000Z",
    priority: 75,
    state: "unread",
    meta,
  };
}

test("draftReplyMutationOptions builds the prompt without a thread call for an unthreaded item", async () => {
  reply(200, { messages: [] });
  const prompt = await draftReplyMutationOptions.mutationFn(
    slackItem({ author: "ben", channelName: "eng", conversation: "channel" }),
  );
  assert.equal(calls.length, 0);
  assert.match(prompt, /Draft a reply to this Slack message from ben/);
  assert.doesNotMatch(prompt, /Thread \(oldest first\)/);
});

test("draftReplyMutationOptions loads the thread for a threaded item and adds it to the prompt", async () => {
  reply(200, {
    messages: [{ author: "ana", text: "second", time: "1.2" }],
  });
  const prompt = await draftReplyMutationOptions.mutationFn(
    slackItem({ author: "ben", channelName: "eng", threadTs: "1.1" }),
  );
  assert.equal(calls[0]?.url, "/api/slack/thread/slack%3AC1%3A1.1");
  assert.match(prompt, /Thread \(oldest first\)/);
  assert.match(prompt, /second/);
});

test("draftReplyMutationOptions says the thread could not be loaded when the load fails", async () => {
  reply(500, {});
  const prompt = await draftReplyMutationOptions.mutationFn(
    slackItem({ author: "ben", channelName: "eng", threadTs: "1.1" }),
  );
  assert.match(prompt, /The thread could not be loaded\./);
});
