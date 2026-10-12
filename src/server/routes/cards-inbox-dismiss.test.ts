import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { cardsRouter } = await import("./cards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
await store.load();

const SYNCED = "2026-09-24T10:00:00.000Z";
const source = { source: "dismiss", kind: "snapshot" } as const;

const app = express();
app.use("/api", express.json(), cardsRouter, httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;

async function dismiss(id: string, body: unknown) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/cards/${id}/inbox-dismiss`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  return {
    status: res.status,
    body: text === "" ? null : (JSON.parse(text) as Record<string, unknown>),
  };
}

void test.after(() => {
  server.close();
  env.cleanup();
});

void test("dismiss sets inboxDismissedAt and dismissed:false clears it", async () => {
  await store.applyIssues([issue("d1")], SYNCED, source);
  const set = await dismiss("d1", { dismissed: true });
  assert.deepEqual([set.status, set.body], [204, null]);
  assert.match(
    store.getCard("d1")?.inboxDismissedAt ?? "",
    /^\d{4}-\d\d-\d\dT/,
  );
  const cleared = await dismiss("d1", { dismissed: false });
  assert.equal(cleared.status, 204);
  assert.equal(store.getCard("d1")?.inboxDismissedAt, undefined);
});

void test("an unknown card is 404", async () => {
  const res = await dismiss("no-such-card", { dismissed: true });
  assert.deepEqual([res.status, res.body], [404, { error: "not-found" }]);
});

void test("a card outside the Inbox column is 409 not-in-inbox", async () => {
  await store.applyIssues([issue("d2")], SYNCED, source);
  await store.moveCardManual("d2", "todo");
  const res = await dismiss("d2", { dismissed: true });
  assert.deepEqual([res.status, res.body], [409, { error: "not-in-inbox" }]);
  assert.equal(store.getCard("d2")?.inboxDismissedAt, undefined);
});

void test("a bad body is 400", async () => {
  await store.applyIssues([issue("d3")], SYNCED, source);
  assert.equal((await dismiss("d3", {})).status, 400);
  assert.equal((await dismiss("d3", { dismissed: "yes" })).status, 400);
  assert.equal(store.getCard("d3")?.inboxDismissedAt, undefined);
});

void test("a Linear poll refresh keeps inboxDismissedAt", async () => {
  await store.applyIssues([issue("d4")], SYNCED, source);
  await dismiss("d4", { dismissed: true });
  const at = store.getCard("d4")?.inboxDismissedAt;
  assert.ok(at);
  await store.applyIssues(
    [issue("d4", { title: "renamed upstream" })],
    SYNCED,
    source,
  );
  assert.equal(store.getCard("d4")?.title, "renamed upstream");
  assert.equal(store.getCard("d4")?.inboxDismissedAt, at);
  assert.equal(store.getCard("d4")?.boardKey, DEFAULT_BOARD_KEY);
});
