import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { askQuestion } from "./ask-api.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(status: number, body: unknown): void {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

const signal = new AbortController().signal;

test("200 returns the answer", async () => {
  respond(200, { answer: "LOCAL-921 needs you" });
  assert.deepEqual(await askQuestion("q", [], signal), {
    ok: true,
    answer: "LOCAL-921 needs you",
  });
});

for (const [status, error] of [
  [409, "busy"],
  [504, "timeout"],
  [400, "invalid"],
  [502, "failed"],
  [500, "failed"],
] as const) {
  test(`${status} maps to ${error}`, async () => {
    respond(status, { error: "x" });
    assert.deepEqual(await askQuestion("q", [], signal), { ok: false, error });
  });
}

test("the body carries the question and the history", async () => {
  let sent: unknown;
  globalThis.fetch = (_url, init) => {
    sent = JSON.parse(init?.body as string);
    return Promise.resolve(new Response(JSON.stringify({ answer: "a" })));
  };
  await askQuestion(
    "which is older?",
    [{ role: "user", text: "first" }],
    signal,
  );
  assert.deepEqual(sent, {
    question: "which is older?",
    history: [{ role: "user", text: "first" }],
  });
});

test("the request carries the caller's abort signal", async () => {
  let seen: AbortSignal | null | undefined;
  globalThis.fetch = (_url, init) => {
    seen = init?.signal;
    return Promise.resolve(new Response(JSON.stringify({ answer: "a" })));
  };
  const controller = new AbortController();
  await askQuestion("q", [], controller.signal);
  assert.equal(seen, controller.signal);
});
