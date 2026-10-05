import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  connectSource,
  deleteSourceKey,
  disableSource,
  getSourceConnection,
  saveSourceKey,
} from "./source-connection-api.js";
import {
  connectSourceMutationOptions,
  deleteSourceKeyMutationOptions,
  disableSourceMutationOptions,
  saveSourceKeyMutationOptions,
  sourceConnectionKeys,
  sourceConnectionQueryOptions,
} from "./source-connection-queries.js";

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

test("sourceConnectionKeys has the documented shape", () => {
  assert.deepEqual(sourceConnectionKeys.all, ["connections"]);
  assert.deepEqual(sourceConnectionKeys.detail("linear"), [
    "connections",
    "source",
    "linear",
  ]);
});

test("sourceConnectionQueryOptions keys on the source and requests its connection", async () => {
  const options = sourceConnectionQueryOptions("github");
  assert.deepEqual(options.queryKey, ["connections", "source", "github"]);
  reply(200, { connected: true });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/sources/github/connection");
});

test("getSourceConnection resolves the body on a 200", async () => {
  reply(200, { connected: true }, "OK");
  assert.deepEqual(await getSourceConnection("linear"), { connected: true });
});

test("getSourceConnection throws with the status only on a failure", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getSourceConnection("linear"),
    new Error("getSourceConnection failed: 500"),
  );
});

test("disableSource posts to the disable route and resolves on a 200", async () => {
  reply(200, {}, "OK");
  await disableSource("git hub");
  assert.equal(calls[0]?.url, "/api/sources/git%20hub/disable");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("disableSource throws with the status only on a failure", async () => {
  reply(502, {}, "Bad Gateway");
  await assert.rejects(
    disableSource("github"),
    new Error("disableSource failed: 502"),
  );
});

test("deleteSourceKey sends DELETE and resolves on a 200", async () => {
  reply(200, {}, "OK");
  await deleteSourceKey("git hub");
  assert.equal(calls[0]?.url, "/api/sources/git%20hub/key");
  assert.equal(calls[0]?.init?.method, "DELETE");
});

test("deleteSourceKey throws with the status only on a failure", async () => {
  reply(400, {}, "Bad Request");
  await assert.rejects(
    deleteSourceKey("github"),
    new Error("deleteSourceKey failed: 400"),
  );
});

const keyCalls = [
  [
    "saveSourceKey",
    () => saveSourceKey("git hub", "tok"),
    "/api/sources/git%20hub/key",
    "PUT",
  ],
  [
    "connectSource",
    () => connectSource("git hub"),
    "/api/sources/git%20hub/connect",
    "POST",
  ],
] as const;

for (const [name, call, url, method] of keyCalls) {
  test(`${name} requests ${method} ${url}`, async () => {
    reply(200, {}, "OK");
    await call();
    assert.equal(calls[0]?.url, url);
    assert.equal(calls[0]?.init?.method, method);
  });

  test(`${name} resolves ok with the account on a 200`, async () => {
    reply(200, { account: "octocat" }, "OK");
    assert.deepEqual(await call(), { ok: true, account: "octocat" });
  });

  test(`${name} resolves a bare ok on a 200 with no account`, async () => {
    reply(200, {}, "OK");
    assert.deepEqual(await call(), { ok: true });
  });

  test(`${name} resolves a bare ok on a 200 with an empty body`, async () => {
    reply(200, "", "OK");
    assert.deepEqual(await call(), { ok: true });
  });

  for (const kind of [
    "rejected",
    "unreachable",
    "sso-required",
    "superseded",
    "no-credential",
  ]) {
    test(`${name} maps the ${kind} error kind from the body`, async () => {
      reply(500, { error: kind }, "Internal Server Error");
      assert.deepEqual(await call(), { ok: false, reason: kind });
    });
  }

  for (const [status, statusText, reason] of [
    [400, "Bad Request", "rejected"],
    [502, "Bad Gateway", "unreachable"],
    [409, "Conflict", "superseded"],
    [500, "Internal Server Error", "failed"],
    [401, "Unauthorized", "failed"],
  ] as const) {
    test(`${name} falls back to ${reason} on a ${status} with no error kind`, async () => {
      reply(status, {}, statusText);
      assert.deepEqual(await call(), { ok: false, reason });
    });
  }

  test(`${name} falls back on the status when the error kind is unknown`, async () => {
    reply(502, { error: "weird" }, "Bad Gateway");
    assert.deepEqual(await call(), { ok: false, reason: "unreachable" });
  });

  test(`${name} falls back on the status when the error is not a string`, async () => {
    reply(409, { error: 7 }, "Conflict");
    assert.deepEqual(await call(), { ok: false, reason: "superseded" });
  });

  test(`${name} falls back on the status for a non-JSON failure body`, async () => {
    reply(502, "<html>bad gateway</html>", "Bad Gateway");
    assert.deepEqual(await call(), { ok: false, reason: "unreachable" });
  });

  test(`${name} reads a 200 with a non-JSON body as failed`, async () => {
    reply(200, "<html>", "OK");
    assert.deepEqual(await call(), { ok: false, reason: "failed" });
  });

  test(`${name} keeps a plain lowercase provider error`, async () => {
    reply(400, { error: "rejected", providerError: "invalid_auth" }, "x");
    assert.deepEqual(await call(), {
      ok: false,
      reason: "rejected",
      providerError: "invalid_auth",
    });
  });

  for (const providerError of ["Invalid Auth!", "INVALID", "", 7, null]) {
    test(`${name} drops the provider error ${JSON.stringify(providerError)}`, async () => {
      reply(400, { error: "rejected", providerError }, "Bad Request");
      assert.deepEqual(await call(), { ok: false, reason: "rejected" });
    });
  }

  test(`${name} rejects on a network failure`, async () => {
    const failure = new TypeError("Failed to fetch");
    globalThis.fetch = () => Promise.reject(failure);
    await assert.rejects(call(), (err) => err === failure);
  });
}

test("saveSourceKey sends the key once in a JSON body", async () => {
  reply(200, {}, "OK");
  await saveSourceKey("linear", "lin_key");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ apiKey: "lin_key" }));
  assert.deepEqual(calls[0]?.init?.headers, {
    "Content-Type": "application/json",
  });
});

