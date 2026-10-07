import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  deleteSourceKey,
  getSourceConnection,
  saveSourceKey,
} from "./source-connection-api.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

/** Replace fetch with one that answers every request with the given status and JSON body. */
function answer(status: number, body: unknown = {}): void {
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("saveSourceKey sends the key once in a PUT body and returns the account on 200", async () => {
  answer(200, { account: "Ada (a@x.dev)" });
  assert.deepEqual(await saveSourceKey("linear", "lin_api_x"), {
    ok: true,
    account: "Ada (a@x.dev)",
  });
  assert.equal(calls[0]?.url, "/api/sources/linear/key");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ apiKey: "lin_api_x" }));
});

test("saveSourceKey on 200 without an account is still ok", async () => {
  answer(200, {});
  assert.deepEqual(await saveSourceKey("linear", "k"), { ok: true });
});

test("saveSourceKey maps each failure status to its reason", async () => {
  for (const [status, reason] of [
    [400, "rejected"],
    [502, "unreachable"],
    [409, "superseded"],
    [500, "failed"],
    [404, "failed"],
  ] as const) {
    answer(status, { error: "x" });
    assert.deepEqual(await saveSourceKey("linear", "k"), { ok: false, reason });
  }
});

test("getSourceConnection returns the body on 200 and throws on non-2xx", async () => {
  answer(200, { configured: true, connected: true, account: "Ada" });
  assert.deepEqual(await getSourceConnection("linear"), {
    configured: true,
    connected: true,
    account: "Ada",
  });
  assert.equal(calls[0]?.url, "/api/sources/linear/connection");
  answer(500);
  await assert.rejects(getSourceConnection("linear"), /500/);
});

test("deleteSourceKey sends DELETE and throws on non-2xx", async () => {
  answer(200, { ok: true });
  await deleteSourceKey("linear");
  assert.equal(calls[0]?.init?.method, "DELETE");
  answer(500);
  await assert.rejects(deleteSourceKey("linear"), /500/);
});
