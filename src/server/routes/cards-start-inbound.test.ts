import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { cardsRouter } = await import("./cards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

await store.load();
setOrchestrationConfig({ linearApiKey: "k" });

const app = express();
app.use("/api", express.json(), cardsRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

const start = (id: string, body: unknown) =>
  fetch(`${base}/cards/${id}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

void test("an unknown crossSessionInbound answers 400 before the card lookup", async () => {
  const res = await start("NOPE-1", { crossSessionInbound: "bogus" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid crossSessionInbound" });
});

void test("an unknown crossSessionInbound leaves the saved start intent unchanged", async () => {
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "keep", "");
  await store.setStartIntent(card.id, { crossSessionInbound: "refuse" });
  const res = await start(card.id, { crossSessionInbound: "bogus" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid crossSessionInbound" });
  assert.deepEqual(store.getCard(card.id)?.startIntent, {
    crossSessionInbound: "refuse",
  });
});

void test("a valid crossSessionInbound is saved on the card before the saga runs", async (t) => {
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, "hold it", "");
  await store.setCardWorkspace(card.id, { folder: "/x", repos: [] });
  t.mock.method(store, "setProvisioning", () =>
    Promise.reject(new Error("saga stopped by the test")),
  );
  const res = await start(card.id, { crossSessionInbound: "hold" });
  assert.equal(res.status, 202);
  await waitFor(
    () => Promise.resolve(store.getCard(card.id)?.startError !== undefined),
    10_000,
    "the stubbed saga to settle",
  );
  assert.equal(
    store.getCard(card.id)?.startIntent?.crossSessionInbound,
    "hold",
  );
});
