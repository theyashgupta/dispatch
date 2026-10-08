import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { store } = await import("../store/board.store.js");
const { stopPollers } = await import("../adapters/poller.js");
const { apiRouter } = await import("./index.js");
const { orchestratorRouter } = await import("./orchestrator.route.js");

await store.load();
const app = express();
app.use("/api", express.json(), apiRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  stopPollers();
  env.cleanup();
});

interface Layer {
  route?: { path: unknown; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
}

/** Every `[METHOD, path]` of the user routes below a router stack, the orchestrator router left out. */
function userRoutes(stack: Layer[]): [string, string][] {
  return stack.flatMap((layer): [string, string][] => {
    if (layer.route) {
      assert.equal(typeof layer.route.path, "string");
      return Object.keys(layer.route.methods).map((m) => [
        m.toUpperCase(),
        layer.route!.path as string,
      ]);
    }
    if (layer.handle === (orchestratorRouter as unknown)) return [];
    return layer.handle.stack ? userRoutes(layer.handle.stack) : [];
  });
}

const routes = userRoutes(apiRouter.stack as unknown as Layer[]);
const changing = routes.filter(([m]) => m !== "GET" && m !== "HEAD");

void test("the walk finds the state-changing user routes, the policy and token routes included", () => {
  const names = changing.map(([m, p]) => `${m} ${p}`);
  for (const expected of [
    "PUT /boards/:key/policy",
    "POST /boards/:key/orchestrators/:id/token",
    "DELETE /boards/:key/orchestrators/:id/token",
    "POST /cards/:id/move",
  ]) {
    assert.ok(names.includes(expected), expected);
  }
  assert.ok(changing.length > 40, `only ${changing.length} routes found`);
});

void test("every state-changing user route refuses an orchestrator token with 403", async () => {
  const boardsBefore = JSON.stringify(store.listBoards());
  for (const [method, path] of changing) {
    const url = path.replace(/[:*]\w+/g, "x").replace(/[{}]/g, "");
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-orchestrator-token": "x",
      },
      body: "{}",
    });
    const text = await res.text();
    assert.equal(res.status, 403, `${method} ${path}: ${text}`);
    assert.deepEqual(
      JSON.parse(text),
      { error: "orchestrator-token-on-user-route" },
      `${method} ${path}`,
    );
  }
  assert.equal(JSON.stringify(store.listBoards()), boardsBefore);
});

void test("a GET user route with an orchestrator token still answers normally", async () => {
  const res = await fetch(`${base}/boards`, {
    headers: { "x-orchestrator-token": "x" },
  });
  assert.equal(res.status, 200);
});

void test("a state-changing user route without the header is not refused by the guard", async () => {
  const res = await fetch(`${base}/boards/NOPE/orchestrators/orc-1/token`, {
    method: "POST",
  });
  assert.equal(res.status, 404);
});

void test("the API router mounts the orchestrator routes behind their own token check", async () => {
  const res = await fetch(`${base}/orchestrator/cards/LOCAL-1`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "orchestrator-token-required" });
});
