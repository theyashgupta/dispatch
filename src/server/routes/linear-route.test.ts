import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  linearFixture,
  restoreFetch,
  queueLinearFetch,
} from "../test-support/linear-fetch.js";

isolateEnv();
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { invalidateWorkflow } =
  await import("../services/orchestration/linear-outbound.js");
const { linearRouter } = await import("./linear.route.js");

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use("/api", linearRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}/api`;
});

after(() => server.close());
afterEach(() => {
  restoreFetch();
  invalidateWorkflow();
});

const stubLinear = (status: number, payload: unknown) =>
  queueLinearFetch([[status, payload]]);

test("GET /sources/linear/workflow answers 200 with the viewer and ordered teams", async () => {
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  stubLinear(200, linearFixture("workflow.json"));
  const res = await fetch(`${base}/sources/linear/workflow`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    viewerId: string;
    teams: { key: string; states: { name: string }[] }[];
  };
  assert.equal(body.viewerId, "user-me");
  assert.deepEqual(
    body.teams.map((t) => t.key),
    ["ENG", "X"],
  );
  assert.deepEqual(
    body.teams[0]?.states.map((s) => s.name),
    ["Backlog", "Todo", "In Progress"],
  );
});

test("a Linear failure answers 502 with the fixed copy", async () => {
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  stubLinear(401, {
    errors: [{ message: "raw", extensions: { code: "AUTHENTICATION_ERROR" } }],
  });
  const res = await fetch(`${base}/sources/linear/workflow`);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), {
    error: "Linear rejected the API key. Check it in Settings.",
  });
});

test("a disabled Linear source answers 409 with no Linear call", async () => {
  rebuildSources({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k", enabled: false } },
  });
  const sent = stubLinear(200, {});
  const res = await fetch(`${base}/sources/linear/workflow`);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "Linear is not connected" });
  assert.equal(sent.length, 0);
});
