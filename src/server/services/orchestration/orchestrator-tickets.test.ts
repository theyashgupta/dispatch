import test, { after } from "node:test";
import assert from "node:assert/strict";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import { issue } from "../../test-support/fake-source.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import {
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  ValidationError,
} from "../domain/errors.js";
import type { OutboundDeps } from "./linear-outbound.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { createDecisionItem } = await import("./decision-items.js");
const {
  commentOnTicket,
  commentOutbound,
  createOrchestratorTicket,
  moveTicket,
  updateTicket,
} = await import("./orchestrator-tickets.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const CALLER = { boardKey: SBX, orchestratorId: "orc-sbx" };
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: ["LIN"],
});
await store.applyIssues(
  [issue("lin-1", { identifier: "LIN-1" })],
  new Date().toISOString(),
  { source: "linear" },
);
const linear = store.getCard("lin-1")!;
assert.equal(linear.boardKey, SBX);
after(() => env.cleanup());

const OPTIONS = [
  { id: "approve", label: "x" },
  { id: "reject", label: "y" },
];

/** Raise a proposal and answer it with `optionId` when given. */
function proposal(
  tickets: { title: string; description: string }[],
  optionId?: string,
): string {
  const item = createDecisionItem(CALLER, {
    kind: "ticket_proposal",
    question: "q",
    options: OPTIONS,
    tickets,
  });
  if (optionId !== undefined) {
    store.answerDecisionItem(item.id, { optionId, note: null });
  }
  return item.id;
}

const own = () =>
  createOrchestratorTicket(CALLER, {
    proposalItemId: proposal([{ title: "own", description: "d" }], "approve"),
    index: 0,
  });

void test("createOrchestratorTicket stores a local ticket from the proposal entry, marked with the orchestrator", async () => {
  const proposalItemId = proposal(
    [{ title: "new", description: "what to do" }],
    "approve",
  );
  const card = await createOrchestratorTicket(CALLER, {
    proposalItemId,
    index: 0,
  });
  const stored = store.getCard(card.id)!;
  assert.equal(stored.boardKey, SBX);
  assert.equal(stored.source, "local");
  assert.equal(stored.title, "new");
  assert.equal(stored.description, "what to do");
  assert.equal(stored.createdByOrchestrator, "orc-sbx");
  assert.equal(card.createdByOrchestrator, "orc-sbx");
  assert.deepEqual(
    store.getDecisionItem(proposalItemId)?.proposal?.usedIndexes,
    [0],
  );
});

void test("createOrchestratorTicket refuses each unusable proposal with its typed error", async () => {
  const entry = [{ title: "t", description: "d" }];
  const ruling = createDecisionItem(CALLER, {
    kind: "ruling",
    question: "q",
    options: OPTIONS,
  });
  const used = proposal(entry, "approve");
  await createOrchestratorTicket(CALLER, { proposalItemId: used, index: 0 });
  const cases: [string, number, (err: unknown) => boolean][] = [
    [
      proposal(entry),
      0,
      (e) => e instanceof ConflictError && e.code === "proposal-open",
    ],
    [
      proposal(entry, "reject"),
      0,
      (e) => e instanceof ConflictError && e.code === "proposal-rejected",
    ],
    [
      "missing",
      0,
      (e) => e instanceof NotFoundError && e.code === "unknown-proposal",
    ],
    [
      ruling.id,
      0,
      (e) => e instanceof ValidationError && e.code === "not-a-proposal",
    ],
    [
      proposal(entry, "approve"),
      1,
      (e) => e instanceof ValidationError && e.code === "invalid-index",
    ],
    [
      used,
      0,
      (e) => e instanceof ConflictError && e.code === "proposal-index-used",
    ],
  ];
  const before = store.listCards(SBX).length;
  for (const [proposalItemId, index, matches] of cases) {
    await assert.rejects(
      createOrchestratorTicket(CALLER, { proposalItemId, index }),
      matches,
    );
  }
  assert.equal(store.listCards(SBX).length, before);
});

