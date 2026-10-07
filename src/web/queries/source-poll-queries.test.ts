import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pollSource } from "./source-poll-api.js";
import { pollSourceMutationOptions } from "./source-poll-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("pollSource posts to the poll route of the source", async () => {
  reply(202, { polling: "linear" });
  await pollSource("linear");
  assert.equal(calls[0]?.url, "/api/sources/linear/poll");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("pollSource encodes the source id in the URL", async () => {
  reply(202, {});
  await pollSource("a/b");
  assert.equal(calls[0]?.url, "/api/sources/a%2Fb/poll");
});

test("pollSource throws the server error text on a non-ok result", async () => {
  reply(409, { error: "source disabled" });
  await assert.rejects(pollSource("linear"), {
    message: "source disabled",
  });
});

test("pollSource falls back to the status when the body has no error text", async () => {
  globalThis.fetch = () =>
    Promise.resolve(new Response("oops", { status: 500 }));
  await assert.rejects(pollSource("linear"), { message: "poll failed (500)" });
});

test("pollSource throws server unreachable on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  await assert.rejects(pollSource("linear"), {
    message: "server unreachable",
  });
});

test("the poll mutation runs pollSource", async () => {
  reply(202, {});
  await pollSourceMutationOptions.mutationFn("slack");
  assert.equal(calls[0]?.url, "/api/sources/slack/poll");
  assert.equal(calls[0]?.init?.method, "POST");
});
