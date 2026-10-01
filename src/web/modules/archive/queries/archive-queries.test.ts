import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { deleteArchived, listArchive, restoreArchived } from "./archive-api.js";
import { archiveKeys, archiveQueryOptions } from "./archive-queries.js";

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
