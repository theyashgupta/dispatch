import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { projectsDirOf } = await import("../adapters/transcript.js");
const { cardsRouter } = await import("./cards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
await store.load();

const app = express();
app.use("/api", express.json(), cardsRouter, httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as { port: number }).port;

async function get(id: string) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/cards/${id}/resume-target`,
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

void test.after(() => {
  server.close();
  env.cleanup();
});

void test("a lost card with conversation files answers 200 with the newer file and writes nothing", async () => {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, "rt", "");
  const cwd = path.join(env.root, "wt-rt");
  fs.mkdirSync(cwd, { recursive: true });
  await store.completeStart(created.id, undefined, {
    workspacePath: cwd,
    tmuxSession: "dsp-rt",
    branch: "rt",
  });
  const sessionId = store.getCard(created.id)!.activeSessionId!;
  await store.markSessionLost(created.id, sessionId);
  const folder = projectsDirOf(path.join(env.home, ".claude"), cwd);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "conv-a.jsonl"), "");
  await new Promise((r) => setTimeout(r, 20));
  await store.setClaudeSessionId(created.id, sessionId, "conv-a");
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(path.join(folder, "conv-b.jsonl"), "");

  const { status, body } = await get(created.id);
  assert.equal(status, 200);
  assert.equal(body.mode, "resume");
  assert.equal(body.sessionId, "conv-b");
  assert.deepEqual(body.replaced, {
    storedId: "conv-a",
    reason: "newer-on-disk",
  });
  assert.equal(store.getCard(created.id)?.claudeSessionId, "conv-a");
});

void test("an unknown card is 404", async () => {
  const { status, body } = await get("no-such-card");
  assert.equal(status, 404);
  assert.equal(body.error, "unknown card id: no-such-card");
});

void test("a card with no session is 409 no-session", async () => {
  const created = await store.createLocalCard(DEFAULT_BOARD_KEY, "bare", "");
  const { status, body } = await get(created.id);
  assert.deepEqual([status, body.error], [409, "no-session"]);
});
