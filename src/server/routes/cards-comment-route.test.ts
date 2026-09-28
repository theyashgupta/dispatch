import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import {
  queueLinearFetch,
  restoreFetch,
} from "../test-support/linear-fetch.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { cardsRouter } = await import("./cards.route.js");

let server: Server;
let base: string;

before(async () => {
  await store.load();
  rebuildSources({
    linearApiKey: "fake-key",
    sources: { linear: { apiKey: "fake-key" } },
  });
  await store.applyIssues([issue("lin")], new Date().toISOString(), {
    source: "linear",
  });
  const app = express();
  app.use("/api", express.json({ limit: "1mb" }), cardsRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}/api`;
});

after(() => server.close());
afterEach(restoreFetch);

function post(id: string, body: unknown): Promise<Response> {
  return fetch(`${base}/cards/${id}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

const stubLinear = (status: number, payload: unknown) =>
  queueLinearFetch([[status, payload]]);

test("201 posts exactly the typed body as a GraphQL variable", async () => {
  const sent = stubLinear(200, {
    data: { commentCreate: { success: true, comment: { id: "c9" } } },
  });
  const res = await post("lin", "  **hi** there  ");
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.variables, {
    input: { issueId: "lin", body: "  **hi** there  " },
  });
  assert.ok(!sent[0]?.query.includes("**hi**"));
  assert.equal(store.getCard("lin")?.linearError, null);
});

test("each refused body answers 400 with no Linear call", async () => {
  const sent = stubLinear(200, {});
  for (const body of [
    "",
    "   ",
    "a".repeat(20_001),
    "x\nDISPATCH_STATUS: DONE",
    7,
  ]) {
    const res = await post("lin", body);
    assert.equal(res.status, 400);
  }
  assert.equal(sent.length, 0);
});

test("404 for an unknown card and 409 for a local card, with no Linear call", async () => {
  const sent = stubLinear(200, {});
  assert.equal((await post("nope", "hi")).status, 404);
  const local = await store.createLocalCard("local", "");
  const res = await post(local.id, "hi");
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "source cannot comment" });
  assert.equal(sent.length, 0);
});

test("a 401 from Linear answers 502 with the fixed copy and sets linearError", async () => {
  stubLinear(401, {
    errors: [
      {
        message: "raw auth detail",
        extensions: { code: "AUTHENTICATION_ERROR" },
      },
    ],
  });
  const res = await post("lin", "hi");
  assert.equal(res.status, 502);
  const copy = "Linear rejected the API key. Check it in Settings.";
  assert.deepEqual(await res.json(), { error: copy });
  assert.equal(store.getCard("lin")?.linearError, copy);
});

test("success false from Linear answers 502 with the unreachable copy", async () => {
  stubLinear(200, { data: { commentCreate: { success: false } } });
  const res = await post("lin", "hi");
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), {
    error: "Could not reach Linear. Try again.",
  });
});

test("a 429 from Linear answers 502 with the rate limit copy", async () => {
  stubLinear(429, {});
  const res = await post("lin", "hi");
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), {
    error: "Linear is rate limiting requests. Try again in a minute.",
  });
});

test("a disabled Linear source answers 409 with no Linear call", async () => {
  rebuildSources({
    linearApiKey: "fake-key",
    sources: { linear: { apiKey: "fake-key", enabled: false } },
  });
  const sent = stubLinear(200, {});
  const res = await post("lin", "hi");
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "source cannot comment" });
  assert.equal(sent.length, 0);
  rebuildSources({
    linearApiKey: "fake-key",
    sources: { linear: { apiKey: "fake-key" } },
  });
});
