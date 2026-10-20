import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const {
  ACCOUNT_DECISIONS_ORCHESTRATOR,
  closeAccountDecision,
  raiseLoginDecision,
} = await import("./account-decisions.js");
const { answerDecisionItem } = await import("./decision-items.js");
await store.load();
after(() => env.cleanup());

const ID = "11111111-1111-4111-8111-111111111111";

void test("raiseLoginDecision stores one open item on the default board with login and later options", () => {
  const decisionId = raiseLoginDecision(ID, "a@example.com");
  const item = store.getDecisionItem(decisionId);
  assert.ok(item);
  assert.equal(item.state, "open");
  assert.equal(item.boardKey, DEFAULT_BOARD_KEY);
  assert.equal(item.orchestratorId, ACCOUNT_DECISIONS_ORCHESTRATOR);
  assert.equal(item.orchestratorId, "dispatch-accounts");
  assert.equal(item.cardId, null);
  assert.ok(item.question.startsWith("Account a@example.com needs a login"));
  assert.ok(item.question.includes(`/#/accounts/${ID}`));
  assert.deepEqual(
    item.options.map((o) => o.id),
    ["login", "later"],
  );
  assert.equal(item.recommendedOptionId, "login");
  const open = store
    .listDecisionItems(DEFAULT_BOARD_KEY)
    .filter((i) => i.id === decisionId);
  assert.equal(open.length, 1);
});

void test("closeAccountDecision answers the item with the option and note", () => {
  const decisionId = raiseLoginDecision(ID, "a@example.com");
  closeAccountDecision(
    decisionId,
    "later",
    "The account returned to the chain.",
  );
  const item = store.getDecisionItem(decisionId);
  assert.equal(item?.state, "answered");
  assert.deepEqual(item?.answer, {
    optionId: "later",
    note: "The account returned to the chain.",
  });
});

void test("closeAccountDecision on an answered or unknown item does not throw and keeps the first answer", () => {
  const decisionId = raiseLoginDecision(ID, "a@example.com");
  answerDecisionItem(decisionId, { optionId: "login", note: null });
  closeAccountDecision(decisionId, "later", "again");
  assert.deepEqual(store.getDecisionItem(decisionId)?.answer, {
    optionId: "login",
    note: null,
  });
  closeAccountDecision("no-such-decision", "later", "gone");
});
