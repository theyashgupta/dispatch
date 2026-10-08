import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  DecisionItem,
  OrchestrationEvent,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { stopPollers } = await import("../adapters/poller.js");
const { apiRouter } = await import("./index.js");

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
const sbxCard = await store.createLocalCard(SBX, "sbx card", "");
const othCard = await store.createLocalCard(OTH, "oth card", "");

const app = express();
app.use("/api", express.json(), apiRouter);
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
  method: string,
  route: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers["x-orchestrator-token"] = opts.token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${route}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

function rows(board: BoardKey, kind: string): OrchestrationEvent[] {
  return store
    .listOrchestrationEvents(board, 0, 10_000)
    .filter((e) => e.kind === kind);
}

const minted = await call("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

const OPTIONS = [
  { id: "approve", label: "Approve" },
  { id: "reject", label: "Reject" },
];

function create(
  body: Record<string, unknown>,
  token: string | null = TOKEN,
): Promise<Reply> {
  return call("POST", "/orchestrator/decisions", {
    ...(token === null ? {} : { token }),
    body: { kind: "ruling", question: "Which way?", options: OPTIONS, ...body },
  });
}

async function created(
  body: Record<string, unknown> = {},
): Promise<DecisionItem> {
  const reply = await create(body);
  assert.equal(reply.status, 201);
  return reply.body.item as DecisionItem;
}

void test("create_decision_item answers 201, stores an open item and records decision_raised and one tool_call", async () => {
  const toolBefore = rows(SBX, "tool_call").length;
  const reply = await create({
    cardId: sbxCard.id,
    kind: "roadmap_approval",
    recommendedOptionId: "approve",
  });
  assert.equal(reply.status, 201);
  const item = reply.body.item as DecisionItem;
  assert.equal(item.boardKey, SBX);
  assert.equal(item.orchestratorId, "orc-sbx");
  assert.equal(item.state, "open");
  assert.equal(item.cardId, sbxCard.id);
  assert.equal(item.recommendedOptionId, "approve");
  assert.deepEqual(store.getDecisionItem(item.id), item);
  const raised = rows(SBX, "decision_raised");
  assert.equal(raised.length, 1);
  assert.equal(raised[0].cardId, sbxCard.id);
  assert.equal(raised[0].data.decisionId, item.id);
  await waitFor(
    () => Promise.resolve(rows(SBX, "tool_call").length > toolBefore),
    2000,
    "tool_call row",
  );
  await new Promise((r) => setTimeout(r, 20));
  const calls = rows(SBX, "tool_call").slice(toolBefore);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.tool, "create_decision_item");
  assert.equal(calls[0].cardId, sbxCard.id);
});

void test("a roadmap_approval item gets the server options and ignores the caller options", async () => {
  const item = await created({
    cardId: sbxCard.id,
    kind: "roadmap_approval",
    question: "Pause the loop while you review?",
    options: [
      { id: "approve", label: "Yes, pause it" },
      { id: "no", label: "No" },
    ],
    recommendedOptionId: "no",
  });
  const server = [
    { id: "approve", label: "Approve the roadmap" },
    { id: "reject", label: "Do not approve" },
  ];
  assert.deepEqual(item.options, server);
  assert.equal(item.recommendedOptionId, "approve");
  assert.deepEqual(store.getDecisionItem(item.id)?.options, server);
  const ruling = await created({
    options: [
      { id: "approve", label: "Yes, pause it" },
      { id: "no", label: "No" },
    ],
  });
  assert.deepEqual(
    ruling.options.map((o) => o.label),
    ["Yes, pause it", "No"],
  );
});

void test("a bad option list, kind, question or recommended id answers 400", async () => {
  const dup = [OPTIONS[0], OPTIONS[0]];
  const nine = Array.from({ length: 9 }, (_, i) => ({
    id: `o${i}`,
    label: "x",
  }));
  const cases: [Record<string, unknown>, string][] = [
    [{ options: [OPTIONS[0]] }, "invalid-options"],
    [{ options: dup }, "invalid-options"],
    [{ options: nine }, "invalid-options"],
    [
      { options: [{ id: "Bad Id", label: "x" }, OPTIONS[1]] },
      "invalid-options",
    ],
    [{ options: [{ id: "a", label: "" }, OPTIONS[1]] }, "invalid-options"],
    [{ kind: "nope" }, "invalid-kind"],
    [{ question: "" }, "invalid-question"],
    [{ question: "q".repeat(2001) }, "invalid-question"],
    [{ recommendedOptionId: "other" }, "invalid-recommended-option"],
  ];
  const before = store.listDecisionItems(SBX).length;
  for (const [body, error] of cases) {
    const reply = await create(body);
    assert.equal(reply.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(reply.body.error, error);
  }
  assert.equal(store.listDecisionItems(SBX).length, before);
});

void test("a card of another board answers 403, an unknown card 404, and nothing is stored", async () => {
  const before = store.listDecisionItems(SBX).length;
  const other = await create({ cardId: othCard.id });
  assert.equal(other.status, 403);
  assert.equal(other.body.error, "other-board");
  const unknown = await create({ cardId: "nope" });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "unknown-card");
  assert.equal(store.listDecisionItems(SBX).length, before);
});

