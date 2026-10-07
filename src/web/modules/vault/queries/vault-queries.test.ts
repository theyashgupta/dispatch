import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  addVaultKey,
  deleteVaultKey,
  editVaultPurpose,
  getVaultKeys,
  getVaultPrevious,
  getVaultValue,
  importFromEnvVault,
  setVaultValue,
} from "./vault-api.js";
import {
  addVaultKeyMutationOptions,
  deleteVaultKeyMutationOptions,
  editVaultPurposeMutationOptions,
  importFromEnvVaultMutationOptions,
  setVaultValueMutationOptions,
  vaultKeys,
  vaultKeysQueryOptions,
  vaultPreviousQueryOptions,
  vaultValueQueryOptions,
} from "./vault-queries.js";

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

test("vaultValueQueryOptions never serves stale data and drops the secret when unobserved", () => {
  const options = vaultValueQueryOptions("K");
  assert.equal(options.staleTime, 0);
  assert.equal(options.gcTime, 0);
});

test("vaultPreviousQueryOptions never serves stale data and drops the secret when unobserved", () => {
  const options = vaultPreviousQueryOptions("K");
  assert.equal(options.staleTime, 0);
  assert.equal(options.gcTime, 0);
});

test("vaultKeys has the documented shape", () => {
  assert.deepEqual(vaultKeys.all, ["vault"]);
  assert.deepEqual(vaultKeys.list, ["vault", "list"]);
  assert.deepEqual(vaultKeys.value("K"), ["vault", "value", "K"]);
  assert.deepEqual(vaultKeys.previous("K"), ["vault", "previous", "K"]);
});

test("vaultKeysQueryOptions requests the key list", async () => {
  const options = vaultKeysQueryOptions();
  assert.deepEqual(options.queryKey, ["vault", "list"]);
  reply(200, { keys: [], envVaultAvailable: true });
  assert.deepEqual(await newClient().fetchQuery(options), {
    keys: [],
    envVaultAvailable: true,
  });
  assert.equal(calls[0]?.url, "/api/vault");
});

test("vaultValueQueryOptions keys on the name, requests the value and drops it from the cache", async () => {
  const options = vaultValueQueryOptions("A_KEY");
  assert.deepEqual(options.queryKey, ["vault", "value", "A_KEY"]);
  assert.equal(options.gcTime, 0);
  reply(200, { value: "secret" });
  assert.deepEqual(await newClient().fetchQuery(options), {
    ok: true,
    value: "secret",
  });
  assert.equal(calls[0]?.url, "/api/vault/A_KEY/value");
});

test("vaultPreviousQueryOptions keys on the name, requests the previous value and drops it from the cache", async () => {
  const options = vaultPreviousQueryOptions("A_KEY");
  assert.deepEqual(options.queryKey, ["vault", "previous", "A_KEY"]);
  assert.equal(options.gcTime, 0);
  reply(200, { value: "old" });
  assert.deepEqual(await newClient().fetchQuery(options), {
    ok: true,
    value: "old",
  });
  assert.equal(calls[0]?.url, "/api/vault/A_KEY/previous");
});

test("getVaultKeys throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getVaultKeys(),
    new Error("getVaultKeys failed: 500 Internal Server Error"),
  );
});

test("importFromEnvVault resolves the imported and skipped names on a 200", async () => {
  reply(200, { imported: ["A"], skipped: ["B"] });
  assert.deepEqual(await importFromEnvVault(), {
    ok: true,
    imported: ["A"],
    skipped: ["B"],
  });
  assert.equal(calls[0]?.url, "/api/vault/import");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("importFromEnvVault carries the server error on a failure", async () => {
  reply(400, { error: "no-env-vault" });
  assert.deepEqual(await importFromEnvVault(), {
    ok: false,
    error: "no-env-vault",
  });
});

test("importFromEnvVault falls back to generic with no error", async () => {
  reply(500, "");
  assert.deepEqual(await importFromEnvVault(), {
    ok: false,
    error: "generic",
  });
});

test("addVaultKey resolves ok on a 200 and sends no value", async () => {
  reply(200, {});
  assert.deepEqual(await addVaultKey({ name: "A", purpose: "p" }), {
    ok: true,
  });
  assert.equal(calls[0]?.url, "/api/vault");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ name: "A", purpose: "p" }),
  );
});

