import { test } from "node:test";
import assert from "node:assert/strict";
import type { AskTurn } from "../../../../shared/types.js";
import { askHistory, askReducer, type AskState } from "./ask-conversation.js";

const EMPTY: AskState = {
  turns: [],
  pending: null,
  error: null,
  pendingBoardName: false,
  generation: 0,
};

function sent(question = "what needs me?"): AskState {
  return askReducer(EMPTY, { type: "send", question });
}

test("send appends the user turn and sets pending", () => {
  assert.deepEqual(sent(), {
    turns: [{ role: "user", text: "what needs me?" }],
    pending: "what needs me?",
    error: null,
    pendingBoardName: false,
    generation: 0,
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
  assert.deepEqual(askReducer(answered, { type: "clear" }), {
    ...EMPTY,
    generation: 1,
  });
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

const USER_TURN: AskTurn = { role: "user", text: "create a board" };

test("a local turn is appended without a pending run", () => {
  const next = askReducer(EMPTY, { type: "local", turn: USER_TURN });
  assert.deepEqual(next, { ...EMPTY, turns: [USER_TURN] });
});

test("a local turn is dropped while a run is pending", () => {
  const state = sent();
  assert.equal(askReducer(state, { type: "local", turn: USER_TURN }), state);
});

test("a local turn clears the error", () => {
  const failed = askReducer(sent(), { type: "fail", error: "failed" });
  const next = askReducer(failed, { type: "local", turn: USER_TURN });
  assert.equal(next.error, null);
  assert.equal(next.turns.at(-1), USER_TURN);
});

test("a local turn from before a clear is dropped, one with no generation is kept", () => {
  const cleared = askReducer(EMPTY, { type: "clear" });
  assert.equal(
    askReducer(cleared, { type: "local", turn: USER_TURN, generation: 0 }),
    cleared,
  );
  assert.deepEqual(
    askReducer(cleared, { type: "local", turn: USER_TURN, generation: 1 })
      .turns,
    [USER_TURN],
  );
  assert.deepEqual(
    askReducer(cleared, { type: "local", turn: USER_TURN }).turns,
    [USER_TURN],
  );
});

test("an assistant turn can carry a markdown link", () => {
  const text = "Created board A with key AAA. [Open A](#/boards/AAA)";
  const next = askReducer(EMPTY, {
    type: "local",
    turn: { role: "assistant", text },
  });
  assert.equal(next.turns[0]?.text, text);
});

test("the board name flag is set once and cleared once", () => {
  const waiting = askReducer(EMPTY, { type: "await-board-name" });
  assert.equal(waiting.pendingBoardName, true);
  assert.equal(askReducer(waiting, { type: "await-board-name" }), waiting);
  assert.deepEqual(askReducer(waiting, { type: "board-name-done" }), EMPTY);
  assert.equal(askReducer(EMPTY, { type: "board-name-done" }), EMPTY);
});

test("clear and a server send drop the board name flag, an answer keeps it", () => {
  const waiting = askReducer(EMPTY, { type: "await-board-name" });
  assert.equal(askReducer(waiting, { type: "clear" }).pendingBoardName, false);
  assert.equal(
    askReducer(waiting, { type: "send", question: "hi" }).pendingBoardName,
    false,
  );
  const answered = askReducer(
    { ...waiting, pending: "x" },
    { type: "answer", answer: "a" },
  );
  assert.equal(answered.pendingBoardName, true);
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
