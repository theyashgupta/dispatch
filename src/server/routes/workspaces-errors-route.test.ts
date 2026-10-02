import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { workspacesRouter } = await import("./workspaces.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json(), workspacesRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  env.cleanup();
});

async function expectBadFresh(query: string): Promise<void> {
  const res = await fetch(`${base}/workspaces${query}`);
  assert.equal(res.status, 400);
  assert.equal(await res.text(), '{"error":"fresh must be 1"}');
}

test("GET /workspaces?fresh=2 answers 400 fresh must be 1", async () => {
  await expectBadFresh("?fresh=2");
});

test("GET /workspaces?fresh= (empty) answers 400 fresh must be 1", async () => {
  await expectBadFresh("?fresh=");
});

test("GET /workspaces with a repeated fresh answers 400 fresh must be 1", async () => {
  await expectBadFresh("?fresh=1&fresh=1");
});
