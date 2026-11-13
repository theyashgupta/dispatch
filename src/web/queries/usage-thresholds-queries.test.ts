import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  DEFAULT_USAGE_THRESHOLDS,
  type UsageThresholds,
} from "../../shared/usage-thresholds.js";
import {
  getUsageThresholds,
  saveUsageThresholds,
} from "./usage-thresholds-api.js";
import {
  saveUsageThresholdsMutationOptions,
  usageThresholdsKeys,
  usageThresholdsQueryOptions,
} from "./usage-thresholds-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

const custom: UsageThresholds = {
  warningPercent: 60,
  criticalPercent: 80,
  limitPercent: { session: 100, weekly_all: 85, weekly_scoped: 100 },
};

function reply(status: number, body: unknown, statusText = ""): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, statusText }),
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

test("usageThresholdsQueryOptions has its key and requests the thresholds route", async () => {
  const options = usageThresholdsQueryOptions();
  assert.deepEqual(usageThresholdsKeys.all, ["settings", "usage-thresholds"]);
  assert.deepEqual(options.queryKey, usageThresholdsKeys.all);
  reply(200, custom);
  assert.deepEqual(await newClient().fetchQuery(options), custom);
  assert.equal(calls[0]?.url, "/api/config/usage-thresholds");
});

test("getUsageThresholds throws on a failure status", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    getUsageThresholds(),
    new Error("getUsageThresholds failed: 500 Internal Server Error"),
  );
});

test("saveUsageThresholds puts the whole object and splits 200, 400 and other failures", async () => {
  reply(200, custom, "OK");
  assert.deepEqual(await saveUsageThresholds(custom), { ok: true });
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(calls[0]?.init?.body, JSON.stringify(custom));
  reply(400, { error: "Warning must be below critical." }, "Bad Request");
  assert.deepEqual(await saveUsageThresholds(custom), {
    ok: false,
    error: "Warning must be below critical.",
  });
  reply(400, {}, "Bad Request");
  assert.deepEqual(await saveUsageThresholds(custom), {
    ok: false,
    error: "Couldn't save the usage thresholds.",
  });
  reply(502, {}, "Bad Gateway");
  await assert.rejects(
    saveUsageThresholds(custom),
    new Error("saveUsageThresholds failed: 502 Bad Gateway"),
  );
});

test("an accepted save writes the thresholds into the cache and a refusal leaves it alone", async () => {
  const client = newClient();
  client.setQueryData(usageThresholdsKeys.all, DEFAULT_USAGE_THRESHOLDS);
  reply(400, { error: "Use whole numbers from 1 to 100." }, "Bad Request");
  await new MutationObserver(
    client,
    saveUsageThresholdsMutationOptions(client),
  ).mutate(custom);
  assert.deepEqual(
    client.getQueryData(usageThresholdsKeys.all),
    DEFAULT_USAGE_THRESHOLDS,
  );
  reply(200, custom);
  await new MutationObserver(
    client,
    saveUsageThresholdsMutationOptions(client),
  ).mutate(custom);
  assert.deepEqual(client.getQueryData(usageThresholdsKeys.all), custom);
});