void test("create without a token answers 401", async () => {
  const reply = await create({}, null);
  assert.equal(reply.status, 401);
});

void test("GET /decisions lists the items of the named board only, with the state filter", async () => {
  store.insertDecisionItem({
    ...(await created()),
    id: "oth-1",
    boardKey: OTH,
    cardId: null,
  });
  const sbx = await call("GET", "/decisions?board=SBX");
  assert.equal(sbx.status, 200);
  const items = sbx.body.items as DecisionItem[];
  assert.ok(items.length >= 2);
  assert.ok(items.every((i) => i.boardKey === SBX));
  const oth = await call("GET", "/decisions?board=OTH");
  assert.deepEqual(
    (oth.body.items as DecisionItem[]).map((i) => i.id),
    ["oth-1"],
  );
  const open = await call("GET", "/decisions?board=SBX&state=open");
  assert.equal((open.body.items as DecisionItem[]).length, items.length);
  const answered = await call("GET", "/decisions?board=SBX&state=answered");
  assert.deepEqual(answered.body.items, []);
  assert.equal((await call("GET", "/decisions?state=bogus")).status, 400);
  assert.equal((await call("GET", "/decisions?board=NOPE")).status, 404);
});

void test("an answer answers 200, stores the answer and appends one decision_answered row", async () => {
  const item = await created({ cardId: sbxCard.id, kind: "ship_failure" });
  const reply = await call("POST", `/decisions/${item.id}/answer`, {
    body: { optionId: "reject", note: "not now" },
  });
  assert.equal(reply.status, 200);
  const answered = reply.body.item as DecisionItem;
  assert.equal(answered.state, "answered");
  assert.deepEqual(answered.answer, { optionId: "reject", note: "not now" });
  assert.ok(answered.answeredAt);
  const events = rows(SBX, "decision_answered").filter(
    (e) => e.data.decisionId === item.id,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].cardId, sbxCard.id);
  assert.deepEqual(events[0].data, {
    decisionId: item.id,
    kind: "ship_failure",
    orchestratorId: "orc-sbx",
    optionId: "reject",
    note: "not now",
  });
});

void test("a second answer answers 409 and changes nothing", async () => {
  const item = await created();
  const url = `/decisions/${item.id}/answer`;
  assert.equal(
    (await call("POST", url, { body: { optionId: "approve" } })).status,
    200,
  );
  const events = rows(SBX, "decision_answered").length;
  const again = await call("POST", url, { body: { optionId: "reject" } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "already-answered");
  assert.deepEqual(store.getDecisionItem(item.id)!.answer, {
    optionId: "approve",
    note: null,
  });
  assert.equal(rows(SBX, "decision_answered").length, events);
});

void test("an unknown option answers 400, an unknown id 404, a bad note 400", async () => {
  const item = await created();
  const url = `/decisions/${item.id}/answer`;
  const option = await call("POST", url, { body: { optionId: "maybe" } });
  assert.equal(option.status, 400);
  assert.equal(option.body.error, "invalid-option");
  const note = await call("POST", url, {
    body: { optionId: "approve", note: "n".repeat(2001) },
  });
  assert.equal(note.status, 400);
  assert.equal(note.body.error, "invalid-note");
  assert.equal(store.getDecisionItem(item.id)!.state, "open");
  const unknown = await call("POST", "/decisions/nope/answer", {
    body: { optionId: "approve" },
  });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "unknown-decision");
});

void test("an answer with an orchestrator token answers 403 and the item stays open", async () => {
  const item = await created();
  const events = rows(SBX, "decision_answered").length;
  const reply = await call("POST", `/decisions/${item.id}/answer`, {
    token: TOKEN,
    body: { optionId: "approve" },
  });
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "orchestrator-token-on-user-route");
  assert.equal(store.getDecisionItem(item.id)!.state, "open");
  assert.equal(rows(SBX, "decision_answered").length, events);
});

void test("a wait on decision_answered resolves with the answer event within 2 s of the user answer", async () => {
  const item = await created({ cardId: sbxCard.id });
  const since = store.listOrchestrationEvents(SBX, 0, 10_000).at(-1)!.id;
  const wait = call("POST", "/orchestrator/events/wait", {
    token: TOKEN,
    body: { since, kinds: ["decision_answered"], timeoutSeconds: 30 },
  });
  await new Promise((r) => setTimeout(r, 300));
  const answeredAt = Date.now();
  await call("POST", `/decisions/${item.id}/answer`, {
    body: { optionId: "approve" },
  });
  const reply = await wait;
  assert.ok(Date.now() - answeredAt < 2000);
  assert.equal(reply.status, 200);
  const event = reply.body.event as OrchestrationEvent;
  assert.equal(event.kind, "decision_answered");
  assert.equal(event.data.decisionId, item.id);
  assert.equal(event.data.optionId, "approve");
});

