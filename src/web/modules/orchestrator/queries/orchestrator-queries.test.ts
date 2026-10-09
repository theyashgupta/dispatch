import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { DEFAULT_BOARD_KEY as LOCAL } from "../../../../shared/board-key.js";
import type { Board, BoardPolicy } from "../../../../shared/types.js";
import { openDecisionsQueryOptions } from "@/queries/attention-actions-queries";
import { boardListKeys } from "@/queries/board-list-queries";
import {
  addExtraMutationOptions,
  boardRecordQueryOptions,
  lifecycleMutationOptions,
  moveGroupsMutationOptions,
  panelDecisionsQueryOptions,
  saveOverridesMutationOptions,
  savePolicyMutationOptions,
  orchestratorKeys,
  orchestratorPanelQueryOptions,
  PANEL_POLL_MS,
} from "./orchestrator-queries.js";
import { ensureOrchestratorTerminal } from "./orchestrator-api.js";

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

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
  replies = [];
});

function runLifecycle(
  client: QueryClient,
  vars: { kind: "start" | "stop" | "resume"; id: string; hasRecord: boolean },
) {
  return new MutationObserver(
    client,
    lifecycleMutationOptions(client, LOCAL),
  ).mutate(vars);
}

test("Start on a board with no record adds the main orchestrator, then starts it", async () => {
  stubFetch(
    { status: 201, body: { orchestrator: {} } },
    { status: 202, body: { orchestrator: {} } },
  );
  const result = await runLifecycle(newClient(), {
    kind: "start",
    id: "main",
    hasRecord: false,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.url, "/api/boards/LOCAL/orchestrators");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ id: "main", name: "Main orchestrator", role: "main" }),
  );
  assert.equal(calls[1]?.url, "/api/boards/LOCAL/orchestrators/main/start");
  assert.equal(calls[1]?.init?.method, "POST");
});

test("Start on a board with a record only starts it", async () => {
  stubFetch({ status: 202, body: {} });
  await runLifecycle(newClient(), {
    kind: "start",
    id: "main",
    hasRecord: true,
  });
  assert.deepEqual(
    calls.map((c) => c.url),
    ["/api/boards/LOCAL/orchestrators/main/start"],
  );
});

test("a refused add stops Start before the start call", async () => {
  stubFetch({ status: 409, body: { error: "main-exists" } });
  const result = await runLifecycle(newClient(), {
    kind: "start",
    id: "main",
    hasRecord: false,
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "this board already has a main orchestrator",
  });
  assert.equal(calls.length, 1);
});

for (const kind of ["stop", "resume"] as const) {
  test(`${kind} posts to its route`, async () => {
    stubFetch({ status: 202, body: {} });
    const result = await runLifecycle(newClient(), {
      kind,
      id: "main",
      hasRecord: true,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0]?.url, `/api/boards/LOCAL/orchestrators/main/${kind}`);
    assert.equal(calls[0]?.init?.method, "POST");
  });
}

test("a supervisor-off refusal resolves as a reason, not a throw", async () => {
  stubFetch({
    status: 403,
    body: { error: "policy-refused", reason: "supervisor-off" },
  });
  const result = await runLifecycle(newClient(), {
    kind: "start",
    id: "main",
    hasRecord: true,
  });
  assert.deepEqual(result, { ok: false, reason: "the supervisor is off" });
});

test("a network failure resolves as a refusal", async () => {
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  const result = await runLifecycle(newClient(), {
    kind: "stop",
    id: "main",
    hasRecord: true,
  });
  assert.deepEqual(result, { ok: false, reason: "offline" });
});

test("every lifecycle outcome refreshes the panel and the board list", async () => {
  const client = newClient();
  client.setQueryData(orchestratorKeys.panel(LOCAL), []);
  client.setQueryData(boardListKeys.list, { boards: [] });
  stubFetch({ status: 202, body: {} });
  await runLifecycle(client, { kind: "stop", id: "main", hasRecord: true });
  assert.equal(
    client.getQueryState(orchestratorKeys.panel(LOCAL))?.isInvalidated,
    true,
  );
  assert.equal(client.getQueryState(boardListKeys.list)?.isInvalidated, true);
});

test("the ensure terminal call posts to the card route", async () => {
  stubFetch({ status: 202, body: {} });
  assert.deepEqual(await ensureOrchestratorTerminal("card 1"), { ok: true });
  assert.equal(calls[0]?.url, "/api/cards/card%201/terminal");
  assert.equal(calls[0]?.init?.method, "POST");
});

