import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { DEFAULT_BOARD_KEY as LOCAL } from "../../shared/board-key.js";
import type { ActivityEvent, BoardKey } from "../../shared/types.js";
import { fetchEvents } from "./activity-api.js";
import {
  activityFeedQueryOptions,
  activityKeys,
  mergeActivity,
} from "./activity-queries.js";

const ACME = "ACME" as BoardKey;

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
  assert.deepEqual(activityKeys.feed(LOCAL), ["activity", "feed", LOCAL]);
  assert.deepEqual(activityKeys.feed(ACME), ["activity", "feed", ACME]);
});

test("activityFeedQueryOptions has the feed key and requests /api/events unscoped for LOCAL", async () => {
  const options = activityFeedQueryOptions(LOCAL);
  assert.deepEqual(options.queryKey, ["activity", "feed", LOCAL]);
  reply(200, { events: [{ id: "e1" }] });
  assert.deepEqual(await newClient().fetchQuery(options), [{ id: "e1" }]);
  assert.equal(calls[0]?.url, "/api/events");
});

test("activityFeedQueryOptions for ACME carries the board in the key and the URL", async () => {
  const options = activityFeedQueryOptions(ACME);
  assert.deepEqual(options.queryKey, ["activity", "feed", ACME]);
  reply(200, { events: [] });
  await newClient().fetchQuery(options);
  assert.equal(calls[0]?.url, "/api/events?board=ACME");
});

test("fetchEvents adds the board after the card id and limit", async () => {
  reply(200, { events: [] });
  await fetchEvents(ACME, "c1", 5);
  await fetchEvents(LOCAL, "c1", 5);
  assert.equal(calls[0]?.url, "/api/events?cardId=c1&limit=5&board=ACME");
  assert.equal(calls[1]?.url, "/api/events?cardId=c1&limit=5");
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
  client.setQueryData(activityKeys.feed(LOCAL), [ev(3), ev(1)]);
  reply(200, { events: [ev(3, "fetched"), ev(2)] });
  assert.deepEqual(await client.fetchQuery(activityFeedQueryOptions(LOCAL)), [
    ev(3),
    ev(2),
    ev(1),
  ]);
});

test("a seeded feed still requests /api/events because the options set staleTime 0", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, gcTime: Infinity } },
  });
  client.setQueryData(activityKeys.feed(LOCAL), [ev(1)]);
  reply(200, { events: [ev(2)] });
  assert.deepEqual(await client.fetchQuery(activityFeedQueryOptions(LOCAL)), [
    ev(2),
    ev(1),
  ]);
  assert.equal(calls[0]?.url, "/api/events");
});
