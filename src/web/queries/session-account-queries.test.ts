import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { moveSessionAccount } from "./session-account-api.js";
import { moveSessionAccountMutationOptions } from "./session-account-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("a 200 moved resolves the outcome and posts the account and session", async () => {
  reply(200, { outcome: "moved" });
  assert.deepEqual(await moveSessionAccount("c/1", "acc", "s1"), {
    ok: true,
    outcome: "moved",
  });
  assert.equal(calls[0]?.url, "/api/cards/c%2F1/session/account");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ accountId: "acc", sessionId: "s1" }),
  );
});

test("a 200 same resolves the same outcome and omits an absent session id", async () => {
  reply(200, { outcome: "same" });
  assert.deepEqual(await moveSessionAccount("c", "acc"), {
    ok: true,
    outcome: "same",
  });
  assert.equal(calls[0]?.init?.body, JSON.stringify({ accountId: "acc" }));
});

test("a 202 resolves queued", async () => {
  reply(202, { outcome: "queued" });
  assert.deepEqual(await moveSessionAccount("c", "acc"), {
    ok: true,
    outcome: "queued",
  });
});

test("a 404 resolves the not-found message and does not throw", async () => {
  reply(404, { error: "not-found" });
  assert.deepEqual(await moveSessionAccount("c", "acc"), {
    ok: false,
    error: "not-found",
    message: "That card or account no longer exists.",
  });
});

test("each 409 code resolves its own message and does not throw", async () => {
  const expected: Record<string, string> = {
    "no-session": "This card has no live session to move.",
    legacy: "This session predates account tracking and cannot move.",
    "limit-unknown":
      "Dispatch found no safe way to leave the usage limit screen. Try again after the limit clears.",
  };
  for (const [code, message] of Object.entries(expected)) {
    reply(409, { error: code });
    assert.deepEqual(await moveSessionAccount("c", "acc"), {
      ok: false,
      error: code,
      message,
    });
  }
});

test("any other status resolves a generic failure", async () => {
  reply(500, {});
  assert.deepEqual(await moveSessionAccount("c", "acc"), {
    ok: false,
    error: "failed",
    message: "Couldn't move the session.",
  });
});

test("a settled move marks the accounts list stale, accepted or refused", async () => {
  for (const [status, body] of [
    [200, { outcome: "moved" }],
    [409, { error: "legacy" }],
  ] as const) {
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity } },
    });
    client.setQueryData(["accounts", "list"], { activeId: "a", accounts: [] });
    reply(status, body);
    await new MutationObserver(
      client,
      moveSessionAccountMutationOptions(client),
    ).mutate({ cardId: "c", accountId: "acc" });
    assert.equal(
      client.getQueryState(["accounts", "list"])?.isInvalidated,
      true,
    );
  }
});
