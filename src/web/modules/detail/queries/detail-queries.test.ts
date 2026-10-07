import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getCardComments } from "./detail-api.js";
import { cardCommentsQueryOptions, detailKeys } from "./detail-queries.js";

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

test("detailKeys has the documented shape", () => {
  assert.deepEqual(detailKeys.all, ["detail"]);
  assert.deepEqual(detailKeys.comments("c1", 2, "k2"), [
    "detail",
    "card",
    "c1",
    "comments",
    2,
    "k2",
  ]);
});

test("cardCommentsQueryOptions requests the comments route and resolves the list", async () => {
  const options = cardCommentsQueryOptions("a/b", 1, "k1");
  const comments = [{ id: "k1", body: "hi", createdAt: "t", author: "me" }];
  reply(200, { comments });
  assert.deepEqual(await newClient().fetchQuery(options), comments);
  assert.equal(calls[0]?.url, "/api/cards/a%2Fb/comments");
});

test("getCardComments resolves the comments array on a 200", async () => {
  reply(200, { comments: [{ id: "k1" }] }, "OK");
  assert.deepEqual(await getCardComments("c1"), [{ id: "k1" }]);
});

test("getCardComments throws on a failure status", async () => {
  reply(404, {}, "Not Found");
  await assert.rejects(
    getCardComments("c1"),
    new Error("getCardComments failed: 404 Not Found"),
  );
});
