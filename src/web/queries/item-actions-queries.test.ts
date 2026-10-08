import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_BOARD_KEY as LOCAL } from "../../shared/board-key.js";
import type { BoardKey } from "../../shared/types.js";
import {
  promoteItemMutationOptions,
  setItemStateMutationOptions,
  snoozeItemMutationOptions,
} from "./item-actions-queries.js";

const ACME = "ACME" as BoardKey;
const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

function reply(status: number, body: unknown, statusText = ""): void {
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, statusText }),
    );
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("promoteItemMutationOptions posts to the promote route and resolves the card", async () => {
  reply(200, { card: { id: "c1", identifier: "DSP-1" } });
  assert.deepEqual(
    await promoteItemMutationOptions(LOCAL).mutationFn({ itemId: "slack:1" }),
    { card: { id: "c1", identifier: "DSP-1" } },
  );
  assert.equal(calls[0]?.url, "/api/items/slack%3A1/promote");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, undefined);
});

test("promoteItemMutationOptions for ACME adds the board parameter", async () => {
  reply(200, { card: { id: "c1", identifier: "DSP-1" } });
  await promoteItemMutationOptions(ACME).mutationFn({ itemId: "slack:1" });
  assert.equal(calls[0]?.url, "/api/items/slack%3A1/promote?board=ACME");
});

test("promoteItemMutationOptions posts the context when given", async () => {
  reply(200, { card: { id: "c1", identifier: "DSP-1" } });
  await promoteItemMutationOptions(LOCAL).mutationFn({
    itemId: "sentry:1",
    context: "ctx",
  });
  assert.equal(calls[0]?.url, "/api/items/sentry%3A1/promote");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ context: "ctx" }));
});

test("promoteItemMutationOptions rejects with the server reason on a refusal", async () => {
  reply(404, { error: "unknown item" });
  await assert.rejects(
    promoteItemMutationOptions(LOCAL).mutationFn({ itemId: "x" }),
    new Error("unknown item"),
  );
});

test("setItemStateMutationOptions posts the state to the state route", async () => {
  reply(200, {});
  await setItemStateMutationOptions.mutationFn({ itemId: "i1", state: "done" });
  assert.equal(calls[0]?.url, "/api/items/i1/state");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ state: "done" }));
});

test("setItemStateMutationOptions rejects with the status when the body has no reason", async () => {
  reply(500, {});
  await assert.rejects(
    setItemStateMutationOptions.mutationFn({ itemId: "i1", state: "read" }),
    new Error("state failed: 500"),
  );
});

test("snoozeItemMutationOptions posts the wake time to the snooze route", async () => {
  reply(200, {});
  await snoozeItemMutationOptions.mutationFn({
    itemId: "i1",
    until: "2026-10-03T09:00:00.000Z",
  });
  assert.equal(calls[0]?.url, "/api/items/i1/snooze");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ until: "2026-10-03T09:00:00.000Z" }),
  );
});

test("snoozeItemMutationOptions rejects with the server reason on a refusal", async () => {
  reply(409, { error: "promoted" });
  await assert.rejects(
    snoozeItemMutationOptions.mutationFn({ itemId: "i1", until: "u" }),
    new Error("promoted"),
  );
});
