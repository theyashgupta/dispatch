import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { remoteRouter } = await import("./remote.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json({ limit: "1mb" }), remoteRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  env.cleanup();
});

test("POST /remote/enable answers 503 server not ready before the hooks runtime is set", async () => {
  const res = await fetch(`${base}/remote/enable`, { method: "POST" });
  assert.equal(res.status, 503);
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(await res.text(), '{"error":"server not ready"}');
});

test("GET /remote and POST /remote/disable answer 200 with the tunnel state", async () => {
  const status = await fetch(`${base}/remote`);
  assert.equal(status.status, 200);
  assert.equal(await status.text(), '{"status":"off"}');
  const off = await fetch(`${base}/remote/disable`, { method: "POST" });
  assert.equal(off.status, 200);
  assert.equal(await off.text(), '{"status":"off"}');
});
