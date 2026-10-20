import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import { orchestrationSummaryQueryOptions } from "./orchestration-summary-queries.js";

const BOARD = "LOCAL" as BoardKey;
const realFetch = globalThis.fetch;
const urls: string[] = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  urls.length = 0;
});

test("the key is the orchestration board prefix plus summary", () => {
  assert.deepEqual(orchestrationSummaryQueryOptions(BOARD).queryKey, [
    "orchestration",
    BOARD,
    "summary",
  ]);
});

test("the options fetch GET /api/boards/:key/orchestration", async () => {
  const summary = { concurrencyCap: 2, runningLoops: 1, groups: [] };
  globalThis.fetch = (url: string | URL | Request) => {
    urls.push(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    );
    return Promise.resolve(new Response(JSON.stringify(summary)));
  };
  const got = await new QueryClient().fetchQuery(
    orchestrationSummaryQueryOptions(BOARD),
  );
  assert.deepEqual(got, summary);
  assert.deepEqual(urls, ["/api/boards/LOCAL/orchestration"]);
});