test("addVaultKey carries the server error verbatim", async () => {
  reply(409, { error: "name-exists" });
  assert.deepEqual(await addVaultKey({ name: "A", purpose: "p" }), {
    ok: false,
    error: "name-exists",
  });
});

test("addVaultKey falls back to generic with no error", async () => {
  reply(500, {});
  assert.deepEqual(await addVaultKey({ name: "A", purpose: "p" }), {
    ok: false,
    error: "generic",
  });
});

test("setVaultValue resolves ok on a 200 and keeps the value out of the URL", async () => {
  reply(200, {});
  assert.deepEqual(await setVaultValue("A B", "s3cret"), { ok: true });
  assert.equal(calls[0]?.url, "/api/vault/A%20B/value");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ value: "s3cret" }));
});

test("setVaultValue carries the server error verbatim", async () => {
  reply(400, { error: "invalid-value" });
  assert.deepEqual(await setVaultValue("A", "v"), {
    ok: false,
    error: "invalid-value",
  });
});

test("setVaultValue falls back to generic with no error", async () => {
  reply(500, {});
  assert.deepEqual(await setVaultValue("A", "v"), {
    ok: false,
    error: "generic",
  });
});

test("getVaultValue carries the server error on a failure", async () => {
  reply(404, { error: "not-found" });
  assert.deepEqual(await getVaultValue("A"), {
    ok: false,
    error: "not-found",
  });
});

test("getVaultPrevious falls back to generic with no error", async () => {
  reply(500, {});
  assert.deepEqual(await getVaultPrevious("A"), {
    ok: false,
    error: "generic",
  });
});

test("editVaultPurpose resolves ok on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await editVaultPurpose("A", "new"), { ok: true });
  assert.equal(calls[0]?.url, "/api/vault/A");
  assert.equal(calls[0]?.init?.method, "PATCH");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ purpose: "new" }));
});

test("editVaultPurpose carries the server error verbatim", async () => {
  reply(400, { error: "invalid-purpose" });
  assert.deepEqual(await editVaultPurpose("A", "x"), {
    ok: false,
    error: "invalid-purpose",
  });
});

test("editVaultPurpose falls back to generic with no error", async () => {
  reply(500, {});
  assert.deepEqual(await editVaultPurpose("A", "x"), {
    ok: false,
    error: "generic",
  });
});

test("deleteVaultKey resolves ok true on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await deleteVaultKey("A B"), { ok: true });
  assert.equal(calls[0]?.url, "/api/vault/A%20B");
  assert.equal(calls[0]?.init?.method, "DELETE");
});

test("deleteVaultKey resolves ok false on a 404", async () => {
  reply(404, {});
  assert.deepEqual(await deleteVaultKey("A"), { ok: false });
});

test("deleteVaultKey resolves ok false on a 500", async () => {
  reply(500, {});
  assert.deepEqual(await deleteVaultKey("A"), { ok: false });
});

function listIsStale(client: QueryClient): boolean {
  return client.getQueryState(vaultKeys.list)?.isInvalidated === true;
}

function seededClient(): QueryClient {
  const client = newClient();
  client.setQueryData(vaultKeys.list, { keys: [], envVaultAvailable: false });
  return client;
}

const vaultWrites = [
  {
    name: "add",
    run: (client: QueryClient) =>
      new MutationObserver(client, addVaultKeyMutationOptions(client)).mutate({
        name: "API_KEY",
        purpose: "for the api",
      }),
    url: "/api/vault",
    method: "POST",
  },
  {
    name: "set value",
    run: (client: QueryClient) =>
      new MutationObserver(client, setVaultValueMutationOptions(client)).mutate(
        { name: "API_KEY", value: "v1" },
      ),
    url: "/api/vault/API_KEY/value",
    method: "PUT",
  },
  {
    name: "edit purpose",
    run: (client: QueryClient) =>
      new MutationObserver(
        client,
        editVaultPurposeMutationOptions(client),
      ).mutate({ name: "API_KEY", purpose: "new purpose" }),
    url: "/api/vault/API_KEY",
    method: "PATCH",
  },
];

