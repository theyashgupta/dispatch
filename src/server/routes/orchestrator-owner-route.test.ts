import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  BoardPolicy,
  OrchestratorRecord,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const { mintOrchestratorToken } =
  await import("../services/orchestration/orchestrator-tokens.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");

const SBX = parseBoardKey("SBX") as BoardKey;

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const a = await store.createLocalCard(SBX, "member a", "");
const b = await store.createLocalCard(SBX, "member b", "");
const minted = await store.createGroupCard(SBX, "infra group", [a.id, b.id]);
if (!minted.ok) throw new Error("group not created");
const group = minted.card;
const loose = await store.createLocalCard(SBX, "loose ticket", "");
const claimable = await store.createLocalCard(SBX, "claimable ticket", "");
const owned = await store.createLocalCard(SBX, "owned by other", "");
const m1 = await store.createLocalCard(SBX, "main member 1", "");
const m2 = await store.createLocalCard(SBX, "main member 2", "");
const mainGroupMinted = await store.createGroupCard(SBX, "main group", [
  m1.id,
  m2.id,
]);
if (!mainGroupMinted.ok) throw new Error("main group not created");
const mainGroup = mainGroupMinted.card;

function record(
  id: string,
  role: "main" | "extra",
  groupIds: string[] = [],
  policyOverride: OrchestratorRecord["policyOverride"] = {},
  ticketIds: string[] = [],
): OrchestratorRecord {
  return {
    id,
    name: id,
    role,
    scope: { groupIds, ticketIds },
    policyOverride,
    cardId: null,
    state: "stopped",
    createdAt: "2026-10-07T00:00:00.000Z",
  };
}

await store.setBoardPolicy(SBX, {
  ...store.getBoard(SBX)!.policy,
  concurrencyCap: 3,
  shipRights: "open_prs",
});
await store.setBoardOrchestrators(SBX, [
  record("main", "main"),
  record("infra", "extra", [group.id], {
    concurrencyCap: 1,
    shipRights: "none",
  }),
  record("feat", "extra"),
  record("other", "extra", [], {}, [owned.id]),
]);

