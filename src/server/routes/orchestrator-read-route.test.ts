import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, Card, OrchestrationEvent } from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { LOOP_PROGRESS } = await import("../test-support/supervised-session.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { paneReader } =
  await import("../services/orchestration/orchestrator-read.js");
const { createPlaybook } = await import("../services/infra/playbooks.js");

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

const METERS = {
  contextPercent: 40,
  model: "opus",
  cost: 1.5,
  usage: { fiveHourPercent: 10, sevenDayPercent: 20 },
};

const sbxPlain = await store.createLocalCard(SBX, "Alpha plain card", "");
const sbxGroup = await startedGroup(store, { board: SBX });
const sbxQueued = await store.createGroupCard(SBX, "queued group", [
  (await store.createLocalCard(SBX, "queued a", "")).id,
  (await store.createLocalCard(SBX, "queued b", "")).id,
]);
assert.ok(sbxQueued.ok);
const othGroup = await startedGroup(store, { board: OTH });
const othPlain = await store.createLocalCard(OTH, "Alpha oth card", "");
for (const g of [sbxGroup.g, othGroup.g]) {
  await store.setLoopProgress(g.id, LOOP_PROGRESS);
  await store.setSessionMetersIfSession(g.id, g.tmuxSession!, METERS);
}
const sbxSessionId = store.getCard(sbxGroup.g.id)!.activeSessionId!;

const seededIds: Record<string, number[]> = { SBX: [], OTH: [] };
for (const [board, cardId] of [
  [SBX, sbxPlain.id],
  [OTH, othPlain.id],
  [SBX, sbxPlain.id],
  [OTH, othPlain.id],
] as const) {
  const event = store.appendOrchestrationEvent({
    boardKey: board,
    cardId,
    sessionId: null,
    kind: "supervisor_action",
    data: { board },
    ts: new Date().toISOString(),
  });
  seededIds[board].push(event.id);
}

const app = express();
app.use("/api/orchestrator", orchestratorRouter);
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
  text: string;
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
    text,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

function toolCalls(board: BoardKey): OrchestrationEvent[] {
  return store
    .listOrchestrationEvents(board, 0, 10_000)
    .filter((e) => e.kind === "tool_call");
}

/** Run one SBX read and return the single `tool_call` row it appended. */
async function read(
  route: string,
): Promise<{ reply: Reply; row: OrchestrationEvent }> {
  const before = toolCalls(SBX).length;
  const reply = await call("GET", route, TOKEN);
  await waitFor(
    () => Promise.resolve(toolCalls(SBX).length > before),
    2000,
    "tool_call row",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(toolCalls(SBX).length, before + 1);
  return { reply, row: toolCalls(SBX).at(-1)! };
}

const minted = await call("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

const othIds = [
  othPlain.id,
  othGroup.g.id,
  othGroup.a.id,
  othGroup.b.id,
  "OTH",
];
function assertNoOth(reply: Reply): void {
  for (const id of othIds) {
    assert.ok(!reply.text.includes(id), `${id} leaked`);
  }
}

void test("list_cards answers the SBX cards only and filters by column, source and text", async () => {
  const { reply, row } = await read("/orchestrator/cards");
  assert.equal(reply.status, 200);
  assertNoOth(reply);
  const ids = (reply.body.cards as Card[]).map((c) => c.id);
  assert.ok(ids.includes(sbxPlain.id) && ids.includes(sbxGroup.g.id));
  assert.equal(reply.body.total, ids.length);
  assert.equal(row.data.tool, "list_cards");
  assert.equal(row.data.result, `${ids.length} cards`);

  const group = await call(
    "GET",
    "/orchestrator/cards?source=group&column=in_progress",
    TOKEN,
  );
  assert.deepEqual(
    (group.body.cards as Card[]).map((c) => c.id),
    [sbxGroup.g.id],
  );
  const text = await call("GET", "/orchestrator/cards?text=ALPHA", TOKEN);
  assert.deepEqual(
    (text.body.cards as Card[]).map((c) => c.id),
    [sbxPlain.id],
  );
  const byId = await call(
    "GET",
    `/orchestrator/cards?text=${sbxPlain.identifier.toLowerCase()}`,
    TOKEN,
  );
  assert.deepEqual(
    (byId.body.cards as Card[]).map((c) => c.id),
    [sbxPlain.id],
  );
  const bad = await call("GET", "/orchestrator/cards?column=nope", TOKEN);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid-column");
});

void test("a board param never changes the token board", async () => {
  const reply = await call("GET", "/orchestrator/cards?board=OTH", TOKEN);
  assert.equal(reply.status, 200);
  assertNoOth(reply);
});

void test("get_card answers a group card with its members and refuses an OTH card", async () => {
  const { reply, row } = await read(`/orchestrator/cards/${sbxGroup.g.id}`);
  assert.equal(reply.status, 200);
  assert.deepEqual(
    (reply.body.members as Card[]).map((c) => c.id).sort(),
    [sbxGroup.a.id, sbxGroup.b.id].sort(),
  );
  assert.equal(row.data.tool, "get_card");
  const plain = await call("GET", `/orchestrator/cards/${sbxPlain.id}`, TOKEN);
  assert.deepEqual(plain.body.members, []);
  const other = await call("GET", `/orchestrator/cards/${othPlain.id}`, TOKEN);
  assert.equal(other.status, 403);
  assert.equal(other.body.error, "other-board");
  assertNoOth({ ...other, text: other.text.replace(othPlain.id, "") });
});

void test("list_sessions answers the SBX sessions with the meters and honours live", async () => {
  const { reply, row } = await read("/orchestrator/sessions");
  assert.equal(reply.status, 200);
  assertNoOth(reply);
  const sessions = reply.body.sessions as {
    id: string;
    cardId: string;
    cost: number;
    model: string;
    contextPercent: number;
  }[];
  const mine = sessions.find((s) => s.id === sbxSessionId)!;
  assert.equal(mine.cardId, sbxGroup.g.id);
  assert.equal(mine.cost, 1.5);
  assert.equal(mine.model, "opus");
  assert.equal(mine.contextPercent, 40);
  assert.equal(row.data.tool, "list_sessions");
  const live = await call("GET", "/orchestrator/sessions?live=true", TOKEN);
  assert.equal((live.body.sessions as unknown[]).length, sessions.length);
  const lost = await call("GET", "/orchestrator/sessions?live=false", TOKEN);
  assert.deepEqual(lost.body.sessions, []);
  const bad = await call("GET", "/orchestrator/sessions?live=maybe", TOKEN);
  assert.equal(bad.body.error, "invalid-live");
});

void test("get_group_progress answers the loop progress and refuses other cards", async () => {
  const { reply, row } = await read(
    `/orchestrator/groups/${sbxGroup.g.id}/progress`,
  );
  assert.equal(reply.status, 200);
  assert.equal(reply.body.cardId, sbxGroup.g.id);
  assert.deepEqual(reply.body.loopProgress, LOOP_PROGRESS);
  assert.equal(row.data.tool, "get_group_progress");
  assert.equal(row.cardId, sbxGroup.g.id);

  const plain = await call(
    "GET",
    `/orchestrator/groups/${sbxPlain.id}/progress`,
    TOKEN,
  );
  assert.equal(plain.status, 400);
  assert.equal(plain.body.error, "not-group-card");
  const unknown = await call(
    "GET",
    "/orchestrator/groups/SBX-999/progress",
    TOKEN,
  );
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "unknown-card");
  const other = await call(
    "GET",
    `/orchestrator/groups/${othGroup.g.id}/progress`,
    TOKEN,
  );
  assert.equal(other.status, 403);
  assert.equal(other.body.error, "other-board");
});

void test("read_pane_tail answers the last lines without trailing blanks", async () => {
  const targets: string[] = [];
  paneReader.capture = (target) => {
    targets.push(target);
    return Promise.resolve(
      `${Array.from({ length: 300 }, (_, i) => `row ${i}`).join("\n")}\n  \n\n`,
    );
  };
  const tmux = store.getCard(sbxGroup.g.id)!.tmuxSession!;
  const { reply, row } = await read(
    `/orchestrator/sessions/${sbxGroup.g.id}/pane?lines=3`,
  );
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, {
    cardId: sbxGroup.g.id,
    sessionId: sbxSessionId,
    lines: ["row 297", "row 298", "row 299"],
  });
  assert.deepEqual(targets, [`=${tmux}:`]);
  assert.equal(row.data.tool, "read_pane_tail");
  assert.equal(row.data.result, "3 lines");
  const dflt = await call(
    "GET",
    `/orchestrator/sessions/${sbxGroup.g.id}/pane`,
    TOKEN,
  );
  assert.equal((dflt.body.lines as string[]).length, 50);
  const max = await call(
    "GET",
    `/orchestrator/sessions/${sbxGroup.g.id}/pane?lines=200`,
    TOKEN,
  );
  assert.equal(max.status, 200);
  assert.equal((max.body.lines as string[]).length, 200);
});

void test("read_pane_tail refuses a bad line count before any capture", async () => {
  let captured = 0;
  paneReader.capture = () => {
    captured += 1;
    return Promise.resolve("x");
  };
  for (const lines of ["0", "201", "abc", "1.5", "-1", ""]) {
    const reply = await call(
      "GET",
      `/orchestrator/sessions/${sbxGroup.g.id}/pane?lines=${lines}`,
      TOKEN,
    );
    assert.equal(reply.status, 400, lines);
    assert.equal(reply.body.error, "invalid-lines", lines);
  }
  assert.equal(captured, 0);
});

void test("read_pane_tail refuses an OTH card and a card with no live session", async () => {
  let captured = 0;
  paneReader.capture = () => {
    captured += 1;
    return Promise.resolve("x");
  };
  const other = await call(
    "GET",
    `/orchestrator/sessions/${othGroup.g.id}/pane`,
    TOKEN,
  );
  assert.equal(other.status, 403);
  assert.equal(other.body.error, "other-board");
  const none = await call(
    "GET",
    `/orchestrator/sessions/${sbxPlain.id}/pane`,
    TOKEN,
  );
  assert.equal(none.status, 409);
  assert.equal(none.body.error, "no-live-session");
  assert.equal(captured, 0);
  paneReader.capture = () => Promise.reject(new Error("no server"));
  const gone = await call(
    "GET",
    `/orchestrator/sessions/${sbxGroup.g.id}/pane`,
    TOKEN,
  );
  assert.equal(gone.status, 409);
  assert.equal(gone.body.error, "no-live-session");
});

void test("list_events answers the SBX rows after the cursor, oldest first", async () => {
  const mine = seededIds.SBX.map((id) => ({ id }));
  const all = await call("GET", "/orchestrator/events?limit=200", TOKEN);
  assert.equal(all.status, 200);
  const rows = (all.body.events as OrchestrationEvent[]).filter((e) =>
    mine.some((m) => m.id === e.id),
  );
  assert.deepEqual(
    rows.map((e) => e.id),
    mine.map((e) => e.id),
  );
  const ids = (all.body.events as OrchestrationEvent[]).map((e) => e.id);
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => a - b),
  );
  assert.ok(
    (all.body.events as OrchestrationEvent[]).every((e) => e.boardKey === SBX),
  );
  assert.equal(all.body.cursor, ids.at(-1));

  const since = mine[0].id;
  const { reply, row } = await read(`/orchestrator/events?since=${since}`);
  const later = (reply.body.events as OrchestrationEvent[]).filter((e) =>
    mine.some((m) => m.id === e.id),
  );
  assert.deepEqual(
    later.map((e) => e.id),
    [mine[1].id],
  );
  assert.ok(
    (reply.body.events as OrchestrationEvent[]).every((e) => e.id > since),
  );
  assert.equal(row.data.tool, "list_events");
  const past = ids.at(-1)! + 1000;
  const empty = await call("GET", `/orchestrator/events?since=${past}`, TOKEN);
  assert.deepEqual(empty.body, { events: [], cursor: past });
  const one = await call("GET", "/orchestrator/events?limit=1", TOKEN);
  assert.equal((one.body.events as unknown[]).length, 1);
  for (const q of ["limit=0", "limit=201", "limit=x", "since=-1", "since=x"]) {
    const bad = await call("GET", `/orchestrator/events?${q}`, TOKEN);
    assert.equal(bad.status, 400, q);
    assert.equal(
      bad.body.error,
      q.startsWith("limit") ? "invalid-limit" : "invalid-since",
    );
  }
});

