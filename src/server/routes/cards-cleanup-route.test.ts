import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import type { Server } from "node:http";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { openBoardDb } = await import("../store/board-db.js");
const { cardsRouter } = await import("./cards.route.js");
const { tempRepoWithWorkspace, addWorktree } =
  await import("../test-support/git-fixtures.js");

void test("POST /cards/:id/cleanup answers 202 while teardown is still running, flags the card cleaningUp on the wire until the workspace is gone, then settles quietly", async () => {
  await store.load();
  const app = express();
  app.use("/api", express.json(), cardsRouter);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const { root, repo, ws } = await tempRepoWithWorkspace();
  try {
    const card = await store.createLocalCard("clean me", "");
    await store.setCardWorkspace(card.id, {
      folder: ws,
      repos: [{ path: repo, base: "main" }],
    });
    await addWorktree(repo, ws, card.id);
    await store.completeStart(card.id, undefined, {
      workspacePath: ws,
      tmuxSession: `dsp-${card.id}-absent`,
      branch: card.id,
    });
    await store.moveCardManual(card.id, "done");
    assert.equal(store.getCard(card.id)?.column, "done");

    const frames: { cleaningUp?: true; workspacePath?: string; at: number }[] =
      [];
    const onChange = () => {
      const wire = store.snapshot().cards.find((c) => c.id === card.id)!;
      frames.push({
        cleaningUp: wire.cleaningUp,
        workspacePath: wire.workspacePath,
        at: performance.now(),
      });
    };
    store.on("change", onChange);
    let answeredAt = 0;
    try {
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/api/cards/${card.id}/cleanup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: false }),
        },
      );
      answeredAt = performance.now();
      assert.equal(res.status, 202);
      assert.deepEqual(await res.json(), { cleaning: true });
      assert.equal(
        store.isCleaningUp(card.id),
        true,
        "the route answered before the git teardown finished",
      );
      await waitFor(
        () => Promise.resolve(!store.isCleaningUp(card.id)),
        10_000,
        "cleanup fan-out to end",
      );
    } finally {
      store.off("change", onChange);
    }

    assert.ok(
      frames.length >= 2,
      "in-flight and settled frames both broadcast",
    );
    assert.deepEqual(
      {
        cleaningUp: frames[0].cleaningUp,
        workspacePath: frames[0].workspacePath,
      },
      { cleaningUp: true, workspacePath: ws },
      "first frame after the click marks the card in flight with its workspace intact",
    );
    const last = frames[frames.length - 1];
    assert.equal(last.cleaningUp, undefined, "flag drops once teardown ends");
    assert.equal(last.workspacePath, undefined, "workspace cleared");
    assert.ok(answeredAt < last.at, "202 arrived before the settled frame");
    assert.equal(fs.existsSync(ws), false, "workspace folder removed");

    const settled = store.getCard(card.id)!;
    assert.equal(settled.cleanupWarning, undefined, "quiet finish");
    assert.equal(settled.cleanupBlocked, undefined);
    const persisted = openBoardDb()
      .readAll()
      .cards.find((c) => c.id === card.id)!;
    assert.equal(
      "cleaningUp" in persisted,
      false,
      "the wire flag never reaches board.db",
    );
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void test.after(() => env.cleanup());
