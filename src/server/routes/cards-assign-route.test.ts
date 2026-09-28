import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import {
  linearFixture,
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
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  await store.applyIssues([issue("lin")], new Date().toISOString(), {
    source: "linear",
  });
  const app = express();
  app.use("/api", express.json(), cardsRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}/api`;
});

after(() => server.close());
afterEach(restoreFetch);

const assign = (id: string) =>
  fetch(`${base}/cards/${id}/assign-me`, { method: "POST" });

test("204 assigns the issue to the viewer through issueUpdate", async () => {
  const sent = queueLinearFetch([
    [200, { data: { viewer: { id: "user-me" } } }],
    [200, linearFixture("assign.json")],
  ]);
  const res = await assign("lin");
  assert.equal(res.status, 204);
  assert.deepEqual(sent[1]?.variables, {
    id: "lin",
    input: { assigneeId: "user-me" },
  });
  assert.equal(store.getCard("lin")?.linearError, null);
});

test("404 for an unknown card and 409 for a local card, with no Linear call", async () => {
  const sent = queueLinearFetch([]);
  assert.equal((await assign("nope")).status, 404);
  const local = await store.createLocalCard("local", "");
  const res = await assign(local.id);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "source cannot assign" });
  assert.equal(sent.length, 0);
});

test("a 401 answers 502 with the fixed copy and sets linearError", async () => {
  queueLinearFetch([
    [
      401,
      {
        errors: [
          { message: "raw", extensions: { code: "AUTHENTICATION_ERROR" } },
        ],
      },
    ],
  ]);
  const res = await assign("lin");
  assert.equal(res.status, 502);
  const copy = "Linear rejected the API key. Check it in Settings.";
  assert.deepEqual(await res.json(), { error: copy });
  assert.equal(store.getCard("lin")?.linearError, copy);
});
