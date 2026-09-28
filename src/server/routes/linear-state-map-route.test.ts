import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  linearFixture,
  queueLinearFetch,
  restoreFetch,
} from "../test-support/linear-fetch.js";

const env = isolateEnv();
const configPath = path.join(env.dispatchDir, "config.json");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { getWorkflow } =
  await import("../services/orchestration/linear-outbound.js");
const { linearRouter } = await import("./linear.route.js");

let server: Server;
let base: string;

before(async () => {
  setOrchestrationConfig({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k" } },
  });
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  const app = express();
  app.use("/api", express.json(), linearRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}/api/config/linear-state-map`;
});

after(() => {
  restoreFetch();
  server.close();
  env.cleanup();
});

const put = (body: unknown) =>
  fetch(base, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("GET answers an empty map, PUT persists a map and drops the cached workflow", async () => {
  assert.deepEqual(await (await fetch(base)).json(), { stateMap: {} });

  const sent = queueLinearFetch([
    [200, linearFixture("workflow.json")],
    [200, linearFixture("workflow.json")],
  ]);
  await getWorkflow();
  assert.equal(sent.length, 1);

  const stateMap = { "team-eng": { todo: "st-todo", done: null } };
  assert.equal((await put({ stateMap })).status, 204);
  assert.deepEqual(await (await fetch(base)).json(), { stateMap });
  const onDisk = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    sources: { linear: { stateMap: unknown } };
  };
  assert.deepEqual(onDisk.sources.linear.stateMap, stateMap);

  await getWorkflow();
  assert.equal(sent.length, 2);
});

test("PUT answers 400 for an invalid map and writes nothing", async () => {
  const before = fs.readFileSync(configPath, "utf8");
  for (const stateMap of [
    { "team-eng": { backlog: "st-backlog" } },
    { "team-eng": { todo: 1 } },
    "all",
  ]) {
    const res = await put({ stateMap });
    assert.equal(res.status, 400);
    assert.ok(((await res.json()) as { error: string }).error);
  }
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
});
