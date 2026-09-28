import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pollSource } from "./api.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(status: number, body: unknown): string[] {
  const calls: string[] = [];
  globalThis.fetch = (input, init) => {
    calls.push(
      `${init?.method ?? "GET"} ${input instanceof Request ? input.url : input.toString()}`,
    );
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return calls;
}

test("202 starts a poll on the encoded source route", async () => {
  const calls = respond(202, { polling: "linear" });
  await pollSource("linear");
  assert.deepEqual(calls, ["POST /api/sources/linear/poll"]);
  const encoded = respond(202, {});
  await pollSource("a/b");
  assert.deepEqual(encoded, ["POST /api/sources/a%2Fb/poll"]);
});

test("409 and 404 reject with the server's error text", async () => {
  respond(409, { error: "source disabled" });
  await assert.rejects(pollSource("linear"), { message: "source disabled" });
  respond(404, { error: "unknown source" });
  await assert.rejects(pollSource("nope"), { message: "unknown source" });
});

test("a body without error text falls back to the status", async () => {
  globalThis.fetch = () =>
    Promise.resolve(new Response("oops", { status: 500 }));
  await assert.rejects(pollSource("linear"), { message: "poll failed (500)" });
});

test("a network failure rejects as server unreachable", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  await assert.rejects(pollSource("linear"), { message: "server unreachable" });
});
