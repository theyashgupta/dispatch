import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { askQuestion } from "./ask-api.js";
import { askKeys } from "./ask-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown, statusText = ""): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(new Response(text, { status, statusText }));
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

const signal = new AbortController().signal;

test("askKeys has the documented shape", () => {
  assert.deepEqual(askKeys.all, ["ask"]);
});

test("askQuestion resolves the answer on a 200 and sends the turn", async () => {
  reply(200, { answer: "Two cards." });
  assert.deepEqual(await askQuestion("how many?", [], signal), {
    ok: true,
    answer: "Two cards.",
  });
  assert.equal(calls[0]?.url, "/api/ask");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ question: "how many?", history: [] }),
  );
  assert.equal(calls[0]?.init?.signal, signal);
});

test("askQuestion reads a 409 as busy", async () => {
  reply(409, {});
  assert.deepEqual(await askQuestion("q", [], signal), {
    ok: false,
    error: "busy",
  });
});

test("askQuestion reads a 504 as timeout", async () => {
  reply(504, {});
  assert.deepEqual(await askQuestion("q", [], signal), {
    ok: false,
    error: "timeout",
  });
});

test("askQuestion reads a 400 as invalid", async () => {
  reply(400, {});
  assert.deepEqual(await askQuestion("q", [], signal), {
    ok: false,
    error: "invalid",
  });
});

test("askQuestion reads any other status as failed", async () => {
  reply(500, {});
  assert.deepEqual(await askQuestion("q", [], signal), {
    ok: false,
    error: "failed",
  });
});

test("askQuestion rejects with the abort error when the signal aborts", async () => {
  const controller = new AbortController();
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  const pending = askQuestion("q", [], controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
