import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { linearFixture, restoreFetch } from "../test-support/linear-fetch.js";

const env = isolateEnv();
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");
const { getWorkflow } =
  await import("../services/orchestration/linear-outbound.js");
const { setupRouter } = await import("./setup.route.js");

let server: Server | undefined;

after(() => {
  stopPollers();
  restoreFetch();
  server?.close();
  env.cleanup();
});

/** Answer Linear by operation name and count Workflow reads; loopback calls reach the real fetch. */
function stubLinearByOperation(): { workflowReads: () => number } {
  const real = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.startsWith("http://127.0.0.1")) return real(input, init);
    const { query } = JSON.parse(init?.body as string) as { query: string };
    const body = query.includes("query Workflow")
      ? (reads++, linearFixture("workflow.json"))
      : query.includes("query Viewer")
        ? { data: { viewer: { id: "user-me" } } }
        : { data: {} };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { workflowReads: () => reads };
}

test("saving a key in setup drops the cached workflow", async () => {
  setOrchestrationConfig({ linearApiKey: "" });
  rebuildSources({
    linearApiKey: "old",
    sources: { linear: { apiKey: "old" } },
  });
  const stub = stubLinearByOperation();
  assert.equal((await getWorkflow()).ok, true);
  assert.equal((await getWorkflow()).ok, true);
  assert.equal(stub.workflowReads(), 1);

  const app = express();
  app.use("/api", express.json(), setupRouter);
  const listening = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  server = listening;
  const addr = listening.address();
  assert.ok(addr && typeof addr === "object");
  const res = await fetch(`http://127.0.0.1:${addr.port}/api/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: "new-key" }),
  });
  assert.equal(res.status, 200);
  stopPollers();

  assert.equal((await getWorkflow()).ok, true);
  assert.equal(stub.workflowReads(), 2);
});