for (const write of vaultWrites) {
  test(`an accepted vault ${write.name} marks the list stale`, async () => {
    const client = seededClient();
    reply(200, {});
    assert.deepEqual(await write.run(client), { ok: true });
    assert.equal(calls[0]?.url, write.url);
    assert.equal(calls[0]?.init?.method, write.method);
    assert.equal(listIsStale(client), true);
  });

  test(`a refused vault ${write.name} resolves the code and leaves the list alone`, async () => {
    const client = seededClient();
    reply(400, { error: "invalid-name" }, "Bad Request");
    assert.deepEqual(await write.run(client), {
      ok: false,
      error: "invalid-name",
    });
    assert.equal(listIsStale(client), false);
  });
}

test("a deleted vault key marks the list stale", async () => {
  const client = seededClient();
  reply(200, {});
  const result = await new MutationObserver(
    client,
    deleteVaultKeyMutationOptions(client),
  ).mutate("API_KEY");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.url, "/api/vault/API_KEY");
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(listIsStale(client), true);
});

test("a refused vault delete resolves ok false and leaves the list alone", async () => {
  const client = seededClient();
  reply(404, {}, "Not Found");
  const result = await new MutationObserver(
    client,
    deleteVaultKeyMutationOptions(client),
  ).mutate("API_KEY");
  assert.deepEqual(result, { ok: false });
  assert.equal(listIsStale(client), false);
});

test("an env vault import marks the list stale", async () => {
  const client = seededClient();
  reply(200, { imported: ["A"], skipped: ["B"] });
  const result = await new MutationObserver(
    client,
    importFromEnvVaultMutationOptions(client),
  ).mutate();
  assert.deepEqual(result, { ok: true, imported: ["A"], skipped: ["B"] });
  assert.equal(calls[0]?.url, "/api/vault/import");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(listIsStale(client), true);
});

test("a refused env vault import resolves the code and leaves the list alone", async () => {
  const client = seededClient();
  reply(500, { error: "vault-write-failed" }, "Internal Server Error");
  const result = await new MutationObserver(
    client,
    importFromEnvVaultMutationOptions(client),
  ).mutate();
  assert.deepEqual(result, { ok: false, error: "vault-write-failed" });
  assert.equal(listIsStale(client), false);
});

test("a vault value travels only in the request body, never in a URL or a query key", async () => {
  const secret = "s3cret-value-for-the-key-test";
  reply(200, { ok: true });
  const client = newClient();
  await new MutationObserver(
    client,
    setVaultValueMutationOptions(client),
  ).mutate({ name: "API_KEY", value: secret });
  const put = calls.find((c) => c.init?.method === "PUT");
  assert.ok(put, "the set value request was sent");
  assert.equal(put.url.includes(secret), false);
  const body = typeof put.init?.body === "string" ? put.init.body : "";
  assert.equal(body.includes(secret), true);
  const keys = [
    vaultKeys.all,
    vaultKeys.list,
    vaultKeys.value("API_KEY"),
    vaultKeys.previous("API_KEY"),
    vaultValueQueryOptions("API_KEY").queryKey,
    vaultPreviousQueryOptions("API_KEY").queryKey,
  ];
  for (const key of keys)
    assert.equal(JSON.stringify(key).includes(secret), false);
  for (const query of client.getQueryCache().getAll()) {
    assert.equal(JSON.stringify(query.queryKey).includes(secret), false);
  }
});

test("the vault key list is dropped once the page closes, so every open reads it fresh", () => {
  assert.equal(vaultKeysQueryOptions().gcTime, 0);
});
