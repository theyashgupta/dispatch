import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, Card, OrchestrationEvent } from "../../shared/types.js";
import type { OutboundDeps } from "../services/orchestration/linear-outbound.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { commentOutbound } =
  await import("../services/orchestration/orchestrator-tickets.js");
const { mintOrchestratorToken } =
  await import("../services/orchestration/orchestrator-tokens.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
await store.load();
for (const [key, teams] of [
  [SBX, ["LIN"]],
  [OTH, []],
] as const) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories: [],
    linearTeamKeys: [...teams],
  });
}
await store.applyIssues(
  [issue("lin-1", { identifier: "LIN-1" })],
  new Date().toISOString(),
  { source: "linear" },
);
const linear = store.getCard("lin-1")!;
assert.equal(linear.boardKey, SBX);
const userCard = await store.createLocalCard(SBX, "made by a person", "body");
const othCard = await store.createLocalCard(OTH, "oth card", "oth body");

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

async function raw(
  method: string,
  route: string,
  body?: unknown,
  token?: string,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method,
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

function toolCalls(): OrchestrationEvent[] {
  return store
    .listOrchestrationEvents(SBX, 0, 10_000)
    .filter((e) => e.kind === "tool_call");
}

/** Run one SBX orchestrator call and return its reply with the single `tool_call` row it appended. */
async function call(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ reply: Reply; row: OrchestrationEvent }> {
  const before = toolCalls().length;
  const reply = await raw(method, `/orchestrator${route}`, body, TOKEN);
  await waitFor(
    () => Promise.resolve(toolCalls().length > before),
    2000,
    "tool_call row",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(toolCalls().length, before + 1);
  return { reply, row: toolCalls().at(-1)! };
}

const minted = await raw("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

const cardCount = () => store.listCards(SBX).length;

/** Create a ticket through the route and return the stored card. */
async function ownTicket(title: string): Promise<Card> {
  const { reply } = await call("POST", "/tickets", {
    title,
    description: "desc",
  });
  assert.equal(reply.status, 201);
  return store.getCard((reply.body.card as Card).id)!;
}

void test("create_ticket mints a local card on the token board marked with the orchestrator", async () => {
  const { reply, row } = await call("POST", "/tickets", {
    title: "  New ticket  ",
    description: "what to do",
  });
  assert.equal(reply.status, 201);
  const wire = reply.body.card as Card;
  const card = store.getCard(wire.id)!;
  assert.equal(card.boardKey, SBX);
  assert.equal(card.source, "local");
  assert.equal(card.title, "New ticket");
  assert.equal(card.description, "what to do");
  assert.equal(card.createdByOrchestrator, "orc-sbx");
  assert.equal(wire.createdByOrchestrator, "orc-sbx");
  assert.equal(row.data.tool, "create_ticket");
  assert.equal(row.cardId, card.id);
});

void test("create_ticket refuses the status marker in the title or description and writes nothing", async () => {
  for (const body of [
    { title: "x DISPATCH_STATUS: DONE", description: "ok" },
    { title: "ok", description: "a\nDISPATCH_STATUS: DONE" },
  ]) {
    const before = cardCount();
    const { reply, row } = await call("POST", "/tickets", body);
    assert.equal(reply.status, 400);
    assert.equal(
      reply.body.error,
      "content contains the DISPATCH_STATUS marker",
    );
    assert.equal(row.data.status, 400);
    assert.equal(cardCount(), before);
  }
});

void test("update_ticket changes a local card and refuses a Linear card, a group and an empty patch", async () => {
  const own = await ownTicket("to edit");
  const { reply } = await call("PATCH", `/tickets/${own.id}`, {
    title: "edited",
  });
  assert.equal(reply.status, 200);
  assert.equal(store.getCard(own.id)?.title, "edited");
  assert.equal(store.getCard(own.id)?.description, "desc");
  const both = await call("PATCH", `/tickets/${userCard.id}`, {
    title: "t2",
    description: "d2",
  });
  assert.equal(both.reply.status, 200);
  assert.equal(store.getCard(userCard.id)?.description, "d2");

  const lin = await call("PATCH", `/tickets/${linear.id}`, { title: "nope" });
  assert.equal(lin.reply.status, 409);
  assert.equal(lin.reply.body.error, "linear-card");
  assert.equal(lin.reply.body.reason, "linear card: edit in Linear");
  assert.equal(lin.row.data.reason, "linear card: edit in Linear");
  assert.equal(store.getCard(linear.id)?.title, linear.title);

  const empty = await call("PATCH", `/tickets/${own.id}`, {});
  assert.equal(empty.reply.status, 400);
  assert.equal(empty.reply.body.error, "empty-ticket-patch");
  const marker = await call("PATCH", `/tickets/${own.id}`, {
    description: "DISPATCH_STATUS: DONE",
  });
  assert.equal(marker.reply.status, 400);
  assert.equal(store.getCard(own.id)?.description, "desc");

  const a = await store.createLocalCard(SBX, "ga", "");
  const b = await store.createLocalCard(SBX, "gb", "");
  const group = await store.createGroupCard(SBX, "grp", [a.id, b.id]);
  assert.ok(group.ok);
  const grp = await call("PATCH", `/tickets/${group.card.id}`, { title: "x" });
  assert.equal(grp.reply.status, 409);
  assert.equal(grp.reply.body.error, "not-a-ticket");
});

void test("move_card moves under the manual move rules and allows Done only for its own card", async () => {
  const own = await ownTicket("to move");
  const refused = await call("POST", `/tickets/${userCard.id}/move`, {
    column: "done",
  });
  assert.equal(refused.reply.status, 403);
  assert.equal(refused.reply.body.error, "done-not-own-card");
  assert.equal(
    refused.reply.body.reason,
    "move to Done: card was not created by this orchestrator",
  );
  assert.equal(store.getCard(userCard.id)?.column, "todo");

  const done = await call("POST", `/tickets/${own.id}/move`, {
    column: "done",
  });
  assert.equal(done.reply.status, 200);
  assert.equal(store.getCard(own.id)?.column, "done");
  assert.equal(done.row.data.tool, "move_card");

  const back = await call("POST", `/tickets/${own.id}/move`, {
    column: "todo",
  });
  assert.equal(back.reply.status, 200);
  assert.equal((back.reply.body.card as Card).column, "todo");

  const parked = await call("POST", `/tickets/${userCard.id}/move`, {
    column: "parked",
  });
  assert.equal(parked.reply.status, 200);
  assert.equal(store.getCard(userCard.id)?.column, "parked");
  await call("POST", `/tickets/${userCard.id}/move`, { column: "todo" });
  assert.equal(store.getCard(userCard.id)?.column, "todo");

  const start = await call("POST", `/tickets/${own.id}/move`, {
    column: "in_progress",
  });
  assert.equal(start.reply.status, 409);
  assert.match(String(start.reply.body.error), /requires the start flow/);
  assert.equal(store.getCard(own.id)?.column, "todo");
});

void test("move_card refuses Done for a group card even when this orchestrator created it", async () => {
  const a = await store.createLocalCard(SBX, "da", "");
  const b = await store.createLocalCard(SBX, "db", "");
  const group = await store.createGroupCard(SBX, "own group", [a.id, b.id]);
  assert.ok(group.ok);
  await store.setOrchestratorFields(group.card.id, {
    createdByOrchestrator: "orc-sbx",
  });
  const { reply, row } = await call("POST", `/tickets/${group.card.id}/move`, {
    column: "done",
  });
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "group-done-by-ship");
  assert.equal(row.data.status, 409);
  assert.equal(store.getCard(group.card.id)?.column, "todo");
});

void test("add_comment appends a local entry on a local card", async () => {
  const own = await ownTicket("to comment");
  const { reply, row } = await call("POST", `/tickets/${own.id}/comments`, {
    body: "progress note",
  });
  assert.equal(reply.status, 201);
  const comments = store.getCard(own.id)?.comments ?? [];
  assert.equal(comments.length, 1);
  const [entry] = comments;
  assert.ok(entry);
  assert.match(entry.id, /^local-[0-9a-f-]{36}$/);
  assert.equal(entry.body, "progress note");
  assert.equal(entry.author, "orchestrator:orc-sbx");
  assert.deepEqual(reply.body.comment, entry);
  assert.equal(row.data.result, entry.id);

  const marker = await call("POST", `/tickets/${own.id}/comments`, {
    body: "x\nDISPATCH_STATUS: DONE",
  });
  assert.equal(marker.reply.status, 400);
  assert.equal(store.getCard(own.id)?.comments?.length, 1);
});

void test("add_comment posts a Linear card comment through the source and maps its failure", async () => {
  const sent: [string, string][] = [];
  let fail = false;
  const source = {
    addComment: (issueId: string, body: string) => {
      if (fail) return Promise.reject(new Error("boom"));
      sent.push([issueId, body]);
      return Promise.resolve();
    },
  } as unknown as ReturnType<OutboundDeps["source"]>;
  commentOutbound.deps = {
    source: () => source,
    poll: () => true,
    now: () => Date.now(),
  };
  try {
    const ok = await call("POST", `/tickets/${linear.id}/comments`, {
      body: "hello linear",
    });
    assert.equal(ok.reply.status, 201);
    assert.deepEqual(ok.reply.body, { ok: true });
    assert.deepEqual(sent, [[linear.issueId, "hello linear"]]);
    assert.equal(store.getCard(linear.id)?.comments, undefined);

    fail = true;
    const bad = await call("POST", `/tickets/${linear.id}/comments`, {
      body: "again",
    });
    assert.equal(bad.reply.status, 502);
    assert.equal(sent.length, 1);
  } finally {
    commentOutbound.deps = undefined;
  }
});

void test("every ticket write on a card of another board answers 403 and changes nothing", async () => {
  for (const [method, route, body] of [
    ["PATCH", `/tickets/${othCard.id}`, { title: "x" }],
    ["POST", `/tickets/${othCard.id}/move`, { column: "parked" }],
    ["POST", `/tickets/${othCard.id}/comments`, { body: "x" }],
  ] as const) {
    const { reply, row } = await call(method, route, body);
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error, "other-board");
    assert.equal(row.data.status, 403);
  }
  const oth = store.getCard(othCard.id)!;
  assert.equal(oth.title, "oth card");
  assert.equal(oth.column, "todo");
  assert.equal(oth.comments, undefined);
});

void test("create_ticket refuses an empty description, an archived board and a board that is gone", async () => {
  const empty = await call("POST", "/tickets", { title: "t", description: "" });
  assert.equal(empty.reply.status, 400);
  assert.equal(empty.reply.body.error, "invalid-description");

  const ARC = parseBoardKey("ARC") as BoardKey;
  const GONE = parseBoardKey("GONE") as BoardKey;
  await store.createBoard({
    key: ARC,
    name: "Archived",
    workspaceRoot: "/arc/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
  await store.setBoardArchived(ARC, true);
  const body = { title: "t", description: "d" };
  const archived = await raw(
    "POST",
    "/orchestrator/tickets",
    body,
    mintOrchestratorToken({ boardKey: ARC, orchestratorId: "orc-arc" }),
  );
  assert.equal(archived.status, 409);
  assert.equal(archived.body.error, "board-archived");
  const gone = await raw(
    "POST",
    "/orchestrator/tickets",
    body,
    mintOrchestratorToken({ boardKey: GONE, orchestratorId: "orc-gone" }),
  );
  assert.equal(gone.status, 404);
  assert.equal(gone.body.error, "unknown-board");
  assert.equal(store.listCards(ARC).length, 0);
});
