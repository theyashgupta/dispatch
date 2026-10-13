import assert from "node:assert/strict";
import test, { after } from "node:test";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  Card,
  LoopProgress,
  OrchestrationEvent,
  OrchestratorRecord,
} from "../../shared/types.js";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { LOOP_PROGRESS } = await import("../test-support/supervised-session.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { startedGroup } = await import("../test-support/group-fixtures.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
await store.load();
for (const key of [SBX, OTH]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: [],
  });
}

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
app.use("/api", express.json(), boardsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  method: string,
  route: string,
  token?: string,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: token === undefined ? {} : { "x-orchestrator-token": token },
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

function toolCalls(): OrchestrationEvent[] {
  return store
    .listOrchestrationEvents(SBX, 0, 10_000)
    .filter((e) => e.kind === "tool_call");
}

/** Run one SBX read and return the single `tool_call` row it appended. */
async function read(
  id: string,
): Promise<{ reply: Reply; row: OrchestrationEvent }> {
  const before = toolCalls().length;
  const reply = await call("GET", `/orchestrator/cards/${id}/progress`, TOKEN);
  await waitFor(
    () => Promise.resolve(toolCalls().length > before),
    2000,
    "tool_call row",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(toolCalls().length, before + 1);
  return { reply, row: toolCalls().at(-1)! };
}

const minted = await call("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

const PROGRESS: LoopProgress = {
  ...LOOP_PROGRESS,
  prdFile: "PRD.md",
  units: [
    {
      number: 1,
      ticket: null,
      title: "the PRD",
      status: "in progress",
      statusText: "in progress",
      branch: null,
      commit: null,
      prdPath: "PRD.md",
      phaseTotal: 1,
      phases: [
        {
          number: 1,
          name: "build",
          gate: "pending",
          attempts: 0,
          passedAt: null,
        },
      ],
    },
  ],
};

async function launchedTicket(board: BoardKey, title: string): Promise<Card> {
  const card = await store.createLocalCard(board, title, "");
  await store.completeStart(card.id, undefined, {
    workspacePath: `/tmp/ws-${card.id}`,
    tmuxSession: `dsp-${card.id}`,
    branch: card.id,
  });
  await store.setOrchestratorFields(card.id, {
    ownerOrchestrator: "orc-sbx",
    launch: { direction: "" },
  });
  return store.getCard(card.id)!;
}

void test("get_card_progress answers the stored loop progress of a launched ticket card", async () => {
  const card = await launchedTicket(SBX, "with progress");
  await store.setLoopProgress(card.id, PROGRESS);
  const { reply, row } = await read(card.id);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.cardId, card.id);
  assert.deepEqual(reply.body.loopProgress, PROGRESS);
  assert.equal(reply.body.lastMarker, null);
  assert.equal(row.data.tool, "get_card_progress");
  assert.equal(row.cardId, card.id);
});

void test("get_card_progress answers null loop progress when none is stored", async () => {
  const card = await launchedTicket(SBX, "no progress");
  const { reply } = await read(card.id);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.loopProgress, null);
});

void test("get_card_progress echoes the stored last marker", async () => {
  const card = await launchedTicket(SBX, "with marker");
  await store.applyMarker(
    card.id,
    undefined,
    "agent_done",
    undefined,
    "DONE all",
    "status_agent_done",
  );
  assert.equal(store.getCard(card.id)?.lastMarker, "DONE all");
  const { reply } = await read(card.id);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.lastMarker, "DONE all");
});

void test("get_card_progress answers 400 not-launched-card for a group card and an unlaunched ticket", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  const group = await read(g.id);
  assert.equal(group.reply.status, 400);
  assert.equal(group.reply.body.error, "not-launched-card");
  assert.equal(group.row.data.tool, "get_card_progress");

  const plain = await store.createLocalCard(SBX, "plain", "");
  const unlaunched = await read(plain.id);
  assert.equal(unlaunched.reply.status, 400);
  assert.equal(unlaunched.reply.body.error, "not-launched-card");
});

void test("get_card_progress answers 404 unknown-card for an unknown id and the hidden orchestrator card", async () => {
  const unknown = await read("SBX-9999");
  assert.equal(unknown.reply.status, 404);
  assert.equal(unknown.reply.body.error, "unknown-card");
  assert.equal(unknown.row.data.tool, "get_card_progress");

  const hidden = await store.createOrchestratorCard(
    SBX,
    "Orchestrator: orc-sbx",
    "orc-sbx",
  );
  const refused = await read(hidden.id);
  assert.equal(refused.reply.status, 404);
  assert.equal(refused.reply.body.error, "unknown-card");
});

void test("get_card_progress answers 403 for a card on another board", async () => {
  const other = await launchedTicket(OTH, "other board");
  await store.setLoopProgress(other.id, PROGRESS);
  const { reply, row } = await read(other.id);
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "other-board");
  assert.equal(row.data.tool, "get_card_progress");
  assert.ok(!JSON.stringify(reply.body).includes("PRD.md"));
});

void test("get_card_progress answers 401 with no token", async () => {
  const reply = await call("GET", "/orchestrator/cards/SBX-1/progress");
  assert.equal(reply.status, 401);
});

void test("get_card_progress answers 403 other-owner for a card an extra orchestrator owns", async () => {
  const card = await launchedTicket(SBX, "owned by an extra");
  await store.setLoopProgress(card.id, PROGRESS);
  const record = (
    id: string,
    role: "main" | "extra",
    ticketIds: string[],
  ): OrchestratorRecord => ({
    id,
    name: id,
    role,
    scope: { groupIds: [], ticketIds },
    policyOverride: {},
    cardId: null,
    state: "stopped",
    createdAt: "2026-10-07T00:00:00.000Z",
  });
  await store.setBoardOrchestrators(SBX, [
    record("main", "main", []),
    record("extra-1", "extra", [card.id]),
  ]);
  try {
    const main = await call("POST", "/boards/SBX/orchestrators/main/token");
    const reply = await call(
      "GET",
      `/orchestrator/cards/${card.id}/progress`,
      main.body.token as string,
    );
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error, "other-owner");
    assert.ok(!JSON.stringify(reply.body).includes("PRD.md"));
  } finally {
    await store.setBoardOrchestrators(SBX, []);
  }
});

void test("get_card_progress answers 401 with a revoked token", async () => {
  const card = await launchedTicket(SBX, "revoked read");
  const minted = await call("POST", "/boards/SBX/orchestrators/orc-old/token");
  await call("DELETE", "/boards/SBX/orchestrators/orc-old/token");
  const reply = await call(
    "GET",
    `/orchestrator/cards/${card.id}/progress`,
    minted.body.token as string,
  );
  assert.equal(reply.status, 401);
  assert.equal(reply.body.error, "orchestrator-token-invalid");
});
