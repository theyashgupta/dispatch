import { test } from "node:test";
import assert from "node:assert/strict";
import type { AskTurn } from "../../shared/types.js";
import { askHistory, askReducer, askStore, type AskState } from "./useAsk.js";

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

function deferredFetch(): {
  resolve: (status: number, body: unknown) => void;
  calls: { body: unknown; signal: AbortSignal | null | undefined }[];
} {
  const calls: { body: unknown; signal: AbortSignal | null | undefined }[] = [];
  const pending: ((r: Response) => void)[] = [];
  globalThis.fetch = (_url, init) => {
    calls.push({
      body: JSON.parse(init?.body as string),
      signal: init?.signal,
    });
    return new Promise((resolve, reject) => {
      pending.push(resolve);
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  };
  return {
    calls,
    resolve: (status, body) =>
      pending.shift()?.(new Response(JSON.stringify(body), { status })),
  };
}

test("the store sends, carries the earlier turns and appends the answer", async () => {
  askStore.clear();
  const net = deferredFetch();
  const first = askStore.send("  what needs me?  ");
  assert.equal(askStore.getState().pending, "what needs me?");
  net.resolve(200, { answer: "LOCAL-921" });
  await first;
  const second = askStore.send("which is older?");
  net.resolve(200, { answer: "LOCAL-922" });
  await second;
  assert.deepEqual(net.calls[1].body, {
    question: "which is older?",
    history: [
      { role: "user", text: "what needs me?" },
      { role: "assistant", text: "LOCAL-921" },
    ],
  });
  assert.equal(askStore.getState().turns.length, 4);
  askStore.clear();
});

test("the store ignores an empty send and a send while pending", async () => {
  askStore.clear();
  const net = deferredFetch();
  await askStore.send("   ");
  assert.equal(net.calls.length, 0);
  const first = askStore.send("q1");
  await askStore.send("q2");
  assert.equal(net.calls.length, 1);
  net.resolve(200, { answer: "a" });
  await first;
  askStore.clear();
});

test("a cancel aborts the request and a late reply is ignored", async () => {
  askStore.clear();
  const net = deferredFetch();
  const run = askStore.send("slow");
  askStore.cancel();
  assert.equal(net.calls[0].signal?.aborted, true);
  await run;
  assert.deepEqual(askStore.getState(), {
    turns: [{ role: "user", text: "slow" }],
    pending: null,
    error: null,
  });
  askStore.clear();
});

test("clear during a run empties the conversation and drops the reply", async () => {
  askStore.clear();
  const net = deferredFetch();
  const run = askStore.send("slow");
  askStore.clear();
  net.resolve(200, { answer: "late" });
  await run;
  assert.deepEqual(askStore.getState(), {
    turns: [],
    pending: null,
    error: null,
  });
});

test("a failure keeps the question and retry resends it once", async () => {
  askStore.clear();
  const net = deferredFetch();
  const run = askStore.send("q");
  net.resolve(409, { error: "ask-in-progress" });
  await run;
  assert.equal(askStore.getState().error, "busy");
  const again = askStore.retry();
  assert.deepEqual(askStore.getState().turns, [{ role: "user", text: "q" }]);
  net.resolve(200, { answer: "ok" });
  await again;
  assert.equal(net.calls.length, 2);
  assert.deepEqual(askStore.getState().turns, [
    { role: "user", text: "q" },
    { role: "assistant", text: "ok" },
  ]);
  askStore.clear();
});

test("a network error becomes a failed turn", async () => {
  askStore.clear();
  globalThis.fetch = () => Promise.reject(new TypeError("offline"));
  await askStore.send("q");
  assert.equal(askStore.getState().error, "failed");
  askStore.clear();
});
