import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { resumeCard } from "./cards-api.js";
import { resumeCardMutationOptions } from "./cards-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown = {}): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), { status }),
    );
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("resumeCard posts only the card id in the path and resolves ok on a 2xx", async () => {
  reply(202);
  assert.deepEqual(await resumeCard("a/b"), { ok: true });
  assert.equal(calls[0]?.url, "/api/cards/a%2Fb/resume");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(calls[0]?.init?.headers, {
    "Content-Type": "application/json",
  });
  assert.equal(calls[0]?.init?.body, undefined);
});

test("resumeCard resolves the status of a non-2xx so a 409 reads apart from other failures", async () => {
  reply(409, { error: "starting" });
  assert.deepEqual(await resumeCard("c1"), { ok: false, status: 409 });
  reply(500);
  assert.deepEqual(await resumeCard("c1"), { ok: false, status: 500 });
});

test("resumeCard resolves a null status on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("offline"));
  assert.deepEqual(await resumeCard("c1"), { ok: false, status: null });
});

test("the resume mutation resolves the same results through the options factory", async () => {
  const observer = new MutationObserver(
    new QueryClient(),
    resumeCardMutationOptions(),
  );
  reply(200);
  assert.deepEqual(await observer.mutate({ id: "c1" }), { ok: true });
  assert.equal(calls[0]?.url, "/api/cards/c1/resume");
  reply(409);
  assert.deepEqual(await observer.mutate({ id: "c1" }), {
    ok: false,
    status: 409,
  });
});
