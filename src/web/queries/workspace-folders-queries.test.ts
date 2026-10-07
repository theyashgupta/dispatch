import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  addWorkspaceFolder,
  browseDirectory,
  discoverWorkspaceFolder,
  getWorkspaceFolders,
  removeWorkspaceFolder,
} from "./workspace-folders-api.js";
import {
  addWorkspaceFolderMutationOptions,
  browseDirectoryQueryOptions,
  browseTargetOnOpenChange,
  discoverWorkspaceFolderQueryOptions,
  removeWorkspaceFolderMutationOptions,
  useFolderBrowser,
  workspaceFoldersKeys,
  workspaceFoldersQueryOptions,
} from "./workspace-folders-queries.js";

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

test("workspaceFoldersKeys has the documented shape", () => {
  assert.deepEqual(workspaceFoldersKeys.all, ["workspaces"]);
  assert.deepEqual(workspaceFoldersKeys.folders, ["workspaces", "folders"]);
  assert.deepEqual(workspaceFoldersKeys.browse("/w"), [
    "workspaces",
    "browse",
    "/w",
  ]);
  assert.deepEqual(workspaceFoldersKeys.browse(), [
    "workspaces",
    "browse",
    null,
  ]);
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

test("browseDirectoryQueryOptions requests the listing with and without a path", async () => {
  const options = browseDirectoryQueryOptions("/a");
  assert.deepEqual(options.queryKey, ["workspaces", "browse", "/a"]);
  reply(200, { path: "/a", dirs: [] });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/fs/dirs?path=%2Fa");
  await newClient().fetchQuery(browseDirectoryQueryOptions());
  assert.equal(calls[1]?.url, "/api/fs/dirs");
});

test("getWorkspaceFolders throws on a failure status", async () => {
  reply(502, {}, "Bad Gateway");
  await assert.rejects(
    getWorkspaceFolders(),
    new Error("getWorkspaceFolders failed: 502 Bad Gateway"),
  );
});

test("browseDirectory throws on a failure status", async () => {
  reply(400, { error: "not a directory" }, "Bad Request");
  await assert.rejects(
    browseDirectory("/x"),
    new Error("browseDirectory failed: 400 Bad Request"),
  );
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

test("removeWorkspaceFolder sends DELETE with the path and resolves on a 200", async () => {
  reply(200, {}, "OK");
  await removeWorkspaceFolder("/w");
  assert.equal(calls[0]?.url, "/api/workspace-folders");
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ path: "/w" }));
});

test("removeWorkspaceFolder throws on a failure status", async () => {
  reply(502, {}, "Bad Gateway");
  await assert.rejects(
    removeWorkspaceFolder("/w"),
    new Error("removeWorkspaceFolder failed: 502 Bad Gateway"),
  );
});

function seededFolders(): QueryClient {
  const client = newClient();
  client.setQueryData(workspaceFoldersKeys.folders, {
    folders: ["/w"],
    lastUsed: null,
  });
  return client;
}

test("an accepted add appends the typed path to the cached folders", async () => {
  const client = seededFolders();
  reply(200, { repos: [] });
  await new MutationObserver(
    client,
    addWorkspaceFolderMutationOptions(client),
  ).mutate("/v");
  assert.deepEqual(client.getQueryData(workspaceFoldersKeys.folders), {
    folders: ["/w", "/v"],
    lastUsed: null,
  });
});

test("an add of a folder already cached keeps the list as it is", async () => {
  const client = seededFolders();
  reply(200, { repos: [] });
  await new MutationObserver(
    client,
    addWorkspaceFolderMutationOptions(client),
  ).mutate("/w");
  assert.deepEqual(client.getQueryData(workspaceFoldersKeys.folders), {
    folders: ["/w"],
    lastUsed: null,
  });
});

test("a refused add resolves the message and leaves the cache alone", async () => {
  const client = seededFolders();
  reply(400, { error: "not a directory" }, "Bad Request");
  const result = await new MutationObserver(
    client,
    addWorkspaceFolderMutationOptions(client),
  ).mutate("/v");
  assert.deepEqual(result, { ok: false, error: "not a directory" });
  assert.deepEqual(client.getQueryData(workspaceFoldersKeys.folders), {
    folders: ["/w"],
    lastUsed: null,
  });
});

test("a failed add rejects and leaves the cache alone", async () => {
  const client = seededFolders();
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    new MutationObserver(
      client,
      addWorkspaceFolderMutationOptions(client),
    ).mutate("/v"),
    new Error("addWorkspaceFolder failed: 500 Internal Server Error"),
  );
  assert.deepEqual(client.getQueryData(workspaceFoldersKeys.folders), {
    folders: ["/w"],
    lastUsed: null,
  });
});

