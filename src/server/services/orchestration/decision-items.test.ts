import test, { after } from "node:test";
import assert from "node:assert/strict";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { answerDecisionItem, createDecisionItem } =
  await import("./decision-items.js");
const { createOrchestratorTicket } = await import("./orchestrator-tickets.js");
const listDecisionItems = store.listDecisionItems.bind(store);

const SBX = parseBoardKey("SBX") as BoardKey;
const CALLER = { boardKey: SBX, orchestratorId: "orc-sbx" };
const OPTIONS = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});
const memberA = await store.createLocalCard(SBX, "member a", "");
const memberB = await store.createLocalCard(SBX, "member b", "");
const minted = await store.createGroupCard(SBX, "infra group", [
  memberA.id,
  memberB.id,
]);
if (!minted.ok) throw new Error("group not created");
const loose = await store.createLocalCard(SBX, "loose ticket", "");
const record = (
  id: string,
  role: "main" | "extra",
  groupIds: string[] = [],
) => ({
  id,
  name: id,
  role,
  scope: { groupIds, ticketIds: [] },
  policyOverride: {},
  cardId: null,
  state: "stopped" as const,
  createdAt: "2026-10-07T00:00:00.000Z",
});
await store.setBoardOrchestrators(SBX, [
  record("main", "main"),
  record("infra", "extra", [minted.card.id]),
]);
after(() => env.cleanup());

const eventKinds = () =>
  store.listOrchestrationEvents(SBX, 0, 1000).map((e) => e.kind);

void test("createDecisionItem stores an open item and records decision_raised", () => {
  const item = createDecisionItem(CALLER, {
    kind: "ruling",
    question: "Which way?",
    options: OPTIONS,
    recommendedOptionId: "yes",
  });
  assert.equal(item.state, "open");
  assert.equal(item.orchestratorId, "orc-sbx");
  assert.equal(item.recommendedOptionId, "yes");
  assert.deepEqual(store.getDecisionItem(item.id), item);
  const event = store
    .listOrchestrationEvents(SBX, 0, 1000)
    .find((e) => e.kind === "decision_raised");
  assert.equal(event?.data.decisionId, item.id);
});

void test("createDecisionItem gives a roadmap_approval item the server options", () => {
  const item = createDecisionItem(CALLER, {
    kind: "roadmap_approval",
    question: "Approve?",
    options: OPTIONS,
  });
  assert.deepEqual(
    item.options.map((o) => o.id),
    ["approve", "reject"],
  );
  assert.equal(item.recommendedOptionId, "approve");
});

void test("createDecisionItem refuses a recommended option that is not an option and stores nothing", () => {
  const before = listDecisionItems(SBX).length;
  const eventsBefore = eventKinds().length;
  assert.throws(
    () =>
      createDecisionItem(CALLER, {
        kind: "other",
        question: "q",
        options: OPTIONS,
        recommendedOptionId: "maybe",
      }),
    (err) =>
      err instanceof ValidationError &&
      err.code === "invalid-recommended-option",
  );
  assert.equal(listDecisionItems(SBX).length, before);
  assert.equal(eventKinds().length, eventsBefore);
});

void test("listDecisionItems filters by state", () => {
  const open = createDecisionItem(CALLER, {
    kind: "other",
    question: "to answer",
    options: OPTIONS,
  });
  answerDecisionItem(open.id, { optionId: "no", note: null });
  assert.ok(listDecisionItems(SBX, "answered").some((i) => i.id === open.id));
  assert.ok(!listDecisionItems(SBX, "open").some((i) => i.id === open.id));
});

void test("answerDecisionItem answers once and records decision_answered", () => {
  const item = createDecisionItem(CALLER, {
    kind: "ruling",
    question: "q",
    options: OPTIONS,
  });
  const answered = answerDecisionItem(item.id, {
    optionId: "yes",
    note: "go",
  });
  assert.equal(answered.state, "answered");
  assert.deepEqual(answered.answer, { optionId: "yes", note: "go" });
  const event = store
    .listOrchestrationEvents(SBX, 0, 1000)
    .find(
      (e) => e.kind === "decision_answered" && e.data.decisionId === item.id,
    );
  assert.equal(event?.data.optionId, "yes");
  assert.throws(
    () => answerDecisionItem(item.id, { optionId: "no", note: null }),
    (err) => err instanceof ConflictError && err.code === "already-answered",
  );
});

void test("answerDecisionItem refuses an unknown item and an unknown option", () => {
  assert.throws(
    () => answerDecisionItem("missing", { optionId: "yes", note: null }),
    (err) => err instanceof NotFoundError && err.code === "unknown-decision",
  );
  const item = createDecisionItem(CALLER, {
    kind: "ruling",
    question: "q",
    options: OPTIONS,
  });
  assert.throws(
    () => answerDecisionItem(item.id, { optionId: "other", note: null }),
    (err) => err instanceof ValidationError && err.code === "invalid-option",
  );
  assert.equal(store.getDecisionItem(item.id)?.state, "open");
});

