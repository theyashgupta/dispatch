import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { addWorkspaceFolder } from "./workspaces-api.js";
import {
  browseDirectoryQueryOptions,
  discoverFolderQueryOptions,
  workspaceFoldersQueryOptions,
  workspacesKeys,
  workspacesQueryOptions,
} from "./workspaces-queries.js";

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

test("workspacesKeys has the documented shape", () => {
  assert.deepEqual(workspacesKeys.all, ["workspaces"]);
  assert.deepEqual(workspacesKeys.inventory(false), [
    "workspaces",
    "inventory",
    false,
  ]);
  assert.deepEqual(workspacesKeys.folders, ["workspaces", "folders"]);
  assert.deepEqual(workspacesKeys.discover("/w"), [
    "workspaces",
    "discover",
    "/w",
  ]);
  assert.deepEqual(workspacesKeys.browse("/w"), ["workspaces", "browse", "/w"]);
  assert.deepEqual(workspacesKeys.browse(), ["workspaces", "browse", null]);
});

test("workspacesQueryOptions requests the inventory and keys on fresh", async () => {
  const options = workspacesQueryOptions();
  assert.deepEqual(options.queryKey, ["workspaces", "inventory", false]);
  assert.deepEqual(workspacesQueryOptions(true).queryKey, [
    "workspaces",
    "inventory",
    true,
  ]);
  reply(200, { rows: [] });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/workspaces");
});

test("workspacesQueryOptions with fresh requests the fresh inventory", async () => {
  reply(200, { rows: [] });
  await newClient().fetchQuery(workspacesQueryOptions(true));
  assert.equal(calls[0]?.url, "/api/workspaces?fresh=1");
});

test("workspaceFoldersQueryOptions requests the folder registry", async () => {
  const options = workspaceFoldersQueryOptions();
  assert.deepEqual(options.queryKey, ["workspaces", "folders"]);
  reply(200, { folders: ["/w"], lastUsed: null });
  assert.deepEqual(await newClient().fetchQuery(options), {
    folders: ["/w"],
    lastUsed: null,
  });
  assert.equal(calls[0]?.url, "/api/workspace-folders");
});

test("discoverFolderQueryOptions keys on the path and requests discover", async () => {
  const options = discoverFolderQueryOptions("/a b");
  assert.deepEqual(options.queryKey, ["workspaces", "discover", "/a b"]);
  reply(200, { repos: [] });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/workspace-folders/discover?path=%2Fa%20b");
});

test("browseDirectoryQueryOptions requests the listing with and without a path", async () => {
  const options = browseDirectoryQueryOptions("/a");
  assert.deepEqual(options.queryKey, ["workspaces", "browse", "/a"]);
  reply(200, { path: "/a", dirs: [] });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/fs/dirs?path=%2Fa");
  await newClient().fetchQuery(browseDirectoryQueryOptions());
  assert.equal(calls[1]?.url, "/api/fs/dirs");
});

test("addWorkspaceFolder resolves the discovered repos on a 200", async () => {
  reply(200, { repos: [{ path: "/w/a" }] }, "OK");
  assert.deepEqual(await addWorkspaceFolder("/w"), {
    ok: true,
    repos: [{ path: "/w/a" }],
  });
  assert.equal(calls[0]?.url, "/api/workspace-folders");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ path: "/w" }));
});

test("addWorkspaceFolder carries the validation error on a 400", async () => {
  reply(400, { error: "not a directory" }, "Bad Request");
  assert.deepEqual(await addWorkspaceFolder("/w"), {
    ok: false,
    error: "not a directory",
  });
});

test("addWorkspaceFolder falls back to the add-folder copy on a 400 with no error", async () => {
  reply(400, {}, "Bad Request");
  assert.deepEqual(await addWorkspaceFolder("/w"), {
    ok: false,
    error: "Couldn't add folder.",
  });
});

test("addWorkspaceFolder throws on any other failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    addWorkspaceFolder("/w"),
    new Error("addWorkspaceFolder failed: 500 Internal Server Error"),
  );
});
