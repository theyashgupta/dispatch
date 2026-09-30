import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { imagesRouter } = await import("./images.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json(), imagesRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
const realFetch = globalThis.fetch;
const GOOD = encodeURIComponent("https://uploads.linear.app/a/b.png");

after(() => {
  server.close();
  env.cleanup();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer non-loopback calls with `upstream`; loopback calls reach the real fetch. */
function stubUpstream(upstream: () => Promise<Response>): void {
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return url.startsWith("http://127.0.0.1")
      ? realFetch(input, init)
      : upstream();
  };
}

async function expectBadUrl(query: string): Promise<void> {
  const res = await fetch(`${base}/images${query}`);
  assert.equal(res.status, 400);
  assert.equal(await res.text(), '{"error":"invalid-url"}');
}

test("GET /images with no url answers 400 invalid-url", async () => {
  await expectBadUrl("");
});

test("GET /images with a repeated url answers 400 invalid-url", async () => {
  await expectBadUrl(`?url=${GOOD}&url=${GOOD}`);
});

test("GET /images with a host outside the allowlist answers 400 invalid-url", async () => {
  await expectBadUrl(
    `?url=${encodeURIComponent("https://evil.example/a.png")}`,
  );
  await expectBadUrl(
    `?url=${encodeURIComponent("https://uploads.linear.app.evil.example/a.png")}`,
  );
});

test("GET /images with a non-https url answers 400 invalid-url", async () => {
  await expectBadUrl(
    `?url=${encodeURIComponent("http://uploads.linear.app/a.png")}`,
  );
});

test("GET /images with a malformed url answers 400 invalid-url", async () => {
  await expectBadUrl(`?url=${encodeURIComponent("not a url")}`);
  await expectBadUrl("?url=");
});

test("GET /images answers 502 image-fetch-failed when no Linear key is configured", async () => {
  const res = await fetch(`${base}/images?url=${GOOD}`);
  assert.equal(res.status, 502);
  assert.equal(await res.text(), '{"error":"image-fetch-failed"}');
});

test("GET /images answers 502 image-fetch-failed when upstream is not an image", async () => {
  setOrchestrationConfig({ linearApiKey: "k" });
  stubUpstream(() =>
    Promise.resolve(
      new Response("<html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ),
  );
  const res = await fetch(`${base}/images?url=${GOOD}`);
  assert.equal(res.status, 502);
  assert.equal(await res.text(), '{"error":"image-fetch-failed"}');
});

test("GET /images answers 500 image-fetch-failed when the upstream call throws a non-proxy error", async () => {
  setOrchestrationConfig({ linearApiKey: "k" });
  stubUpstream(() => Promise.reject(new TypeError("fetch failed")));
  const res = await fetch(`${base}/images?url=${GOOD}`);
  assert.equal(res.status, 500);
  assert.equal(await res.text(), '{"error":"image-fetch-failed"}');
});

test("GET /images destroys the connection when the stream fails after headers are sent", async () => {
  setOrchestrationConfig({ linearApiKey: "k" });
  stubUpstream(() => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        setTimeout(() => controller.error(new Error("boom")), 20);
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );
  });
  await assert.rejects(async () => {
    const res = await fetch(`${base}/images?url=${GOOD}`);
    await res.text();
  });
});
