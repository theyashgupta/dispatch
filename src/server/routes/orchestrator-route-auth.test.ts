import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, OrchestrationEvent } from "../../shared/types.js";

const env = isolateEnv();
const { store, redactCard } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { resolveOrchestratorToken } =
  await import("../services/orchestration/orchestrator-tokens.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
const NONE = "-" as BoardKey;
await store.load();
for (const key of [SBX, OTH]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: key === SBX ? ["LIN"] : [],
  });
}
await store.applyIssues(
  [issue("OTH-77", { identifier: "LIN-77" })],
  new Date().toISOString(),
  { source: "linear" },
);
const sbxCard = await store.createLocalCard(SBX, "sbx card", "");
const othCard = await store.createLocalCard(OTH, "oth card", "");

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

function toolCalls(board: BoardKey): OrchestrationEvent[] {
  return store
    .listOrchestrationEvents(board, 0, 10_000)
    .filter((e) => e.kind === "tool_call");
}

/** Run one orchestrator call and return the single `tool_call` row it appended on `board`. */
async function callRecorded(
  board: BoardKey,
  route: string,
  token?: string,
  method = "GET",
): Promise<{ reply: Reply; row: OrchestrationEvent }> {
  const before = [SBX, OTH, NONE].map((b) => toolCalls(b).length);
  const total = () =>
    [SBX, OTH, NONE].reduce((n, b) => n + toolCalls(b).length, 0);
  const startTotal = before.reduce((a, b) => a + b, 0);
  const reply = await call(method, route, token);
  await waitFor(
    () => Promise.resolve(total() > startTotal),
    2000,
    "tool_call row",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(total(), startTotal + 1, "exactly one tool_call row");
  const rows = toolCalls(board);
  assert.equal(rows.length, before[[SBX, OTH, NONE].indexOf(board)] + 1);
  return { reply, row: rows.at(-1)! };
}

async function mint(board: string, id: string): Promise<string> {
  const got = await call("POST", `/boards/${board}/orchestrators/${id}/token`);
  assert.equal(got.status, 201, JSON.stringify(got.body));
  return got.body.token as string;
}

const SBX_TOKEN = await mint("SBX", "orc-sbx");

void test("mint answers 201 with a token that resolves to the board and orchestrator", () => {
  assert.match(SBX_TOKEN, /^[0-9a-f]{64}$/);
  assert.deepEqual(resolveOrchestratorToken(SBX_TOKEN), {
    boardKey: SBX,
    orchestratorId: "orc-sbx",
    revoked: false,
  });
});

void test("mint refuses an unknown board with 404 and a bad orchestrator id with 400", async () => {
  const unknown = await call("POST", "/boards/NOPE/orchestrators/orc-1/token");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "unknown-board");
  for (const bad of ["Bad", "-lead", "a".repeat(33), "a_b"]) {
    const got = await call("POST", `/boards/SBX/orchestrators/${bad}/token`);
    assert.equal(got.status, 400, bad);
    assert.equal(got.body.error, "invalid-orchestrator-id", bad);
  }
  const badBoard = await call("POST", "/boards/bad!/orchestrators/orc-1/token");
  assert.equal(badBoard.status, 400);
});

void test("DELETE revokes the live token and answers the count", async () => {
  const token = await mint("SBX", "orc-del");
  const got = await call("DELETE", "/boards/SBX/orchestrators/orc-del/token");
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { revoked: 1 });
  assert.equal(resolveOrchestratorToken(token)?.revoked, true);
  const again = await call("DELETE", "/boards/SBX/orchestrators/orc-del/token");
  assert.deepEqual(again.body, { revoked: 0 });
});

void test("no token answers 401 orchestrator-token-required, recorded under board -", async () => {
  const { reply, row } = await callRecorded(
    NONE,
    `/orchestrator/cards/${sbxCard.id}`,
  );
  assert.equal(reply.status, 401);
  assert.equal(reply.body.error, "orchestrator-token-required");
  assert.equal(row.cardId, sbxCard.id);
  assert.deepEqual(row.data, {
    orchestratorId: null,
    tool: "get_card",
    args: { params: { id: sbxCard.id } },
    status: 401,
    result: "orchestrator-token-required",
    reason: "orchestrator-token-required",
  });
});

