import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { searchCardsQueryOptions, searchKeys } from "./search-queries.js";

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

test("searchKeys has the documented shape", () => {
  assert.deepEqual(searchKeys.all, ["search"]);
  assert.deepEqual(searchKeys.cards("abc"), ["search", "cards", "abc"]);
});

test("searchCardsQueryOptions keys on the term and requests /api/search?q=", async () => {
  const options = searchCardsQueryOptions("a b&c");
  assert.deepEqual(options.queryKey, ["search", "cards", "a b&c"]);
  reply(200, { results: [], total: 0 });
  assert.deepEqual(await newClient().fetchQuery(options), {
    results: [],
    total: 0,
  });
  assert.equal(calls[0]?.url, "/api/search?q=a%20b%26c");
  assert.ok(calls[0]?.init?.signal instanceof AbortSignal);
});