void test("createOrchestratorTicket frees the index when the ticket create fails", async () => {
  const BAD = parseBoardKey("BAD") as BoardKey;
  const id = "proposal-bad";
  store.insertDecisionItem({
    id,
    boardKey: BAD,
    cardId: null,
    orchestratorId: "orc-bad",
    kind: "ticket_proposal",
    question: "q",
    options: OPTIONS,
    recommendedOptionId: "approve",
    state: "open",
    answer: null,
    createdAt: new Date().toISOString(),
    answeredAt: null,
    proposal: { tickets: [{ title: "t", description: "d" }], usedIndexes: [] },
  });
  store.answerDecisionItem(id, { optionId: "approve", note: null });
  await assert.rejects(
    createOrchestratorTicket(
      { boardKey: BAD, orchestratorId: "orc-bad" },
      { proposalItemId: id, index: 0 },
    ),
    NotFoundError,
  );
  assert.deepEqual(store.getDecisionItem(id)?.proposal?.usedIndexes, []);
});

void test("updateTicket changes a local card and refuses a group card and a Linear card", async () => {
  const card = await own();
  const updated = await updateTicket(card, { title: "renamed" });
  assert.equal(updated.title, "renamed");
  assert.equal(store.getCard(card.id)?.description, "d");
  const a = await store.createLocalCard(SBX, "ga", "");
  const b = await store.createLocalCard(SBX, "gb", "");
  const group = await store.createGroupCard(SBX, "grp", [a.id, b.id]);
  assert.ok(group.ok);
  await assert.rejects(
    updateTicket(group.card, { title: "x" }),
    (err) => err instanceof ConflictError && err.code === "not-a-ticket",
  );
  await assert.rejects(
    updateTicket(linear, { title: "x" }),
    (err) =>
      err instanceof ConflictError &&
      err.code === "linear-card" &&
      err.details?.reason === "linear card: edit in Linear",
  );
  assert.equal(store.getCard(linear.id)?.title, linear.title);
});

void test("moveTicket moves a card by the manual rules and allows Done only for an own card", async () => {
  const card = await own();
  const parked = await moveTicket(CALLER, card, "parked");
  assert.equal(parked.column, "parked");
  const done = await moveTicket(CALLER, store.getCard(card.id)!, "done");
  assert.equal(done.column, "done");
});

void test("moveTicket refuses Done for a card of a person and for a group, and leaves the column", async () => {
  const person = await store.createLocalCard(SBX, "person", "");
  await assert.rejects(
    moveTicket(CALLER, person, "done"),
    (err) => err instanceof ForbiddenError && err.code === "done-not-own-card",
  );
  assert.equal(store.getCard(person.id)?.column, "todo");
  const a = await store.createLocalCard(SBX, "da", "");
  const b = await store.createLocalCard(SBX, "db", "");
  const group = await store.createGroupCard(SBX, "own group", [a.id, b.id]);
  assert.ok(group.ok);
  await store.setOrchestratorFields(group.card.id, {
    createdByOrchestrator: "orc-sbx",
  });
  await assert.rejects(
    moveTicket(CALLER, store.getCard(group.card.id)!, "done"),
    (err) => err instanceof ConflictError && err.code === "group-done-by-ship",
  );
  assert.equal(store.getCard(group.card.id)?.column, "todo");
});

void test("commentOnTicket appends a local entry on a local card and returns it", async () => {
  const card = await own();
  const comment = await commentOnTicket(CALLER, card, "progress note");
  assert.ok(comment);
  assert.match(comment.id, /^local-[0-9a-f-]{36}$/);
  assert.equal(comment.author, "orchestrator:orc-sbx");
  assert.deepEqual(store.getCard(card.id)?.comments, [comment]);
});

void test("commentOnTicket posts a Linear card comment through the source and maps a failure to 502", async () => {
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
    assert.equal(await commentOnTicket(CALLER, linear, "hello"), null);
    assert.deepEqual(sent, [[linear.issueId, "hello"]]);
    fail = true;
    await assert.rejects(
      commentOnTicket(CALLER, linear, "again"),
      (err) => err instanceof HttpError && err.status === 502,
    );
    assert.equal(sent.length, 1);
  } finally {
    commentOutbound.deps = undefined;
  }
});