void test("an empty token header counts as no token", async () => {
  const { reply } = await callRecorded(
    NONE,
    `/orchestrator/cards/${sbxCard.id}`,
    "",
  );
  assert.equal(reply.status, 401);
  assert.equal(reply.body.error, "orchestrator-token-required");
});

void test("an unknown token answers 401 orchestrator-token-invalid, recorded under board -", async () => {
  const { reply, row } = await callRecorded(
    NONE,
    `/orchestrator/cards/${sbxCard.id}`,
    "0".repeat(64),
  );
  assert.equal(reply.status, 401);
  assert.equal(reply.body.error, "orchestrator-token-invalid");
  assert.equal(row.data.orchestratorId, null);
  assert.equal(row.data.status, 401);
  assert.equal(row.data.reason, "orchestrator-token-invalid");
});

void test("a revoked token answers 401 orchestrator-token-invalid, recorded under its board", async () => {
  const token = await mint("SBX", "orc-old");
  await call("DELETE", "/boards/SBX/orchestrators/orc-old/token");
  const { reply, row } = await callRecorded(
    SBX,
    `/orchestrator/cards/${sbxCard.id}`,
    token,
  );
  assert.equal(reply.status, 401);
  assert.equal(reply.body.error, "orchestrator-token-invalid");
  assert.equal(row.data.orchestratorId, "orc-old");
  assert.equal(row.data.status, 401);
  assert.equal(row.data.reason, "orchestrator-token-invalid");
});

void test("an SBX token reads an SBX card with 200 and the redacted card", async () => {
  const { reply, row } = await callRecorded(
    SBX,
    `/orchestrator/cards/${sbxCard.id}`,
    SBX_TOKEN,
  );
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, {
    card: JSON.parse(
      JSON.stringify(redactCard(store.getCard(sbxCard.id)!)),
    ) as unknown,
    members: [],
  });
  assert.equal(row.cardId, sbxCard.id);
  assert.deepEqual(row.data, {
    orchestratorId: "orc-sbx",
    tool: "get_card",
    args: { params: { id: sbxCard.id } },
    status: 200,
    result: sbxCard.id,
  });
});

void test("an SBX token on an OTH card answers 403 other-board and leaves the card unchanged", async () => {
  const before = JSON.stringify(store.getCard(othCard.id));
  const othBefore = toolCalls(OTH).length;
  const { reply, row } = await callRecorded(
    SBX,
    `/orchestrator/cards/${othCard.id}`,
    SBX_TOKEN,
  );
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "other-board");
  assert.equal(reply.body.card, undefined);
  assert.equal(JSON.stringify(store.getCard(othCard.id)), before);
  assert.equal(toolCalls(OTH).length, othBefore);
  assert.equal(row.cardId, othCard.id);
  assert.equal(row.data.status, 403);
  assert.equal(row.data.result, "other-board");
  assert.equal(row.data.reason, "other-board");
});

void test("scope follows the stored board key, not the prefix of the card id", async () => {
  const lookalike = store.getCard("OTH-77");
  assert.equal(lookalike?.boardKey, SBX);
  const mine = await callRecorded(SBX, "/orchestrator/cards/OTH-77", SBX_TOKEN);
  assert.equal(mine.reply.status, 200);
  assert.equal(mine.row.data.status, 200);
  const othToken = await mint("OTH", "orc-oth");
  const theirs = await callRecorded(
    OTH,
    "/orchestrator/cards/OTH-77",
    othToken,
  );
  assert.equal(theirs.reply.status, 403);
  assert.equal(theirs.reply.body.error, "other-board");
  assert.equal(theirs.reply.body.card, undefined);
  assert.equal(theirs.row.data.reason, "other-board");
  assert.equal(store.getCard("OTH-77")?.boardKey, SBX);
});

void test("an unknown card answers 404 unknown-card", async () => {
  const { reply, row } = await callRecorded(
    SBX,
    "/orchestrator/cards/SBX-999",
    SBX_TOKEN,
  );
  assert.equal(reply.status, 404);
  assert.equal(reply.body.error, "unknown-card");
  assert.equal(row.data.status, 404);
  assert.equal(row.data.reason, "unknown-card");
});

