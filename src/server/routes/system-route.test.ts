import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { systemRouter } = await import("./system.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { recordSample } =
  await import("../services/orchestration/memory-governor.js");
const { memorySample } = await import("../test-support/memory-fixtures.js");

const app = express();
app.use("/api", systemRouter, httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/system/memory`;

after(() => {
  server.close();
  env.cleanup();
});

test("GET /system/memory with no sample says unsupported", async () => {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { supported: false });
});

test("GET /system/memory serves a fresh sample", async () => {
  const sample = memorySample({ freeMb: 900, swapUsedMb: 3100 });
  recordSample(sample);
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { supported: true, sample, stale: false });
});

test("GET /system/memory marks a sample older than 60 seconds as stale", async () => {
  recordSample(
    memorySample({ at: new Date(Date.now() - 61_000).toISOString() }),
  );
  const body = (await (await fetch(url)).json()) as { stale: boolean };
  assert.equal(body.stale, true);
});
