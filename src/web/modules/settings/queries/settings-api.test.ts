import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getProfile, saveProfile } from "./settings-api.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

/** Replace fetch with one that answers every request with the given status and raw body. */
function answer(status: number, body: string): void {
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(body, {
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

test("getProfile returns the body on 200 and throws on any other status", async () => {
  answer(200, JSON.stringify({ name: "Ada" }));
  assert.deepEqual(await getProfile(), { name: "Ada" });
  assert.equal(calls[0]?.url, "/api/config/profile");
  answer(500, "{}");
  await assert.rejects(getProfile(), /getProfile failed: 500/);
});

test("saveProfile sends a PUT and returns the stored profile on 200", async () => {
  answer(200, JSON.stringify({ name: "Ada", handles: ["@ada"] }));
  assert.deepEqual(await saveProfile({ name: " Ada " }), {
    ok: true,
    profile: { name: "Ada", handles: ["@ada"] },
  });
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ name: " Ada " }));
});

test("saveProfile maps a 400 to the server message, or a fallback when the body has none", async () => {
  answer(400, JSON.stringify({ error: "name is at most 200 characters" }));
  assert.deepEqual(await saveProfile({}), {
    ok: false,
    error: "name is at most 200 characters",
  });
  answer(400, "not json");
  assert.deepEqual(await saveProfile({}), {
    ok: false,
    error: "Invalid profile",
  });
});

test("saveProfile throws on a non-400 failure", async () => {
  answer(500, "{}");
  await assert.rejects(saveProfile({}), /saveProfile failed: 500/);
});
