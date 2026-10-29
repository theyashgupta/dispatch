import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { cardsRouter } = await import("./cards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
await store.load();

const OTH = parseBoardKey("OTH") as BoardKey;
await store.createBoard({
  key: OTH,
  name: "OTH",
  workspaceRoot: "/oth/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const app = express();
app.use("/api", express.json(), cardsRouter, httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;

async function put(id: string, body: unknown) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/cards/${id}/blocked-by`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

const local = (title: string) =>
  store.createLocalCard(DEFAULT_BOARD_KEY, title, "");

void test.after(() => {
  server.close();
  env.cleanup();
});

void test("a valid list answers 200 with the card and stores it, and an empty list clears it", async () => {
  const [a, b, c] = [await local("a"), await local("b"), await local("c")];
  const set = await put(a.id, { blockedBy: [b.id, c.id, b.id] });
  assert.equal(set.status, 200);
  assert.deepEqual((set.body.card as { blockedBy: string[] }).blockedBy, [
    b.id,
    c.id,
  ]);
  assert.deepEqual(store.getCard(a.id)?.blockedBy, [b.id, c.id]);
  const cleared = await put(a.id, { blockedBy: [] });
  assert.equal(cleared.status, 200);
  assert.equal(store.getCard(a.id)?.blockedBy, undefined);
  assert.equal("blockedBy" in store.getCard(a.id)!, false);
});

void test("a cycle is 400 blocked-by-cycle with the chain, and the stored list is unchanged", async () => {
  const a = await local("cyc-a");
  const b = await local("cyc-b");
  assert.equal((await put(b.id, { blockedBy: [a.id] })).status, 200);
  const refused = await put(a.id, { blockedBy: [b.id] });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "blocked-by-cycle");
  assert.equal(
    refused.body.reason,
    `${a.identifier} -> ${b.identifier} -> ${a.identifier}`,
  );
  assert.equal(store.getCard(a.id)?.blockedBy, undefined);
  const self = await put(a.id, { blockedBy: [a.id] });
  assert.equal(self.status, 400);
  assert.equal(self.body.reason, `${a.identifier} -> ${a.identifier}`);
});

void test("an unknown blocker and a blocker on another board are 400 invalid-blocker", async () => {
  const a = await local("inv-a");
  const far = await store.createLocalCard(OTH, "far", "");
  const unknown = await put(a.id, { blockedBy: ["no-such-card"] });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "invalid-blocker");
  assert.match(String(unknown.body.reason), /no-such-card/);
  const other = await put(a.id, { blockedBy: [far.id] });
  assert.equal(other.status, 400);
  assert.equal(other.body.error, "invalid-blocker");
  assert.match(String(other.body.reason), new RegExp(far.id));
  assert.equal(store.getCard(a.id)?.blockedBy, undefined);
});

void test("more than 50 ids and a malformed body are 400", async () => {
  const a = await local("big-a");
  const many = Array.from({ length: 51 }, (_, i) => `id-${i}`);
  assert.equal((await put(a.id, { blockedBy: many })).status, 400);
  assert.equal((await put(a.id, {})).status, 400);
  assert.equal((await put(a.id, { blockedBy: "x" })).status, 400);
  assert.equal((await put(a.id, { blockedBy: [""] })).status, 400);
});

void test("an unknown card is 400", async () => {
  const res = await put("no-such-card", { blockedBy: [] });
  assert.equal(res.status, 400);
});

void test("a grouped member card is 409", async () => {
  const a = await local("m-a");
  const b = await local("m-b");
  const other = await local("m-c");
  const group = await store.createGroupCard(DEFAULT_BOARD_KEY, "grp", [
    a.id,
    b.id,
  ]);
  assert.ok(group.ok);
  const res = await put(a.id, { blockedBy: [other.id] });
  assert.equal(res.status, 409);
  assert.equal(store.getCard(a.id)?.blockedBy, undefined);
});