test("a remove drops the folder from the cache and sends DELETE", async () => {
  const client = seededFolders();
  reply(200, {});
  await new MutationObserver(
    client,
    removeWorkspaceFolderMutationOptions(client),
  ).mutate("/w");
  assert.deepEqual(client.getQueryData(workspaceFoldersKeys.folders), {
    folders: [],
    lastUsed: null,
  });
  assert.equal(calls[0]?.init?.method, "DELETE");
});

test("a failed remove rejects and keeps the folder out of the cache", async () => {
  const client = seededFolders();
  reply(502, {}, "Bad Gateway");
  await assert.rejects(
    new MutationObserver(
      client,
      removeWorkspaceFolderMutationOptions(client),
    ).mutate("/w"),
    new Error("removeWorkspaceFolder failed: 502 Bad Gateway"),
  );
  assert.deepEqual(client.getQueryData(workspaceFoldersKeys.folders), {
    folders: [],
    lastUsed: null,
  });
});

test("useFolderBrowser starts closed with no listing and no request", () => {
  let seen: ReturnType<typeof useFolderBrowser> | undefined;
  function Probe() {
    seen = useFolderBrowser();
    return null;
  }
  renderToString(
    createElement(
      QueryClientProvider,
      { client: newClient() },
      createElement(Probe),
    ),
  );
  assert.equal(seen?.open, false);
  assert.equal(seen?.listing, undefined);
  assert.equal(seen?.loading, false);
  assert.equal(seen?.error, false);
  assert.equal(calls.length, 0);
});

void test("opening the folder browser resets the target to home", () => {
  assert.equal(browseTargetOnOpenChange(true, "/work/app"), undefined);
});

void test("closing the folder browser keeps the target", () => {
  assert.equal(browseTargetOnOpenChange(false, "/work/app"), "/work/app");
});

void test("closing with no target leaves it unset", () => {
  assert.equal(browseTargetOnOpenChange(false, undefined), undefined);
});

const discovered = [{ path: "/w/a b/api", name: "api", base: "main" }];

test("the discover query keys on the folder path", () => {
  assert.deepEqual(discoverWorkspaceFolderQueryOptions("/w").queryKey, [
    "workspaces",
    "discover",
    "/w",
  ]);
});

test("discoverWorkspaceFolder encodes the path in the query string", async () => {
  reply(200, { repos: discovered });
  assert.deepEqual(await discoverWorkspaceFolder("/w/a b&c"), {
    repos: discovered,
  });
  assert.equal(
    calls[0]?.url,
    "/api/workspace-folders/discover?path=%2Fw%2Fa%20b%26c",
  );
});

test("discoverWorkspaceFolder throws on a non-2xx status", async () => {
  reply(500, { error: "down" }, "Internal Server Error");
  await assert.rejects(
    discoverWorkspaceFolder("/w"),
    new Error("discoverWorkspaceFolder failed: 500 Internal Server Error"),
  );
});

test("an accepted add writes the discovered repos and the folder to the cache", async () => {
  reply(200, { repos: discovered });
  const client = newClient();
  client.setQueryData(workspaceFoldersKeys.folders, {
    folders: ["/w"],
    lastUsed: "/w",
  });
  const result = await new MutationObserver(
    client,
    addWorkspaceFolderMutationOptions(client),
  ).mutate("/x");
  assert.deepEqual(result, { ok: true, repos: discovered });
  assert.deepEqual(client.getQueryData(workspaceFoldersKeys.discover("/x")), {
    repos: discovered,
  });
  assert.deepEqual(client.getQueryData(workspaceFoldersKeys.folders), {
    folders: ["/w", "/x"],
    lastUsed: "/w",
  });
});

test("a refused add leaves the discovered repos cache alone", async () => {
  reply(400, { error: "not a directory" });
  const client = newClient();
  const result = await new MutationObserver(
    client,
    addWorkspaceFolderMutationOptions(client),
  ).mutate("/x");
  assert.deepEqual(result, { ok: false, error: "not a directory" });
  assert.equal(
    client.getQueryData(workspaceFoldersKeys.discover("/x")),
    undefined,
  );
});
