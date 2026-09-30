import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { viewerPageRouter } = await import("./viewer-page.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/viewer", viewerPageRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

after(() => {
  server.close();
  env.cleanup();
});

async function expectNotFound(pathname: string): Promise<void> {
  const res = await fetch(`${base}${pathname}`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-cache");
  assert.equal(await res.text(), "Not found");
}

test("GET /viewer/<missing file> answers 404 text/plain Not found, not JSON", async () => {
  await expectNotFound("/viewer/no-such-file.js");
  await expectNotFound("/viewer/assets/no-such-chunk.css");
});

test("GET /viewer/<dotfile> answers 404 text/plain Not found", async () => {
  await expectNotFound("/viewer/.hidden");
});

test("GET /viewer with no trailing slash redirects with 302 to /viewer/", async () => {
  const res = await fetch(`${base}/viewer?path=/a.md`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/viewer/?path=/a.md");
});
