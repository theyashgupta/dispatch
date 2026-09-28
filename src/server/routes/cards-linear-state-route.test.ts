import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import {
  linearFixture,
  queueLinearFetch,
  restoreFetch,
  type SentGraphQL,
} from "../test-support/linear-fetch.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { invalidateWorkflow } =
  await import("../services/orchestration/linear-outbound.js");
const { cardsRouter } = await import("./cards.route.js");

const ENG = { id: "team-eng", key: "ENG", name: "Engineering" };
const TODO = { id: "st-todo", name: "Todo", type: "unstarted" };
const SET_OK = { data: { issueUpdate: { success: true } } };
const AUTH_FAIL = {
  errors: [{ message: "raw", extensions: { code: "AUTHENTICATION_ERROR" } }],
};

let server: Server;
let base: string;

before(async () => {
  await store.load();
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  const app = express();
  app.use("/api", express.json(), cardsRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}/api`;
});

beforeEach(async () => {
  invalidateWorkflow();
  const held = store.getCard("lin");
  if (held) held.pendingState = undefined;
  await store.applyIssues(
    [
      issue("lin", { team: ENG, state: TODO }),
      issue("noteam", { state: TODO }),
    ],
    new Date().toISOString(),
    { source: "linear" },
  );
  await store.moveCardManual("lin", "todo");
  await store.setLinearError("lin", null);
});

after(() => server.close());
afterEach(restoreFetch);

const choose = (id: string, body: unknown) =>
  fetch(`${base}/cards/${id}/linear-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const setStates = (sent: SentGraphQL[]) =>
  sent.filter((s) => s.query.startsWith("mutation SetState"));

test("204 sends the chosen state, sets pendingState and keeps the column", async () => {
  const sent = queueLinearFetch([
    [200, linearFixture("workflow.json")],
    [200, SET_OK],
  ]);
  const res = await choose("lin", { stateId: "st-progress" });
  assert.equal(res.status, 204);
  assert.deepEqual(
    setStates(sent).map((s) => s.variables),
    [{ id: "lin", input: { stateId: "st-progress" } }],
  );
  const card = store.getCard("lin");
  assert.equal(card?.pendingState?.id, "st-progress");
  assert.equal(card?.linearState?.name, "In Progress");
  assert.equal(card?.column, "todo");
  assert.equal(card?.linearError, null);
});

test("204 with no Linear write when the state is the current one", async () => {
  const sent = queueLinearFetch([[200, linearFixture("workflow.json")]]);
  const res = await choose("lin", { stateId: "st-todo" });
  assert.equal(res.status, 204);
  assert.deepEqual(setStates(sent), []);
});

test("400 for a state of another team or a bad body, with no Linear write", async () => {
  const sent = queueLinearFetch([[200, linearFixture("workflow.json")]]);
  const other = await choose("lin", { stateId: "x-done" });
  assert.equal(other.status, 400);
  assert.deepEqual(await other.json(), {
    error: "stateId is not a state of the card's team",
  });
  assert.equal((await choose("lin", { stateId: "" })).status, 400);
  assert.equal((await choose("lin", { stateId: 7 })).status, 400);
  assert.equal((await choose("lin", {})).status, 400);
  const at200 = await choose("lin", { stateId: "s".repeat(200) });
  assert.deepEqual(await at200.json(), {
    error: "stateId is not a state of the card's team",
  });
  const at201 = await choose("lin", { stateId: "s".repeat(201) });
  assert.equal(at201.status, 400);
  assert.deepEqual(await at201.json(), {
    error: "stateId must be a string of 1 to 200 characters",
  });
  assert.deepEqual(setStates(sent), []);
});

test("404 for an unknown card and 409 for a local or teamless card, with no Linear call", async () => {
  const sent = queueLinearFetch([]);
  assert.equal((await choose("nope", { stateId: "st-todo" })).status, 404);
  const local = await store.createLocalCard("local", "");
  assert.equal((await choose(local.id, { stateId: "st-todo" })).status, 409);
  const teamed = store.getCard(local.id);
  assert.ok(teamed);
  teamed.team = ENG;
  assert.equal((await choose(local.id, { stateId: "st-todo" })).status, 409);
  const teamless = await choose("noteam", { stateId: "st-todo" });
  assert.equal(teamless.status, 409);
  assert.deepEqual(await teamless.json(), {
    error: "only a Linear card with a team has Linear states",
  });
  assert.equal(sent.length, 0);
});

test("502 with the fixed copy when Linear rejects the write, and the chip keeps its state", async () => {
  queueLinearFetch([
    [200, linearFixture("workflow.json")],
    [401, AUTH_FAIL],
  ]);
  const res = await choose("lin", { stateId: "st-backlog" });
  assert.equal(res.status, 502);
  const copy =
    "Linear state not updated. Linear rejected the API key. Check it in Settings.";
  assert.deepEqual(await res.json(), { error: copy });
  const card = store.getCard("lin");
  assert.equal(card?.linearError, copy);
  assert.equal(card?.linearState?.id, "st-todo");
});

test("502 with the fixed copy when the workflow read fails, recorded on the card", async () => {
  const sent = queueLinearFetch([[401, AUTH_FAIL]]);
  const res = await choose("lin", { stateId: "st-backlog" });
  assert.equal(res.status, 502);
  const copy =
    "Linear state not updated. Linear rejected the API key. Check it in Settings.";
  assert.deepEqual(await res.json(), { error: copy });
  assert.equal(store.getCard("lin")?.linearError, copy);
  assert.deepEqual(setStates(sent), []);
});