void test("commentOnTicket maps an unknown local card to 404 and leaves no comment", async () => {
  const card = await own();
  const gone = { ...card, id: "LOCAL-9999" };
  await assert.rejects(commentOnTicket(CALLER, gone, "x"), NotFoundError);
  assert.equal(store.getCard(card.id)?.comments, undefined);
});

void test("a ticket an extra creates joins that extra's scope; a ticket the main creates changes no scope", async () => {
  const EXT = parseBoardKey("EXT") as BoardKey;
  await store.createBoard({
    key: EXT,
    name: "Extras",
    workspaceRoot: "/ext/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
  const held = await store.createLocalCard(EXT, "held", "");
  await store.setBoardOrchestrators(EXT, [
    {
      id: "main",
      name: "Main",
      role: "main",
      scope: { groupIds: [], ticketIds: [] },
      policyOverride: {},
      cardId: null,
      state: "stopped",
      createdAt: "2026-10-07T00:00:00.000Z",
    },
    {
      id: "extra-1",
      name: "Extra 1",
      role: "extra",
      scope: { groupIds: [], ticketIds: [held.id] },
      policyOverride: {},
      cardId: null,
      state: "stopped",
      createdAt: "2026-10-07T00:00:00.000Z",
    },
  ]);
  const ticketBy = async (orchestratorId: string) => {
    const caller = { boardKey: EXT, orchestratorId };
    const item = createDecisionItem(caller, {
      kind: "ticket_proposal",
      question: "q",
      options: OPTIONS,
      tickets: [{ title: "t", description: "d" }],
    });
    store.answerDecisionItem(item.id, { optionId: "approve", note: null });
    return createOrchestratorTicket(caller, {
      proposalItemId: item.id,
      index: 0,
    });
  };
  const scopeOf = (id: string) =>
    store.getBoard(EXT)!.orchestrators.find((r) => r.id === id)!.scope;
  const mine = await ticketBy("extra-1");
  assert.deepEqual(scopeOf("extra-1").ticketIds, [held.id, mine.id]);
  await ticketBy("main");
  assert.deepEqual(scopeOf("extra-1").ticketIds, [held.id, mine.id]);
  assert.deepEqual(scopeOf("main"), { groupIds: [], ticketIds: [] });
});

void test("create_ticket by an extra with a stale scope id and a stale wider override still answers the ticket and appends it", async () => {
  const STL = parseBoardKey("STL") as BoardKey;
  await store.createBoard({
    key: STL,
    name: "Stale",
    workspaceRoot: "/stl/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
  const held = await store.createLocalCard(STL, "held", "");
  const cap = store.getBoard(STL)!.policy.concurrencyCap;
  await store.setBoardOrchestrators(STL, [
    {
      id: "main",
      name: "Main",
      role: "main",
      scope: { groupIds: [], ticketIds: [] },
      policyOverride: {},
      cardId: null,
      state: "stopped",
      createdAt: "2026-10-07T00:00:00.000Z",
    },
    {
      id: "extra-1",
      name: "Extra 1",
      role: "extra",
      scope: { groupIds: ["STL-GONE"], ticketIds: [held.id] },
      policyOverride: { concurrencyCap: cap + 1 },
      cardId: null,
      state: "stopped",
      createdAt: "2026-10-07T00:00:00.000Z",
    },
  ]);
  const caller = { boardKey: STL, orchestratorId: "extra-1" };
  const item = createDecisionItem(caller, {
    kind: "ticket_proposal",
    question: "q",
    options: OPTIONS,
    tickets: [{ title: "t", description: "d" }],
  });
  store.answerDecisionItem(item.id, { optionId: "approve", note: null });
  const made = await createOrchestratorTicket(caller, {
    proposalItemId: item.id,
    index: 0,
  });
  const scope = store
    .getBoard(STL)!
    .orchestrators.find((r) => r.id === "extra-1")!.scope;
  assert.deepEqual(scope, {
    groupIds: ["STL-GONE"],
    ticketIds: [held.id, made.id],
  });
});
