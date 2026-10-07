import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getPickerPlaybooks } from "./playbook-picker-api.js";
import {
  playbookPickerKeys,
  playbookPickerQueryOptions,
} from "./playbook-picker-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

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

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

const picker = {
  valid: [{ name: "GSD", body: "b", slug: "gsd" }],
  invalid: [{ name: "broken", reason: "missing front-matter" }],
  lastUsed: "GSD",
};

test("playbookPickerKeys shares the playbooks picker key", () => {
  assert.deepEqual(playbookPickerKeys.picker, ["playbooks", "picker"]);
});

test("playbookPickerQueryOptions requests the picker data", async () => {
  const options = playbookPickerQueryOptions();
  assert.deepEqual(options.queryKey, ["playbooks", "picker"]);
  reply(200, picker);
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  assert.deepEqual(await client.fetchQuery(options), picker);
  assert.equal(calls[0]?.url, "/api/playbooks/picker");
});

test("getPickerPlaybooks throws on a failure status", async () => {
  reply(503, { error: "down" }, "Service Unavailable");
  await assert.rejects(
    getPickerPlaybooks(),
    new Error("getPickerPlaybooks failed: 503 Service Unavailable"),
  );
});
