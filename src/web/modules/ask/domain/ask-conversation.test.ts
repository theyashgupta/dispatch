import { test } from "node:test";
import assert from "node:assert/strict";
import type { AskTurn } from "../../../../shared/types.js";
import { askHistory, askReducer, type AskState } from "./ask-conversation.js";

const EMPTY: AskState = { turns: [], pending: null, error: null };

function sent(question = "what needs me?"): AskState {
  return askReducer(EMPTY, { type: "send", question });
}

test("send appends the user turn and sets pending", () => {
  assert.deepEqual(sent(), {
    turns: [{ role: "user", text: "what needs me?" }],
    pending: "what needs me?",
    error: null,
  });
});

test("an answer appends the assistant turn and clears pending", () => {
  const next = askReducer(sent(), { type: "answer", answer: "LOCAL-1" });
  assert.deepEqual(next.turns.at(-1), { role: "assistant", text: "LOCAL-1" });
  assert.equal(next.pending, null);
  assert.equal(next.error, null);
});

test("a failure keeps the user turn and sets the error", () => {
  const next = askReducer(sent(), { type: "fail", error: "timeout" });
  assert.deepEqual(next.turns, [{ role: "user", text: "what needs me?" }]);
  assert.equal(next.pending, null);
  assert.equal(next.error, "timeout");
});

test("a send while pending is ignored", () => {
  const state = sent();
  assert.equal(askReducer(state, { type: "send", question: "again" }), state);
});

test("clear empties the conversation", () => {
  const answered = askReducer(sent(), { type: "answer", answer: "a" });
  assert.deepEqual(askReducer(answered, { type: "clear" }), EMPTY);
});

test("cancel clears pending without removing the user turn", () => {
  const next = askReducer(sent(), { type: "cancel" });
  assert.deepEqual(next.turns, [{ role: "user", text: "what needs me?" }]);
  assert.equal(next.pending, null);
});

test("retry drops the unanswered user turn and clears the error", () => {
  const failed = askReducer(sent(), { type: "fail", error: "failed" });
  assert.deepEqual(askReducer(failed, { type: "retry" }), EMPTY);
});

test("the history for the 22nd turn carries the last 20", () => {
  const turns: AskTurn[] = Array.from({ length: 21 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    text: `turn ${i}`,
  }));
  const history = askHistory(turns);
  assert.equal(history.length, 20);
  assert.equal(history[0].text, "turn 1");
  assert.equal(history[19].text, "turn 20");
});

test("the history clips a turn longer than 8000 characters", () => {
  const history = askHistory([
    { role: "user", text: "q" },
    { role: "assistant", text: "a".repeat(9000) },
  ]);
  assert.equal(history[1].text.length, 8000);
  assert.equal(history[0].text, "q");
});

test("retry without an error changes nothing", () => {
  const answered = askReducer(sent(), { type: "answer", answer: "a" });
  assert.equal(askReducer(answered, { type: "retry" }), answered);
});