void test("get_policy counts the running loops and sums the cost per group", async () => {
  const { reply, row } = await read("/orchestrator/policy");
  assert.equal(reply.status, 200);
  assertNoOth(reply);
  const policy = store.getBoard(SBX)!.policy;
  assert.deepEqual(reply.body.policy, policy);
  assert.equal(reply.body.concurrencyCap, policy.concurrencyCap);
  assert.equal(reply.body.runningLoops, 1);
  const groups = reply.body.groups as {
    cardId: string;
    cost: number;
    budget: number | null;
  }[];
  assert.deepEqual(
    groups.map((g) => g.cardId).sort(),
    [sbxGroup.g.id, sbxQueued.card.id].sort(),
  );
  assert.equal(groups.find((g) => g.cardId === sbxGroup.g.id)!.cost, 1.5);
  assert.equal(groups.find((g) => g.cardId === sbxQueued.card.id)!.cost, 0);
  assert.equal(groups[0].budget, policy.budgetPerGroup);
  assert.equal(row.data.tool, "get_policy");
  assert.equal(row.data.result, "1 running");
});

void test("get_policy lists the sorted playbook names and the group playbook", async () => {
  for (const name of ["Zeta rules", "Alpha rules"]) {
    const made = await createPlaybook({ name, body: "## Rules\n{extra}\n" });
    assert.equal(made.ok, true);
  }
  await store.setBoardPolicy(SBX, {
    ...store.getBoard(SBX)!.policy,
    groupPlaybook: "Alpha rules",
  });
  try {
    const { reply } = await read("/orchestrator/policy");
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body.playbooks, ["Alpha rules", "Zeta rules"]);
    assert.equal(
      (reply.body.policy as { groupPlaybook: string | null }).groupPlaybook,
      "Alpha rules",
    );
  } finally {
    await store.setBoardPolicy(SBX, {
      ...store.getBoard(SBX)!.policy,
      groupPlaybook: null,
    });
  }
});

void test("a read without a token answers 401", async () => {
  const reply = await call("GET", "/orchestrator/policy");
  assert.equal(reply.status, 401);
});

void test("list_cards refuses an empty source and an empty text", async () => {
  for (const [query, error] of [
    ["source=", "invalid-source"],
    ["text=", "invalid-text"],
  ]) {
    const { reply } = await read(`/orchestrator/cards?${query}`);
    assert.equal(reply.status, 400, query);
    assert.equal(reply.body.error, error, query);
  }
});
