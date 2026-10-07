import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { deleteArchived, listArchive, restoreArchived } from "./archive-api.js";
import {
  archiveKeys,
  archiveQueryOptions,
  deleteArchivedMutationOptions,
  restoreArchivedMutationOptions,
} from "./archive-queries.js";

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

test("archiveKeys has the documented shape", () => {
  assert.deepEqual(archiveKeys.all, ["archive"]);
  assert.deepEqual(archiveKeys.list, ["archive", "list"]);
});

test("archiveQueryOptions requests the archive list", async () => {
  const options = archiveQueryOptions();
  assert.deepEqual(options.queryKey, ["archive", "list"]);
  reply(200, { archived: [{ id: "g1" }] });
  assert.deepEqual(await newClient().fetchQuery(options), [{ id: "g1" }]);
  assert.equal(calls[0]?.url, "/api/archive");
});

test("listArchive throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    listArchive(),
    new Error("listArchive failed: 500 Internal Server Error"),
  );
});

test("restoreArchived resolves ok on a 200", async () => {
  reply(200, {});
  assert.deepEqual(await restoreArchived("g 1"), { ok: true });
  assert.equal(calls[0]?.url, "/api/archive/g%201/restore");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("restoreArchived carries the server reason on a 404", async () => {
  reply(404, { error: "gone" });
  assert.deepEqual(await restoreArchived("g1"), { ok: false, error: "gone" });
});

test("restoreArchived carries the server reason on a 409", async () => {
  reply(409, { error: "member moved on" });
  assert.deepEqual(await restoreArchived("g1"), {
    ok: false,
    error: "member moved on",
  });
});

test("restoreArchived falls back to the restore copy on a 409 with no reason", async () => {
  reply(409, "");
  assert.deepEqual(await restoreArchived("g1"), {
    ok: false,
    error: "Couldn't restore this group.",
  });
});

test("restoreArchived throws on any other failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    restoreArchived("g1"),
    new Error("restoreArchived failed: 500 Internal Server Error"),
  );
});

test("deleteArchived resolves ok on a 200 and sends force", async () => {
  reply(200, {});
  assert.deepEqual(await deleteArchived("g 1", true), { ok: true });
  assert.equal(calls[0]?.url, "/api/archive/g%201");
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ force: true }));
});

test("deleteArchived carries the server reason on a 404", async () => {
  reply(404, { error: "gone" });
  assert.deepEqual(await deleteArchived("g1", false), {
    ok: false,
    error: "gone",
  });
});

test("deleteArchived carries the server reason on a 409", async () => {
  reply(409, { error: "dirty worktree" });
  assert.deepEqual(await deleteArchived("g1", false), {
    ok: false,
    error: "dirty worktree",
  });
});

test("deleteArchived falls back to the delete copy on a 409 with no reason", async () => {
  reply(409, {});
  assert.deepEqual(await deleteArchived("g1", false), {
    ok: false,
    error: "Couldn't delete this group.",
  });
});

test("deleteArchived throws on any other failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    deleteArchived("g1", false),
    new Error("deleteArchived failed: 500 Internal Server Error"),
  );
});

function listIsStale(client: QueryClient): boolean {
  return client.getQueryState(archiveKeys.list)?.isInvalidated === true;
}

function seededClient(): QueryClient {
  const client = newClient();
  client.setQueryData(archiveKeys.list, [{ id: "g1" }]);
  return client;
}

function restore(client: QueryClient) {
  return new MutationObserver(
    client,
    restoreArchivedMutationOptions(client),
  ).mutate("g1");
}

function remove(client: QueryClient) {
  return new MutationObserver(
    client,
    deleteArchivedMutationOptions(client),
  ).mutate({ id: "g1", force: true });
}

test("a restored group marks the list stale", async () => {
  const client = seededClient();
  reply(200, {});
  assert.deepEqual(await restore(client), { ok: true });
  assert.equal(calls[0]?.url, "/api/archive/g1/restore");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(listIsStale(client), true);
});

test("a refused restore resolves the reason and leaves the list alone", async () => {
  const client = seededClient();
  reply(409, { error: "member moved on" }, "Conflict");
  assert.deepEqual(await restore(client), {
    ok: false,
    error: "member moved on",
  });
  assert.equal(listIsStale(client), false);
});

test("a failed restore rejects and leaves the list alone", async () => {
  const client = seededClient();
  reply(500, {}, "Internal Server Error");
  await assert.rejects(restore(client));
  assert.equal(listIsStale(client), false);
});

test("a deleted group marks the list stale", async () => {
  const client = seededClient();
  reply(200, {});
  assert.deepEqual(await remove(client), { ok: true });
  assert.equal(calls[0]?.url, "/api/archive/g1");
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ force: true }));
  assert.equal(listIsStale(client), true);
});

test("a refused delete resolves the reason and still marks the list stale", async () => {
  const client = seededClient();
  reply(409, { error: "worktree is dirty" }, "Conflict");
  assert.deepEqual(await remove(client), {
    ok: false,
    error: "worktree is dirty",
  });
  assert.equal(listIsStale(client), true);
});

test("a failed delete rejects and leaves the list alone", async () => {
  const client = seededClient();
  reply(500, {}, "Internal Server Error");
  await assert.rejects(remove(client));
  assert.equal(listIsStale(client), false);
});

test("the archive list is dropped once the page closes, so every open reads it fresh", () => {
  assert.equal(archiveQueryOptions().gcTime, 0);
});
