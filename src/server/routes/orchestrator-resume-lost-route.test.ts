import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, Card } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { sessionTools } =
  await import("../services/orchestration/orchestrator-sessions.js");
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
const resumed: Card[] = [];
sessionTools.resume = (card) => {
  resumed.push(card);
};

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

async function raw(route: string, token?: string): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { "x-orchestrator-token": token }),
    },
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

const minted = await raw("/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;
const resumeLost = (id: string) =>
  raw(`/orchestrator/sessions/${id}/resume-lost`, TOKEN);

async function startedCard(title: string, board: BoardKey = SBX) {
  const card = await store.createLocalCard(board, title, "");
  await store.completeStart(card.id, undefined, {
    workspacePath: `${env.root}/${title}`,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  return card.id;
}

async function lostCard(title: string, board: BoardKey = SBX) {
  const id = await startedCard(title, board);
  await store.markSessionLost(id, store.getCard(id)!.activeSessionId);
  return id;
}

async function toolRows(expected = 1) {
  for (let waited = 0; waited < 2000; waited += 20) {
    if (rowsNow().length >= expected) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return rowsNow();
}

function rowsNow() {
  return store
    .listOrchestrationEvents(SBX, 0, 10_000)
    .filter((e) => e.kind === "tool_call" && e.data.tool === "resume_session");
}

async function refused(
  id: string,
  status: number,
  error: string,
): Promise<Reply> {
  const reply = await resumeLost(id);
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  assert.equal(reply.body.error, error);
  assert.equal(resumed.length, 0);
  return reply;
}

recordMemory(2048, 1000);

void test("resume_session resumes a lost owned card, answers 202 and records one tool_call row", async () => {
  resumed.length = 0;
  const id = await lostCard("happy");
  const reply = await resumeLost(id);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  assert.deepEqual(reply.body, { result: "resuming" });
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]?.id, id);
  const rows = await toolRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.data.result, "resuming");
});

void test("resume_session refuses a card with a live session", async () => {
  resumed.length = 0;
  await refused(await startedCard("live"), 409, "session-live");
});

void test("resume_session refuses a card that never had a workspace", async () => {
  resumed.length = 0;
  const card = await store.createLocalCard(SBX, "never", "");
  await refused(card.id, 409, "no-lost-session");
});

void test("resume_session refuses a lost card while a start is in flight", async () => {
  resumed.length = 0;
  const id = await lostCard("inflight");
  store.beginStart(id);
  try {
    await refused(id, 409, "start-in-flight");
  } finally {
    store.endStart(id);
  }
});

void test("resume_session under memory pressure answers 409 memory-low with the reason", async () => {
  resumed.length = 0;
  const id = await lostCard("memory");
  recordMemory(812, 1000);
  try {
    const reply = await refused(id, 409, "memory-low");
    assert.equal(
      reply.body.reason,
      "free memory 812 MB is below the 1024 MB floor",
    );
  } finally {
    recordMemory(2048, 1000);
  }
});

void test("resume_session refuses a card of another board and an unknown card", async () => {
  resumed.length = 0;
  const foreign = await lostCard("foreign", OTH);
  const before = rowsNow().length;
  await refused(foreign, 403, "other-board");
  const unknown = await resumeLost("no-such-card");
  assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
  assert.equal(resumed.length, 0);
  assert.equal((await toolRows(before + 2)).length, before + 2);
});

void test("resume_session refuses a card with a workspace but no lost flag and no session record", async () => {
  resumed.length = 0;
  const id = await startedCard("norecord");
  const live = store.getCard(id)!;
  delete live.tmuxSession;
  delete live.sessions;
  delete live.activeSessionId;
  await refused(id, 409, "no-lost-session");
});

void test("resume_session refuses a card whose identifier is not a ticket identifier", async () => {
  resumed.length = 0;
  const id = await lostCard("badid");
  const live = store.getCard(id)!;
  const { identifier } = live;
  live.identifier = "bad id";
  try {
    await refused(id, 400, "invalid-identifier");
  } finally {
    live.identifier = identifier;
  }
});

void test("resume_session refuses a launch card at the cap with 403 policy-refused and still resumes a plain card", async () => {
  resumed.length = 0;
  const running = await startedCard("caprunning");
  await store.setOrchestratorFields(running, {
    launch: { playbook: "Write code directly", direction: "" },
  });
  const id = await lostCard("capcard");
  await store.setOrchestratorFields(id, {
    launch: { playbook: "Write code directly", direction: "" },
  });
  const plain = await lostCard("capplain");
  const policy = store.getBoard(SBX)!.policy;
  await store.setBoardPolicy(SBX, { ...policy, concurrencyCap: 1 });
  try {
    const reply = await refused(id, 403, "policy-refused");
    assert.equal(
      reply.body.reason,
      "concurrency cap reached: 1 of 1 loops running",
    );
    const plainReply = await resumeLost(plain);
    assert.equal(plainReply.status, 202, JSON.stringify(plainReply.body));
    assert.deepEqual(
      resumed.map((c) => c.id),
      [plain],
    );
  } finally {
    await store.setBoardPolicy(SBX, policy);
  }
});
