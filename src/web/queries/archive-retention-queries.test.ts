import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  getArchiveRetention,
  saveArchiveRetention,
} from "./archive-retention-api.js";
import {
  archiveRetentionKeys,
  archiveRetentionQueryOptions,
  retentionSaveErrorText,
  saveArchiveRetentionMutationOptions,
} from "./archive-retention-queries.js";

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

test("archiveRetentionKeys has the documented shape", () => {
  assert.deepEqual(archiveRetentionKeys.all, ["settings", "archive-retention"]);
});

test("archiveRetentionQueryOptions has its key and requests the retention route", async () => {
  const options = archiveRetentionQueryOptions();
  assert.deepEqual(options.queryKey, ["settings", "archive-retention"]);
  reply(200, { archiveRetentionDays: 30 });
  assert.deepEqual(await newClient().fetchQuery(options), {
    archiveRetentionDays: 30,
  });
  assert.equal(calls[0]?.url, "/api/config/archive-retention");
});

test("getArchiveRetention throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getArchiveRetention(),
    new Error("getArchiveRetention failed: 500 Internal Server Error"),
  );
});

test("saveArchiveRetention resolves ok on a 200", async () => {
  reply(200, {}, "OK");
  assert.deepEqual(await saveArchiveRetention(30), { ok: true });
  assert.equal(calls[0]?.url, "/api/config/archive-retention");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ archiveRetentionDays: 30 }),
  );
});

test("saveArchiveRetention carries the validation error on a 400", async () => {
  reply(400, { error: "out of range" }, "Bad Request");
  assert.deepEqual(await saveArchiveRetention(0), {
    ok: false,
    error: "out of range",
  });
});

test("saveArchiveRetention falls back to its copy on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await saveArchiveRetention(0), {
    ok: false,
    error: "Couldn't save archive retention.",
  });
});

test("saveArchiveRetention throws on any other failure status", async () => {
  reply(502, {}, "Bad Gateway");
  await assert.rejects(
    saveArchiveRetention(30),
    new Error("saveArchiveRetention failed: 502 Bad Gateway"),
  );
});

test("an accepted retention save writes the saved days into the cache", async () => {
  const client = newClient();
  client.setQueryData(archiveRetentionKeys.all, { archiveRetentionDays: 30 });
  reply(200, {});
  const result = await new MutationObserver(
    client,
    saveArchiveRetentionMutationOptions(client),
  ).mutate(14);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(client.getQueryData(archiveRetentionKeys.all), {
    archiveRetentionDays: 14,
  });
});

test("a refused retention save resolves the message and leaves the cache alone", async () => {
  const client = newClient();
  client.setQueryData(archiveRetentionKeys.all, { archiveRetentionDays: 30 });
  reply(400, { error: "out of range" }, "Bad Request");
  const result = await new MutationObserver(
    client,
    saveArchiveRetentionMutationOptions(client),
  ).mutate(999);
  assert.deepEqual(result, { ok: false, error: "out of range" });
  assert.deepEqual(client.getQueryData(archiveRetentionKeys.all), {
    archiveRetentionDays: 30,
  });
});

test("a failed retention save rejects and leaves the cache alone", async () => {
  const client = newClient();
  client.setQueryData(archiveRetentionKeys.all, { archiveRetentionDays: 30 });
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    new MutationObserver(
      client,
      saveArchiveRetentionMutationOptions(client),
    ).mutate(14),
    new Error("saveArchiveRetention failed: 500 Internal Server Error"),
  );
  assert.deepEqual(client.getQueryData(archiveRetentionKeys.all), {
    archiveRetentionDays: 30,
  });
});

test("the retention save error is the server message on a refusal, a fixed line on a failure, else none", () => {
  assert.equal(
    retentionSaveErrorText({ ok: false, error: "Must be 0 to 365." }, false),
    "Must be 0 to 365.",
  );
  assert.equal(
    retentionSaveErrorText(undefined, true),
    "Couldn't save archive retention. Try again.",
  );
  assert.equal(retentionSaveErrorText({ ok: true }, false), null);
  assert.equal(retentionSaveErrorText(undefined, false), null);
});
