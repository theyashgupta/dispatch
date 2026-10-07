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