test("the panel query reads the list route and polls only while open", async () => {
  const open = orchestratorPanelQueryOptions(LOCAL, true);
  const closed = orchestratorPanelQueryOptions(LOCAL, false);
  assert.equal(open.refetchInterval, PANEL_POLL_MS);
  assert.equal(closed.refetchInterval, false);
  stubFetch({ status: 200, body: { orchestrators: [{ id: "main" }] } });
  const data = await newClient().fetchQuery(open);
  assert.deepEqual(data, [{ id: "main" }]);
  assert.equal(calls[0]?.url, "/api/boards/LOCAL/orchestrators");
});

test("request parity: a closed panel makes no request", async () => {
  stubFetch({ status: 200, body: { orchestrators: [] } });
  const client = newClient();
  const observer = new QueryObserver(
    client,
    orchestratorPanelQueryOptions(LOCAL, false),
  );
  const unsubscribe = observer.subscribe(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  unsubscribe();
  assert.equal(calls.length, 0);
});

test("request parity: the entry decision reads the cached board list and fetches nothing", async () => {
  stubFetch({ status: 200, body: { boards: [], knownLinearTeamKeys: [] } });
  const client = newClient();
  const board = { key: LOCAL, orchestrators: [] } as unknown as Board;
  client.setQueryData(boardListKeys.list, {
    boards: [board],
    knownLinearTeamKeys: [],
  });
  const observer = new QueryObserver(client, {
    ...boardRecordQueryOptions(LOCAL),
    staleTime: 0,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(observer.getCurrentResult().data, board);
  unsubscribe();
  assert.equal(calls.length, 0);
});

test("the entry decision is null for a board missing from the list", () => {
  const client = newClient();
  client.setQueryData(boardListKeys.list, { boards: [] });
  const observer = new QueryObserver(client, boardRecordQueryOptions(LOCAL));
  assert.equal(observer.getCurrentResult().data, null);
});

const policy: BoardPolicy = {
  roadmapApproval: "ask",
  concurrencyCap: 3,
  loopModel: null,
  orchestratorModel: "claude-opus-5-5",
  handoffPercent: 50,
  handoffHardPercent: 80,
  usageLimit: "wait",
  shipRights: "none",
  budgetPerGroup: null,
  supervisor: "on",
  groupPlaybook: null,
  wakeMinutes: 15,
};

function body(index: number): unknown {
  return JSON.parse(calls[index]?.init?.body as string);
}

test("the panel decisions query polls on the shared decisions key", async () => {
  const options = panelDecisionsQueryOptions(LOCAL);
  assert.deepEqual(options.queryKey, openDecisionsQueryOptions(LOCAL).queryKey);
  assert.equal(options.refetchInterval, PANEL_POLL_MS);
  assert.equal(options.staleTime, 0);
  stubFetch({ status: 200, body: { items: [{ id: "d1" }] } });
  const data = await newClient().fetchQuery(options);
  assert.deepEqual(data, [{ id: "d1" }]);
  assert.equal(calls[0]?.url, "/api/decisions?board=LOCAL&state=open");
});

test("Save policy puts the twelve fields and no credits value, then updates the board list", async () => {
  const client = newClient();
  const stored = { key: LOCAL, policy: { ...policy, concurrencyCap: 4 } };
  client.setQueryData(boardListKeys.list, {
    boards: [{ key: LOCAL, policy }],
    knownLinearTeamKeys: [],
  });
  stubFetch({ status: 200, body: { board: stored } });
  const result = await new MutationObserver(
    client,
    savePolicyMutationOptions(client, LOCAL),
  ).mutate({ ...policy, concurrencyCap: 4 });
  assert.equal(result.ok, true);
  assert.equal(calls[0]?.url, "/api/boards/LOCAL/policy");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.equal(Object.keys(body(0) as object).length, 12);
  assert.equal(/credit/i.test(calls[0]?.init?.body as string), false);
  const list = client.getQueryData<{ boards: { policy: BoardPolicy }[] }>(
    boardListKeys.list,
  );
  assert.equal(list?.boards[0]?.policy.concurrencyCap, 4);
});

test("a refused policy save leaves the board list as it was", async () => {
  const client = newClient();
  client.setQueryData(boardListKeys.list, {
    boards: [{ key: LOCAL, policy }],
    knownLinearTeamKeys: [],
  });
  stubFetch({ status: 400, body: { error: "invalid-loopModel" } });
  const result = await new MutationObserver(
    client,
    savePolicyMutationOptions(client, LOCAL),
  ).mutate(policy);
  assert.deepEqual(result, {
    ok: false,
    reason: "the loop model is not a supported model",
  });
  const list = client.getQueryData<{ boards: { policy: BoardPolicy }[] }>(
    boardListKeys.list,
  );
  assert.equal(list?.boards[0]?.policy, policy);
});

test("Add extra orchestrator posts the extra role with its scope and override, then refreshes", async () => {
  const client = newClient();
  client.setQueryData(orchestratorKeys.panel(LOCAL), []);
  stubFetch({ status: 201, body: { orchestrator: {} } });
  const result = await new MutationObserver(
    client,
    addExtraMutationOptions(client, LOCAL),
  ).mutate({
    id: "extra-1",
    name: "Extra orchestrator 1",
    scope: { groupIds: ["GROUP-14"], ticketIds: [] },
    policyOverride: { concurrencyCap: 1 },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.url, "/api/boards/LOCAL/orchestrators");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(body(0), {
    id: "extra-1",
    name: "Extra orchestrator 1",
    scope: { groupIds: ["GROUP-14"], ticketIds: [] },
    policyOverride: { concurrencyCap: 1 },
    role: "extra",
  });
  assert.equal(
    client.getQueryState(orchestratorKeys.panel(LOCAL))?.isInvalidated,
    true,
  );
});

test("a refused add reads the server code as a reason", async () => {
  stubFetch({ status: 409, body: { error: "group-owned", owner: "extra-2" } });
  const client = newClient();
  const result = await new MutationObserver(
    client,
    addExtraMutationOptions(client, LOCAL),
  ).mutate({
    id: "extra-1",
    name: "Extra orchestrator 1",
    scope: { groupIds: ["GROUP-14"], ticketIds: [] },
    policyOverride: {},
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "another extra orchestrator owns one of the groups",
  });
});

test("Save overrides patches the extra with the whole override", async () => {
  const client = newClient();
  stubFetch({ status: 200, body: { orchestrator: {} } });
  const result = await new MutationObserver(
    client,
    saveOverridesMutationOptions(client, LOCAL),
  ).mutate({ id: "extra-1", policyOverride: { shipRights: "none" } });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.url, "/api/boards/LOCAL/orchestrators/extra-1");
  assert.equal(calls[0]?.init?.method, "PATCH");
  assert.deepEqual(body(0), { policyOverride: { shipRights: "none" } });
});

test("Move groups patches the source scope before the target scope", async () => {
  const client = newClient();
  stubFetch(
    { status: 200, body: { orchestrator: {} } },
    { status: 200, body: { orchestrator: {} } },
  );
  const scope = (ids: string[]) => ({ groupIds: ids, ticketIds: [] });
  const result = await new MutationObserver(
    client,
    moveGroupsMutationOptions(client, LOCAL),
  ).mutate([
    { id: "extra-1", scope: scope(["G-2"]), restore: scope(["G-1", "G-2"]) },
    { id: "extra-2", scope: scope(["G-3", "G-1"]), restore: scope(["G-3"]) },
  ]);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(
    calls.map((c) => [c.url, c.init?.method]),
    [
      ["/api/boards/LOCAL/orchestrators/extra-1", "PATCH"],
      ["/api/boards/LOCAL/orchestrators/extra-2", "PATCH"],
    ],
  );
  assert.deepEqual(body(0), { scope: scope(["G-2"]) });
  assert.deepEqual(body(1), { scope: scope(["G-3", "G-1"]) });
});

test("a failed target patch restores the source scope and reports the failure", async () => {
  const client = newClient();
  stubFetch(
    { status: 200, body: { orchestrator: {} } },
    { status: 409, body: { error: "group-owned", owner: "extra-3" } },
    { status: 200, body: { orchestrator: {} } },
  );
  const scope = (ids: string[]) => ({ groupIds: ids, ticketIds: [] });
  const result = await new MutationObserver(
    client,
    moveGroupsMutationOptions(client, LOCAL),
  ).mutate([
    { id: "extra-1", scope: scope(["G-2"]), restore: scope(["G-1", "G-2"]) },
    { id: "extra-2", scope: scope(["G-1"]), restore: scope([]) },
  ]);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.url, "/api/boards/LOCAL/orchestrators/extra-1");
  assert.deepEqual(body(2), { scope: scope(["G-1", "G-2"]) });
});

test("a move that fails on the first step restores nothing", async () => {
  const client = newClient();
  stubFetch({ status: 400, body: { error: "extra-needs-scope" } });
  const scope = (ids: string[]) => ({ groupIds: ids, ticketIds: [] });
  const result = await new MutationObserver(
    client,
    moveGroupsMutationOptions(client, LOCAL),
  ).mutate([{ id: "extra-1", scope: scope([]), restore: scope(["G-1"]) }]);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
});
