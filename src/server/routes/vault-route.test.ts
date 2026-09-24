import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";

isolateEnv();
const { rebuildSources } = await import("../adapters/source-gateway.js");
const express = (await import("express")).default;
const { vaultRouter } = await import("./vault.route.js");

rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
const app = express();
app.use("/api", express.json(), vaultRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => server.close());

test("GET /vault carries a usedBy array on every key", async () => {
  const created = await fetch(`${base}/vault`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "LINEAR_API_KEY", purpose: "test" }),
  });
  assert.equal(created.status, 200);
  const res = await fetch(`${base}/vault`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    keys: { name: string; usedBy?: string[] }[];
  };
  assert.equal(body.keys.length, 1);
  assert.deepEqual(body.keys[0]?.usedBy, []);
  assert.ok(body.keys.every((k) => Array.isArray(k.usedBy)));
});
