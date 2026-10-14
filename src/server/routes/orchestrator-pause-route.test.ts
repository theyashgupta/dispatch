import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { pauseTools } = await import("../services/orchestration/pause-card.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { SBX, setupSupervisedBoard } =
  await import("../test-support/supervised-session.js");
const { recordMemory } = await import("../test-support/memory-fixtures.js");

const OTH = parseBoardKey("OTH") as BoardKey;

await setupSupervisedBoard();
await store.createBoard({
  key: OTH,
  name: "Other",
  workspaceRoot: "/oth/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
app.use("/api", express.json(), boardsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
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
    Promise.resolve(new Map([["dsp-PAUSE-1", [4242]]]));
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
  body: Record<string, unknown>;
}

async function raw(
  route: string,
  body?: unknown,
  token?: string,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { "x-orchestrator-token": token }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

const minted = await raw("/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;
const call = (route: string) => raw(`/orchestrator${route}`, undefined, TOKEN);

async function loopCard(): Promise<string> {
  const a = await store.createLocalCard(SBX, "pause-a", "");
  const b = await store.createLocalCard(SBX, "pause-b", "");
  const made = await store.createGroupCard(SBX, "pause", [a.id, b.id]);
  assert.ok(made.ok);
  const { id } = made.card;
  await store.completeStart(id, undefined, {
    workspacePath: "/tmp/ws-pause-1",
    tmuxSession: "dsp-PAUSE-1",
    branch: "pause-1",
  });
  return id;
}

function reasons(id: string): unknown[] {
  return store
    .listOrchestrationEvents(SBX, 0, 100)
    .filter((e) => e.cardId === id && e.kind === "supervisor_action")
    .map((e) => (e.data as { reason: string }).reason);
}

test("pause_card pauses an owned loop as the user and records the orchestrator", async () => {
  const id = await loopCard();
  const reply = await call(`/sessions/${id}/pause`);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, { paused: true });
  assert.equal(store.getCard(id)?.paused?.by, "user");
  assert.deepEqual(reasons(id), ["paused by orchestrator orc-sbx"]);
  assert.deepEqual(signals, [["SIGSTOP", [4242]]]);
});

test("pause_card and resume_card refuse a card of another board and change nothing", async () => {
  const card = await store.createLocalCard(OTH, "foreign", "");
  for (const route of ["pause", "unpause"]) {
    const reply = await call(`/sessions/${card.id}/${route}`);
    assert.equal(reply.status, 403, route);
    assert.equal(reply.body.error, "other-board", route);
  }
  assert.deepEqual(signals, []);
  assert.ok(!store.getCard(card.id)?.paused);
});

test("pause_card on a card that is not a loop answers 409 not-pausable", async () => {
  const { id } = await store.createLocalCard(SBX, "plain", "");
  await store.completeStart(id, undefined, {
    workspacePath: "/tmp/ws-plain",
    tmuxSession: "dsp-PAUSE-1",
    branch: "plain",
  });
  const reply = await call(`/sessions/${id}/pause`);
  assert.equal(reply.status, 409);
  assert.deepEqual(reply.body, { error: "not-pausable", reason: "not a loop" });
  assert.deepEqual(signals, []);
});

test("resume_card is refused under memory pressure, then resumes after recovery", async () => {
  const id = await loopCard();
  await call(`/sessions/${id}/pause`);
  signals = [];

  recordMemory(100, 100);
  const refused = await call(`/sessions/${id}/unpause`);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "memory-pressure");
  assert.equal(
    refused.body.reason,
    "free memory 100 MB is below the 1024 MB floor",
  );
  assert.ok(store.getCard(id)?.paused);
  assert.deepEqual(signals, []);

  recordMemory(4096, 100);
  const resumed = await call(`/sessions/${id}/unpause`);
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.body, { resumed: true });
  assert.ok(!store.getCard(id)?.paused);
  assert.deepEqual(signals[0], ["SIGCONT", [4242]]);
  assert.equal(reasons(id).at(-1), "resumed by orchestrator orc-sbx");
});

test("resume_card on an unpaused card answers 409 not-paused", async () => {
  const id = await loopCard();
  const reply = await call(`/sessions/${id}/unpause`);
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "not-paused");
});

test("resume_card on an unpaused card under memory pressure answers 409 memory-pressure", async () => {
  const id = await loopCard();
  recordMemory(100, 100);
  const reply = await call(`/sessions/${id}/unpause`);
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "memory-pressure");
  recordMemory(4096, 100);
});

test("pause_card and resume_card answer 404 unknown-card on the hidden orchestrator card and change nothing", async () => {
  const hidden = await store.createOrchestratorCard(
    SBX,
    "Orchestrator: hidden",
    "orc-hidden",
  );
  for (const route of ["pause", "unpause"]) {
    const reply = await call(`/sessions/${hidden.id}/${route}`);
    assert.equal(reply.status, 404, route);
    assert.equal(reply.body.error, "unknown-card", route);
  }
  assert.deepEqual(signals, []);
  assert.deepEqual(reasons(hidden.id), []);
  assert.ok(!store.getCard(hidden.id)?.paused);
});

test("pause_card and resume_card answer 403 other-owner on a card of another orchestrator and change nothing", async () => {
  const id = await loopCard();
  const before = store.getBoard(SBX)!.orchestrators;
  await store.setBoardOrchestrators(SBX, [
    ...before,
    {
      id: "extra-pause",
      name: "extra-pause",
      role: "extra",
      scope: { groupIds: [id], ticketIds: [] },
      policyOverride: {},
      cardId: null,
      state: "stopped",
      createdAt: "2026-10-14T00:00:00.000Z",
    },
  ]);
  try {
    for (const route of ["pause", "unpause"]) {
      const reply = await call(`/sessions/${id}/${route}`);
      assert.equal(reply.status, 403, route);
      assert.deepEqual(reply.body, { error: "other-owner" }, route);
    }
    assert.deepEqual(signals, []);
    assert.deepEqual(reasons(id), []);
    assert.ok(!store.getCard(id)?.paused);
  } finally {
    await store.setBoardOrchestrators(SBX, before);
  }
});
