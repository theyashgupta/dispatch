import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { hooksRouter } = await import("./hooks.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json({ limit: "1mb" }), hooksRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/hook/claude`;

after(() => {
  server.close();
  env.cleanup();
});

async function expectRejected(headers: Record<string, string>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ hook_event_name: "Stop" }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(await res.text(), '{"error":"invalid hook token"}');
}

test("POST /hook/claude answers 401 invalid hook token when the header is missing", async () => {
  await expectRejected({});
});

test("POST /hook/claude answers 401 invalid hook token when the header is empty", async () => {
  await expectRejected({ "x-dispatch-token": "" });
});

test("POST /hook/claude answers 401 invalid hook token for an unregistered token", async () => {
  await expectRejected({ "x-dispatch-token": "not-a-registered-token" });
});

test("POST /hook/claude answers 401 invalid hook token for a repeated header", async () => {
  const res = await fetch(url, {
    method: "POST",
    headers: [
      ["Content-Type", "application/json"],
      ["x-dispatch-token", "a"],
      ["x-dispatch-token", "b"],
    ],
    body: "{}",
  });
  assert.equal(res.status, 401);
  assert.equal(await res.text(), '{"error":"invalid hook token"}');
});

test("POST /hook/claude answers 401 before the body is read, even with no body", async () => {
  const res = await fetch(url, { method: "POST" });
  assert.equal(res.status, 401);
  assert.equal(await res.text(), '{"error":"invalid hook token"}');
});
