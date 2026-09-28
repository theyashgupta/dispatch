import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { fetchLinearAccount, testLinearConnection } from "./linear.source.js";

const KEY = "lin_api_fake_viewer_key";

function answer(status: number, body: unknown): void {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function viewer(extra: Record<string, unknown>) {
  return { data: { viewer: { id: "u1", ...extra } } };
}

afterEach(() => {
  mock.restoreAll();
});

test("a viewer with name and email yields 'name (email)'", async () => {
  answer(200, viewer({ name: "Ada", email: "ada@x.dev" }));
  assert.deepEqual(await fetchLinearAccount(KEY), {
    account: "Ada (ada@x.dev)",
  });
});

test("a viewer with only a name or only an email yields that one", async () => {
  answer(200, viewer({ name: "Ada", email: null }));
  assert.deepEqual(await fetchLinearAccount(KEY), { account: "Ada" });
  mock.restoreAll();
  answer(200, viewer({ email: "ada@x.dev" }));
  assert.deepEqual(await fetchLinearAccount(KEY), { account: "ada@x.dev" });
});

test("a viewer with neither name nor email is valid with no account label", async () => {
  answer(200, viewer({ name: "  ", email: "" }));
  assert.deepEqual(await fetchLinearAccount(KEY), {});
});

test("a 200 with no viewer id is a rejection (null)", async () => {
  answer(200, { data: { viewer: { name: "Ada" } } });
  assert.equal(await fetchLinearAccount(KEY), null);
  mock.restoreAll();
  answer(200, { data: {} });
  assert.equal(await fetchLinearAccount(KEY), null);
});

test("HTTP 401 and a GraphQL authentication error are rejections (null)", async () => {
  answer(401, {});
  assert.equal(await fetchLinearAccount(KEY), null);
  mock.restoreAll();
  answer(200, {
    errors: [
      { message: "bad key", extensions: { code: "AUTHENTICATION_ERROR" } },
    ],
  });
  assert.equal(await fetchLinearAccount(KEY), null);
});

test("a rate limit, a 5xx, a non-JSON body and a network error re-throw instead of reporting a rejection", async () => {
  answer(429, {});
  await assert.rejects(fetchLinearAccount(KEY));
  mock.restoreAll();
  answer(500, { errors: [{ message: "boom" }] });
  await assert.rejects(fetchLinearAccount(KEY));
  mock.restoreAll();
  answer(502, "<html>outage</html>");
  await assert.rejects(fetchLinearAccount(KEY));
  mock.restoreAll();
  mock.method(globalThis, "fetch", () =>
    Promise.reject(new TypeError("fetch failed")),
  );
  await assert.rejects(fetchLinearAccount(KEY), TypeError);
});

test("the request carries the key only in the Authorization header and asks for name and email", async () => {
  const calls: RequestInit[] = [];
  mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => {
    calls.push(init);
    return Promise.resolve(
      new Response(JSON.stringify(viewer({ name: "Ada" })), { status: 200 }),
    );
  });
  await fetchLinearAccount(KEY);
  const init = calls[0];
  assert.equal((init.headers as Record<string, string>).Authorization, KEY);
  const body = init.body as string;
  assert.match(body, /viewer \{ id name email \}/);
  assert.ok(!body.includes(KEY));
});

test("testLinearConnection keeps its boolean contract", async () => {
  answer(200, viewer({ name: "Ada" }));
  assert.equal(await testLinearConnection(KEY), true);
  mock.restoreAll();
  answer(403, {});
  assert.equal(await testLinearConnection(KEY), false);
  mock.restoreAll();
  answer(429, {});
  await assert.rejects(testLinearConnection(KEY));
});
