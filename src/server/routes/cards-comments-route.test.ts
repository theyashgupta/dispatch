import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const { cardsRouter } = await import("./cards.route.js");

const COMMENTS = [
  {
    id: "c1",
    body: "First",
    createdAt: "2026-09-24T10:00:00.000Z",
    author: "Ada",
  },
  {
    id: "c2",
    body: "Second",
    createdAt: "2026-09-24T11:00:00.000Z",
    author: "Linear",
  },
];

let server: Server;
let base: string;

before(async () => {
  await store.load();
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

test("GET /cards/:id/comments answers 200 with the stored comments of a Linear card", async () => {
  await store.applyIssues(
    [issue("lin", { comments: COMMENTS })],
    new Date().toISOString(),
    { source: "linear" },
  );
  const res = await fetch(`${base}/cards/lin/comments`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { comments: COMMENTS });
});

test("GET /cards/:id/comments answers 200 with an empty list for a local card", async () => {
  const local = await store.createLocalCard(DEFAULT_BOARD_KEY, "local", "");
  const res = await fetch(`${base}/cards/${local.id}/comments`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { comments: [] });
});

test("GET /cards/:id/comments answers 404 for an unknown card", async () => {
  const res = await fetch(`${base}/cards/nope/comments`);
  assert.equal(res.status, 404);
});