const MAIN = mintOrchestratorToken({ boardKey: SBX, orchestratorId: "main" });
const INFRA = mintOrchestratorToken({ boardKey: SBX, orchestratorId: "infra" });
const FEAT = mintOrchestratorToken({ boardKey: SBX, orchestratorId: "feat" });
const STRANGER = mintOrchestratorToken({
  boardKey: SBX,
  orchestratorId: "stranger",
});

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/orchestrator`;
after(() => {
  server.close();
  env.cleanup();
});

async function call(
  method: string,
  route: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-orchestrator-token": token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

void test("an extra reaches its own group and the members of it", async () => {
  assert.equal((await call("GET", `/cards/${group.id}`, INFRA)).status, 200);
  assert.equal((await call("GET", `/cards/${a.id}`, INFRA)).status, 200);
});

void test("the main gets 403 other-owner on a group an extra owns and on its members", async () => {
  for (const id of [group.id, a.id]) {
    const reply = await call("GET", `/cards/${id}`, MAIN);
    assert.equal(reply.status, 403, id);
    assert.equal(reply.body.error, "other-owner", id);
  }
  const progress = await call("GET", `/groups/${group.id}/progress`, MAIN);
  assert.equal(progress.status, 403);
  const start = await call("POST", `/groups/${group.id}/start`, MAIN);
  assert.equal(start.status, 403);
  assert.equal(start.body.error, "other-owner");
});

void test("an extra gets 403 out-of-scope on a loose ticket the main owns", async () => {
  const reply = await call("GET", `/cards/${loose.id}`, INFRA);
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "out-of-scope");
  assert.equal((await call("GET", `/cards/${loose.id}`, MAIN)).status, 200);
});

void test("a token whose orchestrator has no record owns nothing on a board with records", async () => {
  const reply = await call("GET", `/cards/${loose.id}`, STRANGER);
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "other-owner");
});

const shipBody = {
  repository: "/sbx/repo",
  branches: [
    { name: `feat/${group.id}-unit-1-x`, title: "feat: x", body: "x" },
  ],
};

void test("a feature extra on a card it owns passes main-only and is stopped by its ship rights", async () => {
  const reply = await call("POST", `/groups/${group.id}/ship`, INFRA, shipBody);
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "policy-refused");
  assert.equal(store.getCard(group.id)?.shipFlow, undefined);
});

void test("a feature extra on a card it does not own gets 403 out-of-scope from ship", async () => {
  const reply = await call(
    "POST",
    `/groups/${mainGroup.id}/ship`,
    INFRA,
    shipBody,
  );
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "out-of-scope");
  assert.equal(store.getCard(mainGroup.id)?.shipFlow, undefined);
});

void test("the main passes the owner and role checks of ship on an extra's group", async () => {
  const reply = await call("POST", `/groups/${group.id}/ship`, MAIN, shipBody);
  assert.notEqual(reply.body.error, "main-only");
  assert.notEqual(reply.body.error, "other-owner");
  assert.equal(store.getCard(group.id)?.shipFlow, undefined);
});

void test("get_policy answers the extra's narrowed policy and the main's board policy", async () => {
  const extra = await call("GET", "/policy", INFRA);
  const policy = extra.body.policy as BoardPolicy;
  assert.equal(policy.concurrencyCap, 1);
  assert.equal(policy.shipRights, "none");
  assert.equal(extra.body.concurrencyCap, 1);
  const mainPolicy = (await call("GET", "/policy", MAIN)).body
    .policy as BoardPolicy;
  assert.equal(mainPolicy.concurrencyCap, 3);
  assert.equal(mainPolicy.shipRights, "open_prs");
});

void test("every card tool answers 404 unknown-card on an orchestrator session card, the main included", async () => {
  const hidden = await store.createOrchestratorCard(
    SBX,
    "Orchestrator: infra",
    "infra",
  );
  const calls: [string, string, unknown?][] = [
    ["GET", `/cards/${hidden.id}`],
    ["GET", `/sessions/${hidden.id}/pane`],
    ["POST", `/sessions/${hidden.id}/input`, { text: "hello" }],
    ["POST", `/sessions/${hidden.id}/stop`],
    ["POST", `/sessions/${hidden.id}/resume`],
    ["POST", `/sessions/${hidden.id}/handoff`, {}],
    ["POST", `/tickets/${hidden.id}/move`, { column: "in_progress" }],
    ["PATCH", `/tickets/${hidden.id}`, { title: "x" }],
    ["POST", `/tickets/${hidden.id}/comments`, { body: "x" }],
    ["GET", `/groups/${hidden.id}/ship`],
  ];
  for (const token of [MAIN, INFRA]) {
    for (const [method, route, body] of calls) {
      const reply = await call(method, route, token, body);
      assert.equal(reply.status, 404, `${method} ${route}`);
      assert.equal(reply.body.error, "unknown-card", `${method} ${route}`);
    }
  }
  assert.equal(store.getCard(hidden.id)?.column, "todo");
  assert.equal(store.getCard(hidden.id)?.title, "Orchestrator: infra");
});

function listed(reply: { body: Record<string, unknown> }): string[] {
  return (reply.body.cards as { id: string }[]).map((c) => c.id).sort();
}

void test("a feature extra with an empty scope lists no card and cannot read or start a To Do ticket", async () => {
  assert.ok(store.listCards(SBX).some((c) => c.column === "todo"));
  const list = await call("GET", "/cards", FEAT);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 0);
  assert.deepEqual(list.body.cards, []);
  const start = await call("POST", `/cards/${claimable.id}/start`, FEAT, {
    playbook: "Write code directly",
  });
  assert.equal(start.status, 403);
  assert.equal(start.body.error, "out-of-scope");
  const stored = store.getCard(claimable.id);
  assert.equal(stored?.launch, undefined);
  assert.equal(stored?.sessions?.length ?? 0, 0);
  const read = await call("GET", `/cards/${claimable.id}`, FEAT);
  assert.equal(read.status, 403);
  assert.equal(read.body.error, "out-of-scope");
});

void test("assign_card moves a ticket into the scope of a feature extra and unlocks it", async () => {
  const reply = await call("POST", `/cards/${claimable.id}/assign`, FEAT);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.changed, true);
  assert.deepEqual(
    store.getBoard(SBX)?.orchestrators.find((r) => r.id === "feat")?.scope
      .ticketIds,
    [claimable.id],
  );
  assert.deepEqual(listed(await call("GET", "/cards", FEAT)), [claimable.id]);
  const again = await call("POST", `/cards/${claimable.id}/assign`, FEAT);
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  const start = await call("POST", `/cards/${claimable.id}/start`, FEAT, {
    playbook: "no such playbook",
  });
  assert.equal(start.status, 400);
  assert.equal(start.body.error, "unknown-playbook");
});

void test("a feature extra lists the group it owns and the members of it", async () => {
  const ids = listed(await call("GET", "/cards", INFRA));
  assert.deepEqual(ids, [group.id, a.id, b.id].sort());
});

void test("the main lists every card of the board", async () => {
  const reply = await call("GET", "/cards", MAIN);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.total, store.listCards(SBX).length);
});

void test("assign_card refuses the main, a card of another extra and a group member", async () => {
  const byMain = await call("POST", `/cards/${loose.id}/assign`, MAIN);
  assert.equal(byMain.status, 400);
  assert.equal(byMain.body.error, "not-feature-orchestrator");
  const taken = await call("POST", `/cards/${owned.id}/assign`, FEAT);
  assert.equal(taken.status, 403);
  assert.equal(taken.body.error, "other-owner");
  const member = await call("POST", `/cards/${m1.id}/assign`, FEAT);
  assert.equal(member.status, 400);
  assert.equal(member.body.error, "group-member");
});

void test("a feature extra gets 403 out-of-scope on the ship state of a group it does not own, the main passes", async () => {
  const refused = await call("GET", `/groups/${mainGroup.id}/ship`, INFRA);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "out-of-scope");
  const ofExtra = await call("GET", `/groups/${group.id}/ship`, MAIN);
  assert.equal(ofExtra.status, 404);
  assert.equal(ofExtra.body.error, "no-ship-flow");
});