void test("a decision item for a card belongs to the owner of the card, and the events name that owner", () => {
  const MAIN = { boardKey: SBX, orchestratorId: "main" };
  const grouped = createDecisionItem(MAIN, {
    cardId: minted.card.id,
    kind: "ruling",
    question: "q",
    options: OPTIONS,
  });
  assert.equal(grouped.orchestratorId, "infra");
  const unowned = createDecisionItem(MAIN, {
    cardId: loose.id,
    kind: "ruling",
    question: "q",
    options: OPTIONS,
  });
  assert.equal(unowned.orchestratorId, "main");
  const noCard = createDecisionItem(CALLER, {
    kind: "ruling",
    question: "q",
    options: OPTIONS,
  });
  assert.equal(noCard.orchestratorId, "orc-sbx");
  answerDecisionItem(grouped.id, { optionId: "yes", note: null });
  const events = store.listOrchestrationEvents(SBX, 0, 1000);
  for (const kind of ["decision_raised", "decision_answered"]) {
    const event = events.find(
      (e) => e.kind === kind && e.data.decisionId === grouped.id,
    );
    assert.equal(event?.data.orchestratorId, "infra", kind);
  }
});

void test("a ticket_proposal item gets the server options, a recommended approve and an unused proposal", () => {
  const tickets = [{ title: "t", description: "d" }];
  const item = createDecisionItem(CALLER, {
    kind: "ticket_proposal",
    question: "q",
    options: [
      { id: "x", label: "X" },
      { id: "y", label: "Y" },
    ],
    recommendedOptionId: "x",
    tickets,
  });
  assert.deepEqual(item.options, [
    { id: "approve", label: "Create these tickets" },
    { id: "reject", label: "Do not create" },
  ]);
  assert.equal(item.recommendedOptionId, "approve");
  assert.deepEqual(item.proposal, { tickets, usedIndexes: [] });
  assert.deepEqual(store.getDecisionItem(item.id), item);
});

void test("createDecisionItem refuses tickets on another kind and a proposal with no tickets, and stores nothing", () => {
  const before = listDecisionItems(SBX).length;
  const tickets = [{ title: "t", description: "d" }];
  for (const input of [
    { kind: "ruling" as const, tickets },
    { kind: "ticket_proposal" as const },
  ]) {
    assert.throws(
      () =>
        createDecisionItem(CALLER, {
          ...input,
          question: "q",
          options: OPTIONS,
        }),
      (err) => err instanceof ValidationError && err.code === "invalid-tickets",
    );
  }
  assert.equal(listDecisionItems(SBX).length, before);
});

void test("a plan item keeps its entries and gets the server options with approve recommended", () => {
  const plan = {
    entries: [
      {
        ref: "CEN-1",
        playbook: "Write code directly",
        order: 1,
        size: "small" as const,
      },
    ],
  };
  const item = createDecisionItem(CALLER, {
    kind: "plan",
    question: "One ticket.",
    options: OPTIONS,
    recommendedOptionId: "a",
    plan,
  });
  assert.deepEqual(item.options, [
    { id: "approve", label: "Approve the plan" },
    { id: "reject", label: "Do not approve" },
  ]);
  assert.equal(item.recommendedOptionId, "approve");
  assert.deepEqual(item.plan, plan);
  assert.deepEqual(store.getDecisionItem(item.id), item);
});

void test("createDecisionItem refuses a plan on another kind and a plan item with no plan, and stores nothing", () => {
  const before = listDecisionItems(SBX).length;
  const plan = {
    entries: [
      { ref: "CEN-1", playbook: "p", order: 1, size: "small" as const },
    ],
  };
  for (const input of [
    { kind: "ruling" as const, plan },
    { kind: "plan" as const },
  ]) {
    assert.throws(
      () =>
        createDecisionItem(CALLER, {
          ...input,
          question: "q",
          options: OPTIONS,
        }),
      (err) => err instanceof ValidationError && err.code === "invalid-plan",
    );
  }
  assert.equal(listDecisionItems(SBX).length, before);
});

const PLAN = {
  entries: [{ ref: "CEN-1", playbook: "p", order: 1, size: "small" as const }],
};
const TICKETS = [{ title: "t", description: "d" }];
const AUTO_KINDS = [
  { kind: "ticket_proposal" as const, tickets: TICKETS },
  { kind: "plan" as const, plan: PLAN },
];
const INFRA = record("infra", "extra", [minted.card.id]);

