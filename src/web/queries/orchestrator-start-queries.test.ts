import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { BoardKey } from "../../shared/types.js";
import { startOrchestratorMutationOptions } from "./orchestrator-start-queries.js";

const realFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];
const ACME = "ACME" as BoardKey;

function reply(...responses: { status: number; body: unknown }[]): void {
  let next = 0;
  globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url:
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    const { status, body } = responses[Math.min(next++, responses.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

test("with no main record the add call runs first, then the start call", async () => {
  reply({ status: 201, body: {} }, { status: 200, body: {} });
  const result = await startOrchestratorMutationOptions(newClient()).mutationFn(
    { board: ACME, hasMainRecord: false },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "/api/boards/ACME/orchestrators");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ id: "main", name: "Main orchestrator", role: "main" }),
  );
  assert.equal(calls[1]?.url, "/api/boards/ACME/orchestrators/main/start");
  assert.equal(calls[1]?.init?.method, "POST");
  assert.equal(calls[1]?.init?.body, undefined);
});

test("a refused add sends no start call and resolves the error text", async () => {
  reply({ status: 400, body: { error: "unknown-board" } });
  const result = await startOrchestratorMutationOptions(newClient()).mutationFn(
    { board: ACME, hasMainRecord: false },
  );
  assert.deepEqual(result, {
    ok: false,
    error: "Start orchestrator failed: that board no longer exists.",
  });
  assert.equal(calls.length, 1);
});

test("a duplicate-id add refusal still sends the start call", async () => {
  reply(
    { status: 409, body: { error: "duplicate-id" } },
    { status: 200, body: {} },
  );
  const result = await startOrchestratorMutationOptions(newClient()).mutationFn(
    { board: ACME, hasMainRecord: false },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, "/api/boards/ACME/orchestrators/main/start");
});

test("with a main record only the start call runs", async () => {
  reply({ status: 200, body: {} });
  const result = await startOrchestratorMutationOptions(newClient()).mutationFn(
    { board: ACME, hasMainRecord: true },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "/api/boards/ACME/orchestrators/main/start");
});

test("a refused start resolves not ok with the error text", async () => {
  reply({ status: 409, body: { error: "orchestrator-running" } });
  const result = await startOrchestratorMutationOptions(newClient()).mutationFn(
    { board: ACME, hasMainRecord: true },
  );
  assert.deepEqual(result, {
    ok: false,
    error: "Start orchestrator failed: it is already running.",
  });
});

test("a policy-refused start shows the mapped reason", async () => {
  reply({
    status: 409,
    body: { error: "policy-refused", reason: "supervisor-off" },
  });
  const result = await startOrchestratorMutationOptions(newClient()).mutationFn(
    { board: ACME, hasMainRecord: true },
  );
  assert.deepEqual(result, {
    ok: false,
    error: "Start orchestrator failed: the supervisor is off.",
  });
});

test("a settled start invalidates the board list key", async () => {
  const client = newClient();
  const keys: unknown[] = [];
  client.invalidateQueries = (filters) => {
    keys.push(filters?.queryKey);
    return Promise.resolve();
  };
  await startOrchestratorMutationOptions(client).onSettled();
  assert.deepEqual(keys, [["boards", "list"]]);
});
