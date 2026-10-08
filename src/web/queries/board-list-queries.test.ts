import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  boardCountsQueryOptions,
  boardListKeys,
  boardListQueryOptions,
} from "./board-list-queries.js";

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
    return Promise.resolve(new Response(text, { status, statusText }));
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("boardListKeys has the documented shape", () => {
  assert.deepEqual(boardListKeys.all, ["boards"]);
  assert.deepEqual(boardListKeys.list, ["boards", "list"]);
  assert.deepEqual(boardListKeys.counts, ["boards", "counts"]);
});

test("boardListQueryOptions has the list key and requests /api/boards", async () => {
  const options = boardListQueryOptions();
  assert.deepEqual(options.queryKey, ["boards", "list"]);
  const body = { boards: [], knownLinearTeamKeys: ["ENG"] };
  reply(200, body, "OK");
  assert.deepEqual(await newClient().fetchQuery(options), body);
  assert.equal(calls[0]?.url, "/api/boards");
});

test("boardCountsQueryOptions has the counts key and requests /api/boards/counts", async () => {
  const options = boardCountsQueryOptions();
  assert.deepEqual(options.queryKey, ["boards", "counts"]);
  const body = {
    counts: [{ key: "ACME", running: 1, openGroups: 2, attention: 0 }],
    at: "t",
  };
  reply(200, body, "OK");
  assert.deepEqual(await newClient().fetchQuery(options), body);
  assert.equal(calls[0]?.url, "/api/boards/counts");
});

test("boardCountsQueryOptions polls every 15000 ms when poll is true", () => {
  const options = boardCountsQueryOptions(true);
  assert.equal(options.refetchInterval, 15_000);
  assert.equal(options.enabled, true);
});

test("boardCountsQueryOptions disables the query and the timer when poll is false", () => {
  const options = boardCountsQueryOptions(false);
  assert.equal(options.enabled, false);
  assert.equal(options.refetchInterval, false);
});

test("boardCountsQueryOptions shares the cache without a timer when poll is omitted", () => {
  const options = boardCountsQueryOptions();
  assert.equal(options.enabled, true);
  assert.equal(options.refetchInterval, false);
});

test("boardListQueryOptions rejects a non-2xx response", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    newClient().fetchQuery({ ...boardListQueryOptions(), retry: false }),
    new Error("getBoardList failed: 500 Internal Server Error"),
  );
});

test("boardCountsQueryOptions rejects a non-2xx response", async () => {
  reply(503, {}, "Service Unavailable");
  await assert.rejects(
    newClient().fetchQuery({ ...boardCountsQueryOptions(), retry: false }),
    new Error("getBoardCounts failed: 503 Service Unavailable"),
  );
});
