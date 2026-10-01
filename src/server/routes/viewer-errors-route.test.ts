import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { viewerRouter } = await import("./viewer.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const root = path.join(env.root, "workspace");
const outside = path.join(env.root, "outside");
fs.mkdirSync(path.join(root, "dir.md"), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(root, "ok.md"), "# ok\n");
fs.writeFileSync(path.join(root, "plain.txt"), "x");
fs.symlinkSync(path.join(root, "plain.txt"), path.join(root, "link.md"));
fs.writeFileSync(path.join(root, "locked.md"), "secret");
fs.chmodSync(path.join(root, "locked.md"), 0o000);
fs.writeFileSync(path.join(root, "big.md"), "");
fs.truncateSync(path.join(root, "big.md"), 2 * 1024 * 1024 + 1);
fs.writeFileSync(path.join(root, "edge.md"), "");
fs.truncateSync(path.join(root, "edge.md"), 2 * 1024 * 1024);
fs.writeFileSync(path.join(outside, "away.md"), "# away\n");
setOrchestrationConfig({ linearApiKey: "", workspaceRoot: root });

const app = express();
app.use("/api", express.json(), viewerRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  server.close();
  fs.chmodSync(path.join(root, "locked.md"), 0o600);
  env.cleanup();
});

async function expectJson(
  query: string,
  status: number,
  body: string,
): Promise<void> {
  const res = await fetch(`${base}/viewer/file${query}`);
  assert.equal(res.status, status);
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(await res.text(), body);
}

const q = (p: string) => `?path=${encodeURIComponent(p)}`;
const NOT_FOUND = '{"error":"not-found"}';

test("GET /viewer/file answers 400 invalid-path for a missing, repeated or non-markdown path", async () => {
  const invalid = '{"error":"invalid-path"}';
  await expectJson("", 400, invalid);
  await expectJson("?path=", 400, invalid);
  await expectJson("?path=/a/b.md&path=/a/c.md", 400, invalid);
  await expectJson(q(path.join(root, "plain.txt")), 400, invalid);
});

test("GET /viewer/file answers 404 not-found when the path does not resolve", async () => {
  await expectJson(q(path.join(root, "nope.md")), 404, NOT_FOUND);
  await expectJson(q("/nonexistent/x.md"), 404, NOT_FOUND);
});

test("GET /viewer/file answers 404 not-found for a markdown file outside every allowed root", async () => {
  await expectJson(q(path.join(outside, "away.md")), 404, NOT_FOUND);
});

test("GET /viewer/file answers 404 not-found for a traversal that leaves the root", async () => {
  await expectJson(
    q(path.join(root, "..", "outside", "away.md")),
    404,
    NOT_FOUND,
  );
});

test("GET /viewer/file answers 404 not-found when a markdown-named symlink resolves to a non-markdown file", async () => {
  await expectJson(q(path.join(root, "link.md")), 404, NOT_FOUND);
});

test("GET /viewer/file answers 404 not-found when the file cannot be opened", async () => {
  if (process.getuid?.() === 0) return;
  await expectJson(q(path.join(root, "locked.md")), 404, NOT_FOUND);
});

test("GET /viewer/file answers 404 not-found when the target is a directory", async () => {
  await expectJson(q(path.join(root, "dir.md")), 404, NOT_FOUND);
});

test("GET /viewer/file answers 404 not-found when the read fails after the open", async (t) => {
  t.mock.method(fsp, "open", () =>
    Promise.resolve({
      stat: () => Promise.reject(new Error("stat failed")),
      close: () => Promise.resolve(),
    }),
  );
  await expectJson(q(path.join(root, "ok.md")), 404, NOT_FOUND);
});

test("GET /viewer/file answers 413 too-large above the 2 MiB cap", async () => {
  await expectJson(q(path.join(root, "big.md")), 413, '{"error":"too-large"}');
});

test("GET /viewer/file serves a file at the cap and a normal file as markdown", async () => {
  const edge = await fetch(
    `${base}/viewer/file${q(path.join(root, "edge.md"))}`,
  );
  assert.equal(edge.status, 200);
  await edge.arrayBuffer();
  const res = await fetch(`${base}/viewer/file${q(path.join(root, "ok.md"))}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(await res.text(), "# ok\n");
});
