import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, OrchestrationEvent } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { LOOP_PROGRESS } = await import("../test-support/supervised-session.js");
const express = (await import("express")).default;
const { boardsRouter } = await import("./boards.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { groupCost } =
  await import("../services/orchestration/orchestrator-read.js");

const BRD_A = parseBoardKey("BRDA") as BoardKey;
const BRD_B = parseBoardKey("BRDB") as BoardKey;
const BRD_OLD = parseBoardKey("OLDO") as BoardKey;
await store.load();
for (const key of [BRD_A, BRD_B]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: [],
  });
}

const running = await startedGroup(store, { board: BRD_A });
await store.setLoopProgress(running.g.id, LOOP_PROGRESS);
await store.setSessionMetersIfSession(running.g.id, running.g.tmuxSession!, {
  contextPercent: 40,
  model: "opus",
  cost: 2.25,
  usage: { fiveHourPercent: 10, sevenDayPercent: 20 },
});
const queued = await store.createGroupCard(BRD_A, "queued group", [
  (await store.createLocalCard(BRD_A, "queued a", "")).id,
  (await store.createLocalCard(BRD_A, "queued b", "")).id,
]);
assert.ok(queued.ok);
const other = await startedGroup(store, { board: BRD_B });

function seed(board: BoardKey, label: string): OrchestrationEvent {
  return store.appendOrchestrationEvent({
    boardKey: board,
    cardId: null,
    sessionId: null,
    kind: "supervisor_action",
    data: { label },
    ts: new Date().toISOString(),
  });
}
const aIds = [1, 2, 3, 4].map((n) => seed(BRD_A, `a${n}`).id);
const bId = seed(BRD_B, "b1").id;

const app = express();
app.use("/api", express.json(), boardsRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

async function get(route: string): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await fetch(`${base}${route}`);
  return { status: res.status, body: (await res.json()) as never };
}

void test("GET /boards/:key/orchestration answers the cap, the running loops and one entry per group with progress or a session", async () => {
  const policy = store.getBoard(BRD_A)!.policy;
  const reply = await get("/boards/BRDA/orchestration");
  assert.equal(reply.status, 200);
  assert.deepEqual(Object.keys(reply.body).sort(), [
    "concurrencyCap",
    "groups",
    "runningLoops",
  ]);
  assert.equal(reply.body.concurrencyCap, policy.concurrencyCap);
  assert.equal(reply.body.runningLoops, 1);
  const groups = reply.body.groups as {
    cardId: string;
    groupId: string;
    cost: number;
    budget: number | null;
    budgetSource: string;
  }[];
  assert.deepEqual(
    groups.map((g) => g.cardId),
    [running.g.id],
  );
  assert.equal(groups[0]?.groupId, running.g.identifier);
  assert.equal(groups[0]?.budgetSource, "board");
  assert.equal(groups[0]?.budget, policy.budgetPerGroup);
  assert.equal(groups[0]?.cost, groupCost(store.getCard(running.g.id)!));
  assert.equal(groups[0]?.cost, 2.25);
});

void test("GET /boards/:key/orchestration holds only the groups of its own board", async () => {
  const reply = await get("/boards/BRDB/orchestration");
  assert.equal(reply.status, 200);
  assert.deepEqual(
    (reply.body.groups as { cardId: string }[]).map((g) => g.cardId),
    [other.g.id],
  );
});

void test("the orchestration routes answer 400 invalid-board for a bad key before any store read", async (t) => {
  const getBoard = t.mock.method(store, "getBoard");
  const listLatest = t.mock.method(store, "listLatestOrchestrationEvents");
  for (const route of [
    "/boards/bad_key/orchestration",
    "/boards/bad_key/orchestration/events",
  ]) {
    const reply = await get(route);
    assert.equal(reply.status, 400, route);
    assert.equal(reply.body.error, "invalid-board");
  }
  assert.equal(getBoard.mock.callCount(), 0);
  assert.equal(listLatest.mock.callCount(), 0);
});

void test("the orchestration routes answer 404 unknown-board for a key with no board", async () => {
  for (const route of [
    "/boards/NOPE/orchestration",
    "/boards/NOPE/orchestration/events",
  ]) {
    const reply = await get(route);
    assert.equal(reply.status, 404, route);
    assert.equal(reply.body.error, "unknown-board");
  }
});

