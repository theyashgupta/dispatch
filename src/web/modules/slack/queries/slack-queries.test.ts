import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getSlackThread } from "./slack-api.js";
import { slackKeys, slackThreadQueryOptions } from "./slack-queries.js";

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

test("slackThreadQueryOptions always refetches and never serves a stale failure", () => {
  assert.equal(slackThreadQueryOptions("i1").staleTime, 0);
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
