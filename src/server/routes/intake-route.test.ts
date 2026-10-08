import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, OrchestratorRecord } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { stopPollers } = await import("../adapters/poller.js");
const { apiRouter } = await import("./index.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const BARE = parseBoardKey("BARE") as BoardKey;
await store.load();
for (const key of [SBX, BARE]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: [],
  });
}
const main: OrchestratorRecord = {
  id: "orc-sbx",
  name: "Main",
  role: "main",
  scope: { groupIds: [], ticketIds: [] },
  policyOverride: {},
  cardId: null,
  state: "stopped",
  createdAt: "2026-10-08T00:00:00.000Z",
};
await store.setBoardOrchestrators(SBX, [main]);

const app = express();
app.use("/api", express.json({ limit: "1mb" }), apiRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  stopPollers();
  env.cleanup();
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function call(
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

const intakeEvents = (key: BoardKey) =>
  store
    .listOrchestrationEvents(key, 0, 1000)
    .filter((e) => e.kind === "intake_submitted");

void test("intake answers 202 with the event id and appends intake_submitted for the main orchestrator", async () => {
  const reply = await call("/boards/SBX/intake", {
    goal: "  Build the export  ",
    requirements: "CSV only",
  });
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  const [event] = intakeEvents(SBX);
  assert.equal(reply.body.eventId, event.id);
  assert.deepEqual(event.data, {
    orchestratorId: "orc-sbx",
    goal: "Build the export",
    requirements: "CSV only",
  });
  assert.equal(store.listCards(SBX).length, 0);
});

void test("intake takes a goal alone", async () => {
  const reply = await call("/boards/SBX/intake", { goal: "Just a goal" });
  assert.equal(reply.status, 202);
  assert.equal(intakeEvents(SBX).at(-1)?.data.requirements, null);
});

void test("intake refuses a bad body and a bad board and appends nothing", async () => {
  const before = intakeEvents(SBX).length;
  const cases: [string, unknown, number, string][] = [
    ["/boards/SBX/intake", {}, 400, "invalid-goal"],
    ["/boards/SBX/intake", { goal: "" }, 400, "invalid-goal"],
    ["/boards/SBX/intake", { goal: "   " }, 400, "invalid-goal"],
    ["/boards/SBX/intake", { goal: "g".repeat(2001) }, 400, "invalid-goal"],
    ["/boards/SBX/intake", { goal: 5 }, 400, "invalid-goal"],
    [
      "/boards/SBX/intake",
      { goal: "g", requirements: "r".repeat(65537) },
      400,
      "invalid-requirements",
    ],
    [
      "/boards/SBX/intake",
      { goal: "g", requirements: 5 },
      400,
      "invalid-requirements",
    ],
    ["/boards/SBX/intake", { goal: "g", extra: 1 }, 400, "unknown-field"],
    ["/boards/NOPE/intake", { goal: "g" }, 404, "unknown-board"],
  ];
  for (const [route, body, status, error] of cases) {
    const reply = await call(route, body);
    assert.equal(
      reply.status,
      status,
      `${route} ${JSON.stringify(body).slice(0, 60)}`,
    );
    assert.equal(reply.body.error, error);
  }
  assert.equal(intakeEvents(SBX).length, before);
});

void test("intake accepts requirements of exactly 64 KiB", async () => {
  const reply = await call("/boards/SBX/intake", {
    goal: "g",
    requirements: "r".repeat(65536),
  });
  assert.equal(reply.status, 202);
});

void test("intake on a board with no main orchestrator is 409 no-main-orchestrator", async () => {
  const reply = await call("/boards/BARE/intake", { goal: "g" });
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "no-main-orchestrator");
  assert.equal(intakeEvents(BARE).length, 0);
});

void test("intake refuses an orchestrator token with 403 and appends nothing", async () => {
  const minted = await call("/boards/SBX/orchestrators/orc-sbx/token");
  const token = minted.body.token as string;
  const before = intakeEvents(SBX).length;
  const reply = await call("/boards/SBX/intake", { goal: "g" }, token);
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "orchestrator-token-on-user-route");
  assert.equal(intakeEvents(SBX).length, before);
});
