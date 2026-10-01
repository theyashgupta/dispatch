import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { runUpdate } from "./update-api.js";
import {
  runUpdateMutationOptions,
  updateKeys,
  updateStatusQueryOptions,
} from "./update-queries.js";

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

test("updateKeys has the documented shape", () => {
  assert.deepEqual(updateKeys.all, ["update"]);
  assert.deepEqual(updateKeys.status, ["update", "status"]);
});

test("updateStatusQueryOptions has the status key and requests /api/update", async () => {
  const options = updateStatusQueryOptions();
  assert.deepEqual(options.queryKey, ["update", "status"]);
  reply(200, { updateAvailable: false });
  assert.deepEqual(await newClient().fetchQuery(options), {
    updateAvailable: false,
  });
  assert.equal(calls[0]?.url, "/api/update");
});

test("runUpdate posts with no body and resolves the run result", async () => {
  reply(200, { ok: false, reason: "busy" });
  assert.deepEqual(await runUpdate(), { ok: false, reason: "busy" });
  assert.equal(calls[0]?.url, "/api/update/run");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
});

test("runUpdate throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    runUpdate(),
    new Error("runUpdate failed: 500 Internal Server Error"),
  );
});

test("the run update mutation resolves the result for a 200 with ok true", async () => {
  reply(200, { ok: true, version: "2.0.0" });
  assert.deepEqual(await runUpdateMutationOptions.mutationFn(), {
    ok: true,
    version: "2.0.0",
  });
  assert.equal(calls[0]?.url, "/api/update/run");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("the run update mutation resolves the result for a 200 with ok false", async () => {
  reply(200, { ok: false, command: "npm i -g x" });
  assert.deepEqual(await runUpdateMutationOptions.mutationFn(), {
    ok: false,
    command: "npm i -g x",
  });
});

test("the run update mutation throws on a non-2xx", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    runUpdateMutationOptions.mutationFn(),
    new Error("runUpdate failed: 500 Internal Server Error"),
  );
});
