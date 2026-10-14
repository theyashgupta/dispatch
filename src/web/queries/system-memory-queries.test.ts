import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { SystemMemory } from "../../shared/types.js";
import { getSystemMemory } from "./system-memory-api.js";
import {
  applyMemoryFrame,
  systemMemoryKeys,
  systemMemoryQueryOptions,
} from "./system-memory-queries.js";

const realFetch = globalThis.fetch;
const calls: string[] = [];

function reply(status: number, body: unknown): void {
  globalThis.fetch = (url: string | URL | Request) => {
    calls.push(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    );
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

const reading: SystemMemory = {
  supported: true,
  sample: {
    at: "2026-10-14T00:00:00.000Z",
    freeMb: 900,
    compressorMb: 10,
    swapUsedMb: 100,
    swapTotalMb: 2048,
    load1: 1,
  },
  stale: false,
};

test("systemMemoryKeys has the documented shape", () => {
  assert.deepEqual(systemMemoryKeys.reading, ["system-memory"]);
});

test("systemMemoryQueryOptions reads GET /api/system/memory", async () => {
  const options = systemMemoryQueryOptions();
  assert.deepEqual(options.queryKey, ["system-memory"]);
  reply(200, reading);
  assert.deepEqual(await new QueryClient().fetchQuery(options), reading);
  assert.deepEqual(calls, ["/api/system/memory"]);
});

test("getSystemMemory resolves an unsupported reading and throws with the status on a failure", async () => {
  reply(200, { supported: false });
  assert.deepEqual(await getSystemMemory(), { supported: false });
  reply(500, {});
  await assert.rejects(
    getSystemMemory(),
    new Error("getSystemMemory failed: 500"),
  );
});

test("applyMemoryFrame writes the reading into the cache", () => {
  const client = new QueryClient();
  applyMemoryFrame(client, reading);
  assert.deepEqual(client.getQueryData(systemMemoryKeys.reading), reading);
  applyMemoryFrame(client, { supported: false });
  assert.deepEqual(client.getQueryData(systemMemoryKeys.reading), {
    supported: false,
  });
});