void test("a wait with no event answers timedOut and the cursor, and a bad body answers 400", async () => {
  const since = store.listOrchestrationEvents(SBX, 0, 10_000).at(-1)!.id;
  const reply = await call("POST", "/orchestrator/events/wait", {
    token: TOKEN,
    body: { since, kinds: ["pr_state"], timeoutSeconds: 1 },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.timedOut, true);
  assert.ok((reply.body.cursor as number) >= since);
  const bad: [Record<string, unknown>, string][] = [
    [{ since: -1 }, "invalid-since"],
    [{ since: 1.5 }, "invalid-since"],
    [{ since: 0, kinds: [] }, "invalid-kinds"],
    [{ since: 0, kinds: ["nope"] }, "invalid-kinds"],
    [{ since: 0, cardIds: [] }, "invalid-card-ids"],
    [{ since: 0, timeoutSeconds: 0 }, "invalid-timeout"],
    [{ since: 0, timeoutSeconds: 541 }, "invalid-timeout"],
  ];
  for (const [body, error] of bad) {
    const got = await call("POST", "/orchestrator/events/wait", {
      token: TOKEN,
      body,
    });
    assert.equal(got.status, 400, JSON.stringify(body));
    assert.equal(got.body.error, error);
  }
});

void test("a client that disconnects mid-wait leaves no listener and records client-closed", async () => {
  const before = store.listenerCount("orchestration");
  const toolBefore = rows(SBX, "tool_call").length;
  const gone = new AbortController();
  const pending = fetch(`${base}/orchestrator/events/wait`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-orchestrator-token": TOKEN,
    },
    body: JSON.stringify({ since: 1_000_000, timeoutSeconds: 60 }),
    signal: gone.signal,
  }).catch(() => null);
  await waitFor(
    () => Promise.resolve(store.listenerCount("orchestration") > before),
    2000,
    "wait listener",
  );
  gone.abort();
  await pending;
  await waitFor(
    () => Promise.resolve(store.listenerCount("orchestration") === before),
    2000,
    "listener removed",
  );
  await waitFor(
    () => Promise.resolve(rows(SBX, "tool_call").length > toolBefore),
    2000,
    "tool_call row",
  );
  const record = rows(SBX, "tool_call").at(-1);
  assert.equal(record?.data.tool, "wait_for_event");
  assert.equal(record?.data.result, "client-closed");
});

void test("a ticket_proposal item holds the tickets, gets the server options and is answered by the user", async () => {
  const tickets = [
    { title: "First", description: "Do the first part" },
    { title: "Second", description: "Do the second part" },
  ];
  const item = await created({
    kind: "ticket_proposal",
    tickets,
    options: [
      { id: "x", label: "X" },
      { id: "y", label: "Y" },
    ],
  });
  assert.deepEqual(
    item.options.map((o) => o.id),
    ["approve", "reject"],
  );
  assert.equal(item.recommendedOptionId, "approve");
  assert.deepEqual(item.proposal, { tickets, usedIndexes: [] });
  const answered = await call("POST", `/decisions/${item.id}/answer`, {
    body: { optionId: "approve" },
  });
  assert.equal(answered.status, 200);
  const event = rows(SBX, "decision_answered").find(
    (e) => e.data.decisionId === item.id,
  );
  assert.equal(event?.data.orchestratorId, "orc-sbx");
  assert.equal(event?.data.kind, "ticket_proposal");
});

void test("tickets are refused on another kind, required on a proposal and bounded", async () => {
  const ticket = { title: "t", description: "d" };
  const marker = "x DISPATCH_STATUS: DONE";
  const cases: [Record<string, unknown>, string][] = [
    [{ kind: "ruling", tickets: [ticket] }, "invalid-tickets"],
    [{ kind: "ticket_proposal" }, "invalid-tickets"],
    [{ kind: "ticket_proposal", tickets: [] }, "invalid-tickets"],
    [
      { kind: "ticket_proposal", tickets: Array(21).fill(ticket) },
      "invalid-tickets",
    ],
    [
      { kind: "ticket_proposal", tickets: [{ ...ticket, title: "" }] },
      "invalid-title",
    ],
    [
      { kind: "ticket_proposal", tickets: [{ ...ticket, description: "" }] },
      "invalid-description",
    ],
    [
      { kind: "ticket_proposal", tickets: [{ ...ticket, title: marker }] },
      "content contains the DISPATCH_STATUS marker",
    ],
    [
      {
        kind: "ticket_proposal",
        tickets: [{ ...ticket, description: marker }],
      },
      "content contains the DISPATCH_STATUS marker",
    ],
  ];
  const before = store.listDecisionItems(SBX).length;
  for (const [body, error] of cases) {
    const reply = await create(body);
    assert.equal(reply.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(reply.body.error, error);
  }
  assert.equal(store.listDecisionItems(SBX).length, before);
});
