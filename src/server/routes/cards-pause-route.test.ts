import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { pauseTools } = await import("../services/orchestration/pause-card.js");
const express = (await import("express")).default;
const { cardsRouter } = await import("./cards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

await store.load();

const app = express();
app.use("/api", express.json(), cardsRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

const realTools = { ...pauseTools };
let signals: [string, number[]][];
let kills: [number, string][];

beforeEach(() => {
  signals = [];
  kills = [];
  pauseTools.kill = (pid, signal) => {
    kills.push([pid, signal]);
  };
  pauseTools.panePids = () =>
    Promise.resolve(new Map([["dsp-LOOP-1", [4242]]]));
  pauseTools.sessionEnvHas = () => Promise.resolve(true);
  pauseTools.paneTerminal = () => Promise.resolve(null);
  pauseTools.sleep = () => Promise.resolve();
  pauseTools.signalTree = (pids, signal) => {
    signals.push([signal, pids]);
    return Promise.resolve(pids);
  };
});

afterEach(() => {
  Object.assign(pauseTools, realTools);
});

after(() => {
  server.close();
  env.cleanup();
});

interface Reply {
  status: number;
  text: string;
}

async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return { status: res.status, text: await res.text() };
}

async function loop(launch: boolean): Promise<string> {
  const { id } = await store.createLocalCard(DEFAULT_BOARD_KEY, "loop", "");
  await store.completeStart(id, undefined, {
    workspacePath: "/tmp/ws-loop-1",
    tmuxSession: "dsp-LOOP-1",
    branch: "loop-1",
  });
  if (launch)
    await store.setOrchestratorFields(id, { launch: { direction: "go" } });
  return id;
}

function actions(id: string): unknown[] {
  return store
    .listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 100)
    .filter((e) => e.cardId === id && e.kind === "supervisor_action")
    .map((e) => (e.data as { action: string }).action);
}

test("pause and unpause of a loop card round trip with 409s on repeats", async () => {
  const id = await loop(true);

  const paused = await call("POST", `/cards/${id}/pause`);
  assert.equal(paused.status, 200);
  assert.equal(
    (JSON.parse(paused.text) as { paused: { by: string } }).paused.by,
    "user",
  );
  assert.deepEqual(signals, [["SIGSTOP", [4242]]]);
  assert.deepEqual(actions(id), ["pause"]);

  const again = await call("POST", `/cards/${id}/pause`);
  assert.equal(again.status, 409);
  assert.equal(
    (JSON.parse(again.text) as { error: string }).error,
    "already-paused",
  );

  const resumed = await call("POST", `/cards/${id}/unpause`);
  assert.equal(resumed.status, 200);
  assert.equal(
    (JSON.parse(resumed.text) as { paused?: unknown }).paused ?? null,
    null,
  );
  assert.deepEqual(signals[1], ["SIGCONT", [4242]]);
  assert.deepEqual(actions(id), ["pause", "resume"]);

  const twice = await call("POST", `/cards/${id}/unpause`);
  assert.equal(twice.status, 409);
  assert.equal(
    (JSON.parse(twice.text) as { error: string }).error,
    "not-paused",
  );
});

test("pause of a card that is not a loop answers 409 not-pausable and signals nothing", async () => {
  const id = await loop(false);
  const reply = await call("POST", `/cards/${id}/pause`);
  assert.equal(reply.status, 409);
  assert.equal(reply.text, '{"error":"not-pausable","reason":"not a loop"}');
  assert.deepEqual(signals, []);
});

test("pause and unpause of an unknown id answer 404", async () => {
  for (const route of ["pause", "unpause"]) {
    const reply = await call("POST", `/cards/nope/${route}`);
    assert.equal(reply.status, 404);
    assert.equal(reply.text, '{"error":"unknown card id: nope"}');
  }
});

test("a start of a new session on a paused card answers 409 card-paused", async () => {
  const id = await loop(true);
  await call("POST", `/cards/${id}/pause`);
  const reply = await fetch(`${base}/cards/${id}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ extraDirection: "", newSession: true }),
  });
  assert.equal(reply.status, 409);
  assert.equal(await reply.text(), '{"error":"card-paused"}');
});

test("a switch of the active session of a paused card answers 409 card-paused", async () => {
  const id = await loop(true);
  await call("POST", `/cards/${id}/pause`);
  const sessionId = store.getCard(id)?.activeSessionId;
  const reply = await call("POST", `/cards/${id}/session`, { sessionId });
  assert.equal(reply.status, 409);
  assert.equal(reply.text, '{"error":"card-paused"}');
  assert.equal(store.getCard(id)?.activeSessionId, sessionId);
});