void test("GET events without since answers the newest events first and holds only that board", async () => {
  const reply = await get("/boards/BRDA/orchestration/events");
  assert.equal(reply.status, 200);
  const events = reply.body.events as OrchestrationEvent[];
  assert.deepEqual(
    events.map((e) => e.id),
    [...aIds].reverse(),
  );
  assert.ok(events.every((e) => e.boardKey === BRD_A));
  assert.ok(!events.some((e) => e.id === bId));
  const two = await get("/boards/BRDA/orchestration/events?limit=2");
  assert.deepEqual(
    (two.body.events as OrchestrationEvent[]).map((e) => e.id),
    [aIds[3], aIds[2]],
  );
});

void test("GET events with since answers the later events oldest first", async () => {
  const reply = await get(`/boards/BRDA/orchestration/events?since=${aIds[1]}`);
  assert.equal(reply.status, 200);
  assert.deepEqual(
    (reply.body.events as OrchestrationEvent[]).map((e) => e.id),
    [aIds[2], aIds[3]],
  );
  const zero = await get("/boards/BRDA/orchestration/events?since=0&limit=1");
  assert.deepEqual(
    (zero.body.events as OrchestrationEvent[]).map((e) => e.id),
    [aIds[0]],
  );
});

void test("GET events refuses a limit outside 1 to 1000 and a bad since", async () => {
  for (const [query, code] of [
    ["limit=0", "invalid-limit"],
    ["limit=1001", "invalid-limit"],
    ["limit=x", "invalid-limit"],
    ["since=-1", "invalid-since"],
    ["since=x", "invalid-since"],
  ] as const) {
    const reply = await get(`/boards/BRDA/orchestration/events?${query}`);
    assert.equal(reply.status, 400, query);
    assert.equal(reply.body.error, code, query);
  }
  assert.equal(
    (await get("/boards/BRDA/orchestration/events?limit=1000")).status,
    200,
  );
});

void test("the events of board B stay out of board A", async () => {
  const reply = await get("/boards/BRDB/orchestration/events");
  assert.deepEqual(
    (reply.body.events as OrchestrationEvent[]).map((e) => e.id),
    [bId],
  );
});

void test("GET /boards/:key/orchestration and its events answer 404 for an archived board", async () => {
  await store.createBoard({
    key: BRD_OLD,
    name: "OLDO",
    workspaceRoot: "/oldo/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
  await store.setBoardArchived(BRD_OLD, true);
  const summary = await get("/boards/OLDO/orchestration");
  const events = await get("/boards/OLDO/orchestration/events");
  assert.deepEqual(
    [summary.status, summary.body.error],
    [404, "unknown-board"],
  );
  assert.deepEqual([events.status, events.body.error], [404, "unknown-board"]);
});

void test("GET /boards/:key/orchestration takes a lower owner budget override and never a higher one", async () => {
  const policy = store.getBoard(BRD_B)!.policy;
  await store.setBoardPolicy(BRD_B, { ...policy, budgetPerGroup: 20 });
  const extra = (budgetPerGroup: number) => ({
    id: "x1",
    name: "Release extra",
    role: "extra" as const,
    scope: { groupIds: [other.g.id], ticketIds: [] },
    policyOverride: { budgetPerGroup },
    cardId: null,
    state: "stopped" as const,
    createdAt: new Date().toISOString(),
  });
  type Group = { budget: number; budgetSource: string; ownerName: string };
  const first = async () => {
    const reply = await get("/boards/BRDB/orchestration");
    const group = (reply.body.groups as Group[])[0];
    return [group?.budget, group?.budgetSource, group?.ownerName];
  };

  await store.setBoardOrchestrators(BRD_B, [extra(12)]);
  assert.deepEqual(await first(), [12, "override", "Release extra"]);

  await store.setBoardOrchestrators(BRD_B, [extra(50)]);
  assert.deepEqual(await first(), [20, "board", null]);

  await store.setBoardOrchestrators(BRD_B, []);
  assert.deepEqual(await first(), [20, "board", null]);
});

void test("GET /boards/:key/orchestration leaves out a group card in Done", async () => {
  const finished = await startedGroup(store, { board: BRD_B });
  await store.setLoopProgress(finished.g.id, LOOP_PROGRESS);
  const ids = async () =>
    (
      (await get("/boards/BRDB/orchestration")).body.groups as {
        cardId: string;
      }[]
    ).map((g) => g.cardId);
  assert.ok((await ids()).includes(finished.g.id));
  await store.moveCardManual(finished.g.id, "done");
  assert.ok(!(await ids()).includes(finished.g.id));
});
