import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  queueLinearFetch,
  restoreFetch,
} from "../test-support/linear-fetch.js";

const env = isolateEnv();
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { invalidateWorkflow } =
  await import("../services/orchestration/linear-outbound.js");
const express = (await import("express")).default;
const { linearRouter } = await import("./linear.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json(), linearRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  env.cleanup();
});
afterEach(() => {
  restoreFetch();
  invalidateWorkflow();
});

async function expectBadMap(
  body: unknown,
  error: string,
  raw?: string,
): Promise<void> {
  const res = await fetch(`${base}/config/linear-state-map`, {
    method: "PUT",
    headers:
      body === undefined && raw === undefined
        ? {}
        : { "Content-Type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  assert.equal(res.status, 400);
  assert.equal(await res.text(), JSON.stringify({ error }));
}

test("GET /sources/linear/workflow answers 409 when Linear is not connected", async () => {
  rebuildSources({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k", enabled: false } },
  });
  const res = await fetch(`${base}/sources/linear/workflow`);
  assert.equal(res.status, 409);
  assert.equal(await res.text(), '{"error":"Linear is not connected"}');
});

test("GET /sources/linear/workflow answers 502 with the fixed copy when Linear rejects the key", async () => {
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  queueLinearFetch([
    [
      401,
      {
        errors: [
          { message: "raw", extensions: { code: "AUTHENTICATION_ERROR" } },
        ],
      },
    ],
  ]);
  const res = await fetch(`${base}/sources/linear/workflow`);
  assert.equal(res.status, 502);
  assert.equal(
    await res.text(),
    '{"error":"Linear rejected the API key. Check it in Settings."}',
  );
});

test("PUT /config/linear-state-map with no body answers 400 stateMap must be an object", async () => {
  await expectBadMap(undefined, "stateMap must be an object");
});

test("PUT /config/linear-state-map with an empty object body answers 400 stateMap must be an object", async () => {
  await expectBadMap({}, "stateMap must be an object");
});

test("PUT /config/linear-state-map with an array body answers 400 stateMap must be an object", async () => {
  await expectBadMap([], "stateMap must be an object");
});

test("PUT /config/linear-state-map with a non-object stateMap answers 400 stateMap must be an object", async () => {
  await expectBadMap({ stateMap: "x" }, "stateMap must be an object");
  await expectBadMap({ stateMap: null }, "stateMap must be an object");
  await expectBadMap({ stateMap: [] }, "stateMap must be an object");
});

test("PUT /config/linear-state-map with a __proto__ team answers 400 invalid team id", async () => {
  await expectBadMap(
    undefined,
    "invalid team id",
    '{"stateMap":{"__proto__":{}}}',
  );
});

test("PUT /config/linear-state-map with a non-object team answers 400 naming the team", async () => {
  await expectBadMap(
    { stateMap: { T1: "x" } },
    "stateMap.T1 must be an object",
  );
  await expectBadMap(
    { stateMap: { T1: null } },
    "stateMap.T1 must be an object",
  );
  await expectBadMap({ stateMap: { T1: [] } }, "stateMap.T1 must be an object");
});

test("PUT /config/linear-state-map with an unknown column answers 400 unknown column", async () => {
  await expectBadMap(
    { stateMap: { T1: { backlog: "s1" } } },
    "unknown column: backlog",
  );
});

test("PUT /config/linear-state-map with a bad state id answers 400 naming the team and column", async () => {
  await expectBadMap(
    { stateMap: { T1: { todo: "" } } },
    "stateMap.T1.todo must be a state id or null",
  );
  await expectBadMap(
    { stateMap: { T1: { done: 5 } } },
    "stateMap.T1.done must be a state id or null",
  );
});

test("PUT /config/linear-state-map reports the first team that fails", async () => {
  await expectBadMap(
    { stateMap: { A: { todo: "s1" }, B: "x", C: { nope: "s" } } },
    "stateMap.B must be an object",
  );
});
