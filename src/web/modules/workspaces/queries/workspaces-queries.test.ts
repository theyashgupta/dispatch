import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { getWorkspaces } from "./workspaces-api.js";
import { openWorkspaceEditorMutationOptions } from "./workspaces-queries.js";

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

test("getWorkspaces requests the inventory", async () => {
  reply(200, { rows: [] });
  await getWorkspaces(false);
  assert.equal(calls[0]?.url, "/api/workspaces");
});

test("getWorkspaces with fresh requests the fresh inventory", async () => {
  reply(200, { rows: [] });
  await getWorkspaces(true);
  assert.equal(calls[0]?.url, "/api/workspaces?fresh=1");
});

test("openWorkspaceEditorMutationOptions posts the editor to the card", async () => {
  reply(204, null);
  await new MutationObserver(
    newClient(),
    openWorkspaceEditorMutationOptions(),
  ).mutate({ cardId: "c/1", editor: "cursor" });
  assert.equal(calls[0]?.url, "/api/cards/c%2F1/open-editor");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ editor: "cursor" }));
});

test("openWorkspaceEditorMutationOptions rejects on a non-2xx answer", async () => {
  reply(500, "boom", "Server Error");
  await assert.rejects(
    new MutationObserver(
      newClient(),
      openWorkspaceEditorMutationOptions(),
    ).mutate({ cardId: "c1", editor: "code" }),
  );
});
