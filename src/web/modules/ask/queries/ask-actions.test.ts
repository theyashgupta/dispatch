import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import type { AskState } from "@/modules/ask/domain/ask-conversation";
import {
  askConversationQueryOptions,
  askKeys,
  runAskAction,
} from "./ask-queries.js";

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

function setup() {
  const client = new QueryClient();
  const state = () =>
    client.getQueryData<AskState>(askKeys.conversation) ?? {
      turns: [],
      pending: null,
      error: null,
    };
  const send = (question: string) =>
    runAskAction(client, { type: "send", question });
  return { client, state, send };
}

test("the conversation options start empty and never go stale", () => {
  const options = askConversationQueryOptions();
  assert.deepEqual(options.queryKey, ["ask", "conversation"]);
  assert.deepEqual(options.initialData, {
    turns: [],
    pending: null,
    error: null,
  });
  assert.equal(options.staleTime, Infinity);
});

test("a send carries the earlier turns and appends the answer", async () => {
  const { client, state, send } = setup();
  const net = deferredFetch();
  const first = send("  what needs me?  ");
  assert.equal(state().pending, "what needs me?");
  net.resolve(200, { answer: "LOCAL-921" });
  await first;
  const second = send("which is older?");
  net.resolve(200, { answer: "LOCAL-922" });
  await second;
  assert.deepEqual(net.calls[1].body, {
    question: "which is older?",
    history: [
      { role: "user", text: "what needs me?" },
      { role: "assistant", text: "LOCAL-921" },
    ],
  });
  assert.equal(state().turns.length, 4);
  await runAskAction(client, { type: "clear" });
});

test("an empty send and a send while pending make no request", async () => {
  const { state, send } = setup();
  const net = deferredFetch();
  await send("   ");
  assert.equal(net.calls.length, 0);
  const first = send("q1");
  await send("q2");
  assert.equal(net.calls.length, 1);
  net.resolve(200, { answer: "a" });
  await first;
  assert.equal(state().turns.length, 2);
});

test("a cancel aborts the request and a late reply is ignored", async () => {
  const { client, state, send } = setup();
  const net = deferredFetch();
  const run = send("slow");
  await runAskAction(client, { type: "cancel" });
  assert.equal(net.calls[0].signal?.aborted, true);
  await run;
  assert.deepEqual(state(), {
    turns: [{ role: "user", text: "slow" }],
    pending: null,
    error: null,
  });
});

test("a clear during a run empties the conversation and drops the reply", async () => {
  const { client, state, send } = setup();
  const net = deferredFetch();
  const run = send("slow");
  await runAskAction(client, { type: "clear" });
  net.resolve(200, { answer: "late" });
  await run;
  assert.deepEqual(state(), { turns: [], pending: null, error: null });
});

test("a failure keeps the question and retry resends it once", async () => {
  const { client, state, send } = setup();
  const net = deferredFetch();
  const run = send("q");
  net.resolve(409, { error: "ask-in-progress" });
  await run;
  assert.equal(state().error, "busy");
  const again = runAskAction(client, { type: "retry" });
  assert.deepEqual(state().turns, [{ role: "user", text: "q" }]);
  net.resolve(200, { answer: "ok" });
  await again;
  assert.equal(net.calls.length, 2);
  assert.deepEqual(state().turns, [
    { role: "user", text: "q" },
    { role: "assistant", text: "ok" },
  ]);
});

test("a network error becomes a failed turn", async () => {
  const { state, send } = setup();
  globalThis.fetch = () => Promise.reject(new TypeError("offline"));
  await send("q");
  assert.equal(state().error, "failed");
});
