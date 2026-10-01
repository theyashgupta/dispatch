import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { updateRouter } = await import("./update.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json(), updateRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  env.cleanup();
});

test("POST /update/run outside a global install answers 400 not-global-install", async () => {
  const res = await fetch(`${base}/update/run`, { method: "POST" });
  assert.equal(res.status, 400);
  assert.equal(await res.text(), '{"error":"not-global-install"}');
});
