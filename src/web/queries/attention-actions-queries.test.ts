import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { DEFAULT_BOARD_KEY as LOCAL } from "../../shared/board-key.js";
import { getOpenDecisions, postAction } from "./attention-actions-api.js";
import {
  answerDecisionMutationOptions,
  attentionActionsKeys,
  loopReplyMutationOptions,
  openDecisionsQueryOptions,
  orchestrationKey,
  resumeLoopMutationOptions,
} from "./attention-actions-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];
let replies: { status: number; body: unknown }[] = [];

function stubFetch(...next: { status: number; body: unknown }[]): void {
  replies = next;
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    const reply = replies.shift() ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), { status: reply.status }),
    );
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

function body(index: number): unknown {
  return JSON.parse(calls[index]?.init?.body as string);
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
  replies = [];
});

test("the decisions key sits under the orchestration board prefix", () => {
  assert.deepEqual(orchestrationKey("LOCAL"), ["orchestration", "LOCAL"]);
  assert.deepEqual(attentionActionsKeys.decisions(LOCAL), [
    "orchestration",
    "LOCAL",
    "decisions",
  ]);
});

test("the open decisions query reads the open decisions of the board", async () => {
  const options = openDecisionsQueryOptions(LOCAL);
  assert.deepEqual(options.queryKey, ["orchestration", "LOCAL", "decisions"]);
  stubFetch({ status: 200, body: { items: [{ id: "d1" }] } });
  assert.deepEqual(await newClient().fetchQuery(options), [{ id: "d1" }]);
  assert.equal(calls[0]?.url, "/api/decisions?board=LOCAL&state=open");
});

test("getOpenDecisions throws on a failure status", async () => {
  stubFetch({ status: 500, body: {} });
  await assert.rejects(getOpenDecisions(LOCAL), /getOpenDecisions failed: 500/);
});

test("a decision answer posts the option id and the note, and refreshes the decisions", async () => {
  const client = newClient();
  client.setQueryData(attentionActionsKeys.decisions(LOCAL), []);
  stubFetch({ status: 200, body: { item: {} } });
  const result = await new MutationObserver(
    client,
    answerDecisionMutationOptions(client, LOCAL),
  ).mutate({ id: "d 1", optionId: "b", note: "use the safe path" });
  assert.deepEqual(result, { ok: true, result: null });
  assert.equal(calls[0]?.url, "/api/decisions/d%201/answer");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(body(0), { optionId: "b", note: "use the safe path" });
  assert.equal(
    client.getQueryState(attentionActionsKeys.decisions(LOCAL))?.isInvalidated,
    true,
  );
});

test("an option answer sends no note and a refused answer resolves as an error and a reason", async () => {
  const client = newClient();
  stubFetch(
    { status: 200, body: { item: {} } },
    {
      status: 403,
      body: { error: "policy-refused", reason: "supervisor-off" },
    },
  );
  const observer = () =>
    new MutationObserver(client, answerDecisionMutationOptions(client, LOCAL));
  await observer().mutate({ id: "d1", optionId: "a", note: null });
  assert.deepEqual(body(0), { optionId: "a" });
  assert.deepEqual(
    await observer().mutate({ id: "d1", optionId: "a", note: null }),
    {
      ok: false,
      error: "policy-refused",
      reason: "supervisor-off",
    },
  );
});

test("the inline reply posts the text and reads the result", async () => {
  stubFetch(
    { status: 200, body: { result: "confirmed" } },
    { status: 200, body: { result: "unconfirmed" } },
  );
  const client = newClient();
  const run = () =>
    new MutationObserver(
      client,
      loopReplyMutationOptions(client, LOCAL),
    ).mutate({
      cardId: "GROUP-1",
      text: "use main",
    });
  assert.deepEqual(await run(), { ok: true, result: "confirmed" });
  assert.equal(calls[0]?.url, "/api/sessions/GROUP-1/input");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(body(0), { text: "use main" });
  assert.deepEqual(await run(), { ok: true, result: "unconfirmed" });
});

test("the inline reply and Resume loop refresh the orchestration reads after they settle", async () => {
  const client = newClient();
  client.setQueryData(orchestrationKey(LOCAL), []);
  stubFetch({ status: 200, body: { result: "confirmed" } });
  await new MutationObserver(
    client,
    loopReplyMutationOptions(client, LOCAL),
  ).mutate({ cardId: "GROUP-1", text: "go" });
  assert.equal(
    client.getQueryState(orchestrationKey(LOCAL))?.isInvalidated,
    true,
  );
  client.setQueryData(orchestrationKey(LOCAL), []);
  stubFetch({ status: 200, body: { result: "confirmed" } });
  await new MutationObserver(
    client,
    resumeLoopMutationOptions(client, LOCAL),
  ).mutate("GROUP-1");
  assert.equal(
    client.getQueryState(orchestrationKey(LOCAL))?.isInvalidated,
    true,
  );
});

test("Resume loop posts to the user route without a body and reads the result", async () => {
  stubFetch({ status: 200, body: { result: "confirmed" } });
  const result = await new MutationObserver(
    newClient(),
    resumeLoopMutationOptions(newClient(), LOCAL),
  ).mutate("GROUP-4");
  assert.deepEqual(result, { ok: true, result: "confirmed" });
  assert.equal(calls[0]?.url, "/api/sessions/GROUP-4/resume-loop");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
});

test("a refusal without a body reads the status text, and a network failure resolves as an error", async () => {
  stubFetch({ status: 502, body: null });
  assert.deepEqual(await postAction("/api/x"), {
    ok: false,
    error: "502",
    reason: null,
  });
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  assert.deepEqual(await postAction("/api/x"), {
    ok: false,
    error: "offline",
    reason: null,
  });
});
