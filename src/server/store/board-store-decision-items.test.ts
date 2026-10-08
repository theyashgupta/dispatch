import test from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type { BoardKey, DecisionItem } from "../../shared/types.js";

isolateEnv();
const { store } = await import("./board.store.js");
await store.load();

const ACME = parseBoardKey("ACME") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;

function item(
  id: string,
  boardKey: BoardKey,
  extra: Partial<DecisionItem> = {},
): DecisionItem {
  return {
    id,
    boardKey,
    cardId: "card-1",
    orchestratorId: "orc-a",
    kind: "roadmap_approval",
    question: "Approve the plan?",
    options: [
      { id: "approve", label: "Approve" },
      { id: "reject", label: "Reject" },
    ],
    recommendedOptionId: "approve",
    state: "open",
    answer: null,
    createdAt: "2026-10-07T00:00:00.000Z",
    answeredAt: null,
    ...extra,
  };
}

store.insertDecisionItem(item("dec-1", ACME));
store.insertDecisionItem(item("dec-2", ACME, { kind: "ruling", cardId: null }));
store.insertDecisionItem(item("dec-3", OTH));

void test("an inserted item reads back whole by id", () => {
  assert.deepEqual(store.getDecisionItem("dec-2"), {
    ...item("dec-2", ACME, { kind: "ruling", cardId: null }),
  });
  assert.equal(store.getDecisionItem("dec-404"), undefined);
});

void test("a duplicate id is refused", () => {
  assert.throws(() => store.insertDecisionItem(item("dec-1", ACME)));
});

void test("the list is per board, oldest first, and filters by state", () => {
  assert.deepEqual(
    store.listDecisionItems(ACME).map((i) => i.id),
    ["dec-1", "dec-2"],
  );
  assert.deepEqual(
    store.listDecisionItems(OTH).map((i) => i.id),
    ["dec-3"],
  );
  assert.deepEqual(store.listDecisionItems(ACME, "answered"), []);
});

void test("an open item is answered once, and a second answer changes nothing", () => {
  const returned = store.answerDecisionItem("dec-1", {
    optionId: "approve",
    note: "ok",
  });
  const answered = store.getDecisionItem("dec-1")!;
  assert.deepEqual(returned, answered);
  assert.equal(answered.state, "answered");
  assert.deepEqual(answered.answer, { optionId: "approve", note: "ok" });
  assert.ok(answered.answeredAt !== null);
  assert.equal(
    store.answerDecisionItem("dec-1", { optionId: "reject", note: null }),
    null,
  );
  assert.deepEqual(store.getDecisionItem("dec-1"), answered);
  assert.equal(
    store.answerDecisionItem("dec-404", { optionId: "approve", note: null }),
    null,
  );
  assert.deepEqual(
    store.listDecisionItems(ACME, "answered").map((i) => i.id),
    ["dec-1"],
  );
  assert.deepEqual(
    store.listDecisionItems(ACME, "open").map((i) => i.id),
    ["dec-2"],
  );
});

void test("items survive a store reload from disk", async () => {
  const before = store.listDecisionItems(ACME);
  await store.load();
  assert.deepEqual(store.listDecisionItems(ACME), before);
  assert.equal(store.getDecisionItem("dec-1")?.state, "answered");
});

void test("an answered item is used once, and an open or unknown item is never used", () => {
  assert.equal(store.consumeDecisionItem("dec-2"), false);
  assert.equal(store.consumeDecisionItem("dec-404"), false);
  assert.equal(store.consumeDecisionItem("dec-1"), true);
  const used = store.getDecisionItem("dec-1")!;
  assert.ok(used.consumedAt);
  assert.equal(used.state, "answered");
  assert.equal(store.consumeDecisionItem("dec-1"), false);
  assert.equal(store.getDecisionItem("dec-1")?.consumedAt, used.consumedAt);
});
