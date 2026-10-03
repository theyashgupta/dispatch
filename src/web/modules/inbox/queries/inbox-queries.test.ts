import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Card } from "../../../../shared/types.js";
import {
  promoteItem,
  setItemState,
  snoozeItem,
} from "@/queries/item-actions-api";
import { inboxKeys } from "./inbox-queries.js";

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
    return Promise.resolve(
      new Response(status === 204 ? null : text, { status, statusText }),
    );
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("inboxKeys has the documented shape", () => {
  assert.deepEqual(inboxKeys.all, ["inbox"]);
});

test("setItemState posts the state to the encoded item route", async () => {
  reply(200, {});
  await setItemState("a/b", "done");
  assert.equal(calls[0]?.url, "/api/items/a%2Fb/state");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ state: "done" }));
});

test("setItemState rejects with the server reason on a refusal", async () => {
  reply(409, { error: "promoted" }, "Conflict");
  await assert.rejects(setItemState("i1", "done"), new Error("promoted"));
});

test("snoozeItem posts the until time to the snooze route", async () => {
  reply(200, {});
  await snoozeItem("i1", "2026-10-01T09:00:00.000Z");
  assert.equal(calls[0]?.url, "/api/items/i1/snooze");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ until: "2026-10-01T09:00:00.000Z" }),
  );
});

test("snoozeItem rejects with a status message when the body has no error", async () => {
  reply(500, {}, "Internal Server Error");
  await assert.rejects(
    snoozeItem("i1", "2026-10-01T09:00:00.000Z"),
    new Error("snooze failed: 500"),
  );
});

test("promoteItem sends the context and resolves the card", async () => {
  const card = { id: "c1" } as Card;
  reply(200, { card });
  assert.deepEqual(await promoteItem("i1", "ctx"), { card });
  assert.equal(calls[0]?.url, "/api/items/i1/promote");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify({ context: "ctx" }));
});

test("promoteItem sends no body when there is no context", async () => {
  reply(200, { card: { id: "c1" } });
  await promoteItem("i1");
  assert.equal(calls[0]?.init?.body, undefined);
});