test("connectSource sends no body", async () => {
  reply(200, {}, "OK");
  await connectSource("github");
  assert.equal(calls[0]?.init?.body, undefined);
});

const detailKey = sourceConnectionKeys.detail("linear");
const server = { configured: true, connected: true, account: "ada" };

function routes(
  handlers: Record<string, { status: number; body: unknown }>,
): string[] {
  const seen: string[] = [];
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${typeof url === "string" ? url : url instanceof URL ? url.href : url.url}`;
    seen.push(key);
    const handler = handlers[key] ?? { status: 404, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(handler.body), { status: handler.status }),
    );
  };
  return seen;
}

async function seeded(): Promise<QueryClient> {
  const client = newClient();
  reply(200, { configured: false, connected: false });
  await client.fetchQuery(sourceConnectionQueryOptions("linear"));
  return client;
}

test("a saved key re-reads the connection after writing it", async () => {
  const client = await seeded();
  const seen = routes({
    "PUT /api/sources/linear/key": { status: 200, body: { account: "ada" } },
    "GET /api/sources/linear/connection": { status: 200, body: server },
  });
  await new MutationObserver(
    client,
    saveSourceKeyMutationOptions(client, "linear"),
  ).mutate("lin_key");
  assert.deepEqual(seen, [
    "PUT /api/sources/linear/key",
    "GET /api/sources/linear/connection",
  ]);
  assert.deepEqual(client.getQueryData(detailKey), server);
});

test("a rejected key leaves the cached connection and reads nothing", async () => {
  const client = await seeded();
  const seen = routes({
    "PUT /api/sources/linear/key": { status: 400, body: { error: "rejected" } },
  });
  const result = await new MutationObserver(
    client,
    saveSourceKeyMutationOptions(client, "linear"),
  ).mutate("bad");
  assert.deepEqual(result, { ok: false, reason: "rejected" });
  assert.deepEqual(seen, ["PUT /api/sources/linear/key"]);
  assert.deepEqual(client.getQueryData(detailKey), {
    configured: false,
    connected: false,
  });
});

for (const reason of ["superseded", "failed"] as const) {
  test(`a ${reason} key save re-reads the connection`, async () => {
    const client = await seeded();
    const status = reason === "superseded" ? 409 : 500;
    const seen = routes({
      "PUT /api/sources/linear/key": { status, body: { error: reason } },
      "GET /api/sources/linear/connection": { status: 200, body: server },
    });
    await new MutationObserver(
      client,
      saveSourceKeyMutationOptions(client, "linear"),
    ).mutate("key");
    assert.deepEqual(seen, [
      "PUT /api/sources/linear/key",
      "GET /api/sources/linear/connection",
    ]);
    assert.deepEqual(client.getQueryData(detailKey), server);
  });
}

test("the connect mutation re-reads only after an accepted connect", async () => {
  const client = await seeded();
  const seen = routes({
    "POST /api/sources/linear/connect": { status: 200, body: {} },
    "GET /api/sources/linear/connection": { status: 200, body: server },
  });
  await new MutationObserver(
    client,
    connectSourceMutationOptions(client, "linear"),
  ).mutate(undefined);
  assert.deepEqual(seen, [
    "POST /api/sources/linear/connect",
    "GET /api/sources/linear/connection",
  ]);
  assert.deepEqual(client.getQueryData(detailKey), server);
});

test("a refused connect reads nothing", async () => {
  const client = await seeded();
  const seen = routes({
    "POST /api/sources/linear/connect": {
      status: 400,
      body: { error: "no-credential" },
    },
  });
  const result = await new MutationObserver(
    client,
    connectSourceMutationOptions(client, "linear"),
  ).mutate(undefined);
  assert.deepEqual(result, { ok: false, reason: "no-credential" });
  assert.deepEqual(seen, ["POST /api/sources/linear/connect"]);
});

test("the disable mutation re-reads the connection after it succeeds", async () => {
  const client = await seeded();
  const seen = routes({
    "POST /api/sources/linear/disable": { status: 200, body: {} },
    "GET /api/sources/linear/connection": { status: 200, body: server },
  });
  await new MutationObserver(
    client,
    disableSourceMutationOptions(client, "linear"),
  ).mutate(undefined);
  assert.deepEqual(seen, [
    "POST /api/sources/linear/disable",
    "GET /api/sources/linear/connection",
  ]);
  assert.deepEqual(client.getQueryData(detailKey), server);
});

test("the disable mutation re-reads the connection when it fails", async () => {
  const client = await seeded();
  const seen = routes({
    "POST /api/sources/linear/disable": { status: 500, body: {} },
    "GET /api/sources/linear/connection": { status: 200, body: server },
  });
  await assert.rejects(
    new MutationObserver(
      client,
      disableSourceMutationOptions(client, "linear"),
    ).mutate(undefined),
    new Error("disableSource failed: 500"),
  );
  assert.deepEqual(seen, [
    "POST /api/sources/linear/disable",
    "GET /api/sources/linear/connection",
  ]);
});

test("a deleted key re-reads the connection after writing a disconnected one", async () => {
  const client = await seeded();
  const seen = routes({
    "DELETE /api/sources/linear/key": { status: 200, body: {} },
    "GET /api/sources/linear/connection": {
      status: 200,
      body: { configured: false, connected: false },
    },
  });
  await new MutationObserver(
    client,
    deleteSourceKeyMutationOptions(client, "linear"),
  ).mutate(undefined);
  assert.deepEqual(seen, [
    "DELETE /api/sources/linear/key",
    "GET /api/sources/linear/connection",
  ]);
  assert.deepEqual(client.getQueryData(detailKey), {
    configured: false,
    connected: false,
  });
});

test("a failed key delete re-reads the connection and rejects", async () => {
  const client = await seeded();
  const seen = routes({
    "DELETE /api/sources/linear/key": { status: 500, body: {} },
    "GET /api/sources/linear/connection": { status: 200, body: server },
  });
  await assert.rejects(
    new MutationObserver(
      client,
      deleteSourceKeyMutationOptions(client, "linear"),
    ).mutate(undefined),
    new Error("deleteSourceKey failed: 500"),
  );
  assert.deepEqual(seen, [
    "DELETE /api/sources/linear/key",
    "GET /api/sources/linear/connection",
  ]);
  assert.deepEqual(client.getQueryData(detailKey), server);
});
