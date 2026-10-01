import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { ActivityEvent } from "../../shared/types.js";
import {
  activityFeedQueryOptions,
  activityKeys,
  mergeActivity,
} from "./activity-queries.js";

function ev(id: number, reason: string | null = null): ActivityEvent {
  return { id, reason } as ActivityEvent;
}

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

test("activityKeys has the documented shape", () => {
  assert.deepEqual(activityKeys.all, ["activity"]);
  assert.deepEqual(activityKeys.feed, ["activity", "feed"]);
});

test("activityFeedQueryOptions has the feed key and requests /api/events unscoped", async () => {
  const options = activityFeedQueryOptions();
  assert.deepEqual(options.queryKey, ["activity", "feed"]);
  reply(200, { events: [{ id: "e1" }] });
  assert.deepEqual(await newClient().fetchQuery(options), [{ id: "e1" }]);
  assert.equal(calls[0]?.url, "/api/events");
});

test("mergeActivity unions by id, the existing entry wins, newest id first", () => {
  assert.deepEqual(mergeActivity([], []), []);
  assert.deepEqual(mergeActivity([ev(1)], []), [ev(1)]);
  assert.deepEqual(mergeActivity([], [ev(1)]), [ev(1)]);
  assert.deepEqual(mergeActivity([ev(2, "new"), ev(1)], [ev(2), ev(3)]), [
    ev(3),
    ev(2),
    ev(1),
  ]);
});

test("mergeActivity caps at 200 and drops the oldest", () => {
  const incoming = Array.from({ length: 201 }, (_, i) => ev(i + 1));
  const merged = mergeActivity(incoming, []);
  assert.equal(merged.length, 200);
  assert.equal(merged[0]?.id, 201);
  assert.equal(merged.at(-1)?.id, 2);
});

test("the feed query function merges fetched events with a cached entry, the cached entry wins", async () => {
  const client = newClient();
  client.setQueryData(activityKeys.feed, [ev(3), ev(1)]);
  reply(200, { events: [ev(3, "fetched"), ev(2)] });
  assert.deepEqual(await client.fetchQuery(activityFeedQueryOptions()), [
    ev(3),
    ev(2),
    ev(1),
  ]);
});

test("a seeded feed still requests /api/events because the options set staleTime 0", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, gcTime: Infinity } },
  });
  client.setQueryData(activityKeys.feed, [ev(1)]);
  reply(200, { events: [ev(2)] });
  assert.deepEqual(await client.fetchQuery(activityFeedQueryOptions()), [
    ev(2),
    ev(1),
  ]);
  assert.equal(calls[0]?.url, "/api/events");
});
