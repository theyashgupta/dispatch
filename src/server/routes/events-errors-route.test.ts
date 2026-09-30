import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { eventsRouter } = await import("./events.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json(), eventsRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  env.cleanup();
});

async function expectBadQuery(query: string, error: string): Promise<void> {
  const res = await fetch(`${base}/events${query}`);
  assert.equal(res.status, 400);
  assert.equal(await res.text(), JSON.stringify({ error }));
}

test("GET /events with a repeated cardId answers 400 invalid cardId", async () => {
  await expectBadQuery("?cardId=a&cardId=b", "invalid cardId");
});

test("GET /events with a non-numeric limit answers 400 invalid limit", async () => {
  await expectBadQuery("?limit=abc", "invalid limit");
  await expectBadQuery("?limit=", "invalid limit");
  await expectBadQuery("?limit=-1", "invalid limit");
  await expectBadQuery("?limit=1.5", "invalid limit");
  await expectBadQuery("?limit=5&limit=6", "invalid limit");
});

test("GET /events with a limit outside 1 to 1000 answers 400 limit out of range", async () => {
  await expectBadQuery("?limit=0", "limit out of range");
  await expectBadQuery("?limit=00", "limit out of range");
  await expectBadQuery("?limit=1001", "limit out of range");
  await expectBadQuery("?limit=99999999999999999999999", "limit out of range");
});

test("GET /events reports the cardId failure before the limit failure", async () => {
  await expectBadQuery("?cardId=a&cardId=b&limit=abc", "invalid cardId");
});