void test("a long string argument is cut at 4096 characters in the record", async () => {
  const { row } = await callRecorded(
    SBX,
    `/orchestrator/cards/${sbxCard.id}?note=${"n".repeat(5000)}`,
    SBX_TOKEN,
  );
  assert.equal(
    (row.data.args as { query: { note: string } }).query.note.length,
    4096,
  );
});

void test("a query id never stands in for the path id in the record", async () => {
  const { row } = await callRecorded(
    SBX,
    `/orchestrator/cards/${sbxCard.id}?id=SBX-FAKE`,
    SBX_TOKEN,
  );
  assert.equal(row.cardId, sbxCard.id);
  assert.deepEqual(row.data.args, {
    params: { id: sbxCard.id },
    query: { id: "SBX-FAKE" },
  });
});

void test("a card id of more than 200 characters in the path answers 400 invalid-card-id", async () => {
  const { reply, row } = await callRecorded(
    SBX,
    `/orchestrator/cards/${"A".repeat(201)}`,
    SBX_TOKEN,
  );
  assert.equal(reply.status, 400);
  assert.equal(reply.body.error, "invalid-card-id");
  assert.equal(row.data.status, 400);
});

const TOOL_ROUTES: [method: string, route: string, tool: string][] = [
  ["GET", "/cards", "list_cards"],
  ["GET", "/cards/:id", "get_card"],
  ["GET", "/sessions", "list_sessions"],
  ["GET", "/groups/:id/progress", "get_group_progress"],
  ["GET", "/sessions/:cardId/pane", "read_pane_tail"],
  ["GET", "/events", "list_events"],
  ["GET", "/policy", "get_policy"],
  ["GET", "/board-workspace", "get_board_workspace"],
  ["POST", "/tickets", "create_ticket"],
  ["PATCH", "/tickets/:id", "update_ticket"],
  ["POST", "/tickets/:id/move", "move_card"],
  ["POST", "/tickets/:id/comments", "add_comment"],
  ["POST", "/base-branches", "create_base_branch"],
  ["POST", "/groups", "create_group"],
  ["POST", "/groups/:id/start", "start_group"],
  ["POST", "/sessions/:cardId/input", "send_input"],
  ["POST", "/groups/:cardId/approve-roadmap", "approve_roadmap"],
  ["POST", "/sessions/:cardId/handoff", "request_handoff"],
  ["POST", "/sessions/:cardId/resume", "resume_loop"],
  ["POST", "/sessions/:cardId/stop", "stop_session"],
  ["POST", "/decisions", "create_decision_item"],
  ["POST", "/events/wait", "wait_for_event"],
  ["POST", "/groups/:cardId/ship", "start_ship"],
  ["GET", "/groups/:cardId/ship", "get_ship_state"],
  ["GET", "/state", "read_state"],
  ["PUT", "/state", "write_state"],
  ["GET", "/playbooks", "list_playbooks"],
  ["GET", "/rulebook", "get_rulebook"],
  ["POST", "/cards/:cardId/start", "start_card"],
];

void test("every one of the 29 orchestrator routes answers 401 with no token and records one tool_call row", async () => {
  const mounted = (
    orchestratorRouter.stack as {
      route?: { path: string; methods: Record<string, boolean> };
    }[]
  ).flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map(
          (m) => `${m.toUpperCase()} ${layer.route!.path}`,
        )
      : [],
  );
  assert.equal(TOOL_ROUTES.length, 29);
  assert.deepEqual(
    TOOL_ROUTES.map(([method, route]) => `${method} ${route}`).sort(),
    mounted.sort(),
  );
  for (const [method, route, name] of TOOL_ROUTES) {
    const param = /:(id|cardId)\b/.exec(route)?.[1];
    const path = `/orchestrator${param === undefined ? route : route.replace(`:${param}`, sbxCard.id)}`;
    const { reply, row } = await callRecorded(NONE, path, undefined, method);
    const label = `${method} ${route}`;
    assert.equal(reply.status, 401, label);
    assert.equal(reply.body.error, "orchestrator-token-required", label);
    assert.equal(row.cardId, param === undefined ? null : sbxCard.id, label);
    assert.deepEqual(
      row.data,
      {
        orchestratorId: null,
        tool: name,
        args: param === undefined ? {} : { params: { [param]: sbxCard.id } },
        status: 401,
        result: "orchestrator-token-required",
        reason: "orchestrator-token-required",
      },
      label,
    );
  }
});
