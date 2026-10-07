import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getLinearWorkflow } from "./linear-workflow-api.js";
import {
  linearWorkflowKeys,
  linearWorkflowQueryOptions,
} from "./linear-workflow-queries.js";

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

const workflow = {
  viewerId: "u1",
  teams: [{ id: "t1", key: "ENG", name: "Eng", states: [] }],
};

test("linearWorkflowKeys has the documented shape", () => {
  assert.deepEqual(linearWorkflowKeys.all, ["linear-workflow"]);
});

test("getLinearWorkflow resolves the workflow on a 200", async () => {
  reply(200, workflow);
  assert.deepEqual(await getLinearWorkflow(), { ok: true, workflow });
  assert.equal(calls[0]?.url, "/api/sources/linear/workflow");
});

test("getLinearWorkflow carries the server copy on a refusal", async () => {
  reply(409, { error: "Linear is not connected" }, "Conflict");
  assert.deepEqual(await getLinearWorkflow(), {
    ok: false,
    error: "Linear is not connected",
  });
});

test("getLinearWorkflow falls back to the load copy on a refusal with no error", async () => {
  reply(500, null, "Server Error");
  assert.deepEqual(await getLinearWorkflow(), {
    ok: false,
    error: "Could not load Linear teams.",
  });
});

test("getLinearWorkflow answers the reach copy on a network failure", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("failed to fetch"));
  assert.deepEqual(await getLinearWorkflow(), {
    ok: false,
    error: "Could not reach Dispatch. Try again.",
  });
});

test("linearWorkflowQueryOptions keeps the workflow fresh for the page", () => {
  const options = linearWorkflowQueryOptions();
  assert.deepEqual(options.queryKey, ["linear-workflow"]);
  assert.equal(options.staleTime, Infinity);
});

test("the query resolves the workflow", async () => {
  reply(200, workflow);
  const client = new QueryClient();
  assert.deepEqual(
    await client.fetchQuery(linearWorkflowQueryOptions()),
    workflow,
  );
});

test("a failed load throws its copy and caches nothing", async () => {
  reply(500, null, "Server Error");
  const client = new QueryClient();
  await assert.rejects(client.fetchQuery(linearWorkflowQueryOptions()), {
    message: "Could not load Linear teams.",
  });
  assert.equal(client.getQueryData(linearWorkflowKeys.all), undefined);
  reply(200, workflow);
  assert.deepEqual(
    await client.fetchQuery(linearWorkflowQueryOptions()),
    workflow,
  );
  assert.equal(calls.length, 2);
});
