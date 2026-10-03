import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  checkGranola,
  getGranola,
  putGranola,
  runGranola,
} from "./granola-api.js";
import {
  checkGranolaMutationOptions,
  granolaKeys,
  granolaQueryOptions,
  putGranolaMutationOptions,
  runGranolaMutationOptions,
} from "./granola-queries.js";

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

test("granolaKeys has the documented shape", () => {
  assert.deepEqual(granolaKeys.status, ["meetings", "granola"]);
});

test("granolaQueryOptions requests the Granola status", async () => {
  const options = granolaQueryOptions();
  assert.deepEqual(options.queryKey, ["meetings", "granola"]);
  reply(200, { state: "off" });
  assert.deepEqual(await newClient().fetchQuery(options), { state: "off" });
  assert.equal(calls[0]?.url, "/api/meetings/granola");
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

const idle = { enabled: true, windowHours: 48, running: false };

test("a saved Granola setting writes the answered status into the cache", async () => {
  const client = newClient();
  client.setQueryData(granolaKeys.status, { ...idle, enabled: false });
  reply(200, idle);
  await new MutationObserver(client, putGranolaMutationOptions(client)).mutate({
    enabled: true,
  });
  assert.deepEqual(client.getQueryData(granolaKeys.status), idle);
  assert.equal(calls.length, 1);
});

test("a save cancels an in-flight status read so a slow poll cannot undo it", async () => {
  const client = newClient();
  client.setQueryData(granolaKeys.status, { ...idle, enabled: false });
  let release: (response: Response) => void = () => undefined;
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  const poll = client
    .fetchQuery({ ...granolaQueryOptions(), staleTime: 0 })
    .catch(() => undefined);
  reply(200, idle);
  await new MutationObserver(client, putGranolaMutationOptions(client)).mutate({
    enabled: true,
  });
  release(new Response(JSON.stringify({ ...idle, enabled: false })));
  await poll;
  assert.deepEqual(client.getQueryData(granolaKeys.status), idle);
});

test("a failed Granola save marks the status stale and keeps the old status", async () => {
  const client = newClient();
  client.setQueryData(granolaKeys.status, { ...idle, enabled: false });
  reply(400, {}, "Bad Request");
  await assert.rejects(
    new MutationObserver(client, putGranolaMutationOptions(client)).mutate({
      enabled: true,
    }),
    new Error("putGranola failed: 400"),
  );
  assert.equal(client.getQueryState(granolaKeys.status)?.isInvalidated, true);
  assert.deepEqual(client.getQueryData(granolaKeys.status), {
    ...idle,
    enabled: false,
  });
});

test("Analyze now runs the round and marks the status stale", async () => {
  const client = newClient();
  client.setQueryData(granolaKeys.status, idle);
  reply(200, {});
  await new MutationObserver(client, runGranolaMutationOptions(client)).mutate(
    undefined,
  );
  assert.equal(calls[0]?.url, "/api/meetings/granola/run");
  assert.equal(client.getQueryState(granolaKeys.status)?.isInvalidated, true);
});

test("Analyze now still marks the status stale when the request fails", async () => {
  const client = newClient();
  client.setQueryData(granolaKeys.status, idle);
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  await new MutationObserver(client, runGranolaMutationOptions(client)).mutate(
    undefined,
  );
  assert.equal(client.getQueryState(granolaKeys.status)?.isInvalidated, true);
});

test("the check mutation resolves the check result and throws on a failure", async () => {
  reply(200, { state: "connected", server: "granola" });
  assert.deepEqual(await checkGranolaMutationOptions.mutationFn(), {
    state: "connected",
    server: "granola",
  });
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    checkGranolaMutationOptions.mutationFn(),
    new Error("checkGranola failed: 500"),
  );
});
