import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { BoardKey } from "../../../../shared/types.js";
import { openDecisionsQueryOptions } from "@/queries/attention-actions-queries";
import {
  orchestrationEventsQueryOptions,
  retryResumeMutationOptions,
  orchestrationSummaryQueryOptions,
} from "./orchestration-queries.js";

const BOARD = "LOCAL" as BoardKey;
const realFetch = globalThis.fetch;
const urls: string[] = [];

function reply(body: unknown, status = 200): void {
  globalThis.fetch = (url: string | URL | Request) => {
    urls.push(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    );
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  urls.length = 0;
});

test("summary, events and decisions keys share the orchestration board prefix", () => {
  for (const options of [
    orchestrationSummaryQueryOptions(BOARD),
    orchestrationEventsQueryOptions(BOARD, { limit: 50 }),
    openDecisionsQueryOptions(BOARD),
  ]) {
    assert.deepEqual(options.queryKey.slice(0, 2), ["orchestration", BOARD]);
  }
});

test("the keys of two boards share no prefix", () => {
  assert.notDeepEqual(
    orchestrationSummaryQueryOptions(BOARD).queryKey.slice(0, 2),
    orchestrationSummaryQueryOptions("OTHR" as BoardKey).queryKey.slice(0, 2),
  );
});

test("invalidating the board prefix marks all three queries stale", async () => {
  const client = new QueryClient();
  reply({ concurrencyCap: null, runningLoops: 0, groups: [] });
  await client.fetchQuery(orchestrationSummaryQueryOptions(BOARD));
  reply({ events: [] });
  await client.fetchQuery(orchestrationEventsQueryOptions(BOARD));
  reply({ items: [] });
  await client.fetchQuery(openDecisionsQueryOptions(BOARD));
  await client.invalidateQueries({
    queryKey: ["orchestration", BOARD],
    refetchType: "none",
  });
  const states = client
    .getQueryCache()
    .findAll({ queryKey: ["orchestration", BOARD] })
    .map((q) => q.state.isInvalidated);
  assert.deepEqual(states, [true, true, true]);
});

test("the summary query reads GET /api/boards/:key/orchestration", async () => {
  const summary = { concurrencyCap: 2, runningLoops: 1, groups: [] };
  reply(summary);
  const got = await new QueryClient().fetchQuery(
    orchestrationSummaryQueryOptions(BOARD),
  );
  assert.deepEqual(got, summary);
  assert.deepEqual(urls, ["/api/boards/LOCAL/orchestration"]);
});

test("the events query sends since and limit when set and answers the events array", async () => {
  reply({ events: [{ id: 3 }] });
  const got = await new QueryClient().fetchQuery(
    orchestrationEventsQueryOptions(BOARD, { since: 2, limit: 50 }),
  );
  assert.deepEqual(got, [{ id: 3 }]);
  assert.deepEqual(urls, [
    "/api/boards/LOCAL/orchestration/events?since=2&limit=50",
  ]);
  reply({ events: [] });
  await new QueryClient().fetchQuery(orchestrationEventsQueryOptions(BOARD));
  assert.equal(urls[1], "/api/boards/LOCAL/orchestration/events");
});

test("a failure status rejects the query", async () => {
  reply({}, 500);
  await assert.rejects(
    new QueryClient().fetchQuery({
      ...orchestrationSummaryQueryOptions(BOARD),
      retry: false,
    }),
  );
});

test("Try resume again posts to the card route and refreshes the orchestration reads", async () => {
  const client = new QueryClient();
  client.setQueryData(["orchestration", BOARD, "summary"], {});
  reply({});
  const outcome = await new MutationObserver(
    client,
    retryResumeMutationOptions(client, BOARD),
  ).mutate("GROUP-4");
  assert.deepEqual(outcome, { ok: true, result: null });
  assert.deepEqual(urls, ["/api/cards/GROUP-4/resume"]);
  assert.equal(
    client.getQueryState(["orchestration", BOARD, "summary"])?.isInvalidated,
    true,
  );
});
