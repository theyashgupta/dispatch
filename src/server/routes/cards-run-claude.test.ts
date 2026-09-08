import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { cardsRouter } = await import("./cards.route.js");

void test("POST /cards/:id/run-claude rejects an unknown card, a card with no live session, and a card whose start is in flight, before touching tmux", async () => {
  await store.load();
  const app = express();
  app.use("/api", express.json(), cardsRouter);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const post = (id: string) =>
    fetch(`http://127.0.0.1:${addr.port}/api/cards/${id}/run-claude`, {
      method: "POST",
    });
  try {
    assert.equal((await post("no-such-card")).status, 400);
    const card = await store.createLocalCard("no session", "");
    const rejected = await post(card.id);
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), {
      error: "card has no live session",
    });

    const starting = await store.createLocalCard("starting", "");
    await store.completeStart(starting.id, undefined, {
      workspacePath: env.root,
      tmuxSession: "dsp-starting-test",
      branch: "starting",
    });
    store.beginStart(starting.id);
    try {
      const busy = await post(starting.id);
      assert.equal(busy.status, 409);
      assert.deepEqual(await busy.json(), {
        error: "the terminal is not at a shell prompt",
      });
    } finally {
      store.endStart(starting.id);
    }
  } finally {
    server.close();
  }
});

void test.after(() => env.cleanup());