async function withMode(
  mode: "ask" | "rules" | "all",
  run: () => Promise<void> | void,
): Promise<void> {
  await store.setBoardPolicy(SBX, {
    ...store.getBoard(SBX)!.policy,
    roadmapApproval: mode,
  });
  try {
    await run();
  } finally {
    await store.setBoardPolicy(SBX, {
      ...store.getBoard(SBX)!.policy,
      roadmapApproval: "ask",
    });
  }
}

const eventsFor = (id: string, kind: string) =>
  store
    .listOrchestrationEvents(SBX, 0, 1000)
    .filter((e) => e.kind === kind && e.data.decisionId === id);

void test("under roadmapApproval all or rules a ticket_proposal or plan item is stored answered with approve and records decision_answered", async () => {
  for (const mode of ["all", "rules"] as const) {
    await withMode(mode, () => {
      for (const extra of AUTO_KINDS) {
        const item = createDecisionItem(CALLER, {
          ...extra,
          question: "q",
          options: OPTIONS,
        });
        const label = `${mode} ${extra.kind}`;
        assert.equal(item.state, "answered", label);
        assert.equal(item.answer?.optionId, "approve", label);
        assert.ok(item.answer?.note?.includes(mode), label);
        assert.equal(item.answeredAt, item.createdAt, label);
        assert.deepEqual(store.getDecisionItem(item.id), item, label);
        const answered = eventsFor(item.id, "decision_answered");
        assert.equal(answered.length, 1, label);
        assert.equal(answered[0]?.data.orchestratorId, "orc-sbx", label);
        assert.equal(answered[0]?.data.optionId, "approve", label);
        assert.equal(eventsFor(item.id, "decision_raised").length, 0, label);
      }
    });
  }
});

void test("under roadmapApproval ask a ticket_proposal or plan item stays open and records decision_raised", async () => {
  await withMode("ask", () => {
    for (const extra of AUTO_KINDS) {
      const item = createDecisionItem(CALLER, {
        ...extra,
        question: "q",
        options: OPTIONS,
      });
      assert.equal(item.state, "open", extra.kind);
      assert.equal(item.answer, null, extra.kind);
      assert.equal(item.answeredAt, null, extra.kind);
      assert.equal(eventsFor(item.id, "decision_raised").length, 1);
      assert.equal(eventsFor(item.id, "decision_answered").length, 0);
    }
  });
});

void test("under roadmapApproval all a ruling or ship_failure item stays open", async () => {
  await withMode("all", () => {
    for (const kind of ["ruling", "ship_failure"] as const) {
      const item = createDecisionItem(CALLER, {
        kind,
        question: "q",
        options: OPTIONS,
      });
      assert.equal(item.state, "open", kind);
      assert.equal(eventsFor(item.id, "decision_raised").length, 1, kind);
      assert.equal(eventsFor(item.id, "decision_answered").length, 0, kind);
    }
  });
});

void test("a policy override of ask on the owner record keeps the item open under board all", async () => {
  await store.setBoardOrchestrators(SBX, [
    record("main", "main"),
    { ...INFRA, policyOverride: { roadmapApproval: "ask" as const } },
  ]);
  try {
    await withMode("all", () => {
      const overridden = createDecisionItem(
        { boardKey: SBX, orchestratorId: "main" },
        {
          cardId: memberA.id,
          kind: "plan",
          question: "q",
          options: OPTIONS,
          plan: PLAN,
        },
      );
      assert.equal(overridden.orchestratorId, "infra");
      assert.equal(overridden.state, "open");
      const plain = createDecisionItem(CALLER, {
        kind: "plan",
        question: "q",
        options: OPTIONS,
        plan: PLAN,
      });
      assert.equal(plain.state, "answered");
    });
  } finally {
    await store.setBoardOrchestrators(SBX, [
      record("main", "main"),
      record("infra", "extra", [minted.card.id]),
    ]);
  }
});

void test("create_ticket works at once on an auto-approved proposal and is refused with proposal-open under ask", async () => {
  const MAIN = { boardKey: SBX, orchestratorId: "main" };
  await withMode("all", async () => {
    const item = createDecisionItem(MAIN, {
      kind: "ticket_proposal",
      question: "q",
      options: OPTIONS,
      tickets: TICKETS,
    });
    const card = await createOrchestratorTicket(MAIN, {
      proposalItemId: item.id,
      index: 0,
    });
    assert.equal(card.title, "t");
  });
  await withMode("ask", async () => {
    const item = createDecisionItem(MAIN, {
      kind: "ticket_proposal",
      question: "q",
      options: OPTIONS,
      tickets: TICKETS,
    });
    await assert.rejects(
      createOrchestratorTicket(MAIN, { proposalItemId: item.id, index: 0 }),
      (err) => err instanceof ConflictError && err.code === "proposal-open",
    );
  });
});
