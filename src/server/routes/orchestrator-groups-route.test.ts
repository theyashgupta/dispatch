import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  BoardPolicy,
  Card,
  OrchestrationEvent,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { gitOutput, tempRepoWithWorkspace } =
  await import("../test-support/git-fixtures.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { groupStarter } =
  await import("../services/orchestration/orchestrator-groups.js");
const { createPlaybook } = await import("../services/infra/playbooks.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
const fixture = await tempRepoWithWorkspace();
const repo = fixture.repo;
const git = (...args: string[]) => gitOutput(repo, ...args);
const mainSha = await git("rev-parse", "main");

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
for (const key of [SBX, OTH]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories:
      key === SBX ? [{ path: repo, baseBranch: "main", checkCommand: "" }] : [],
    linearTeamKeys: [],
  });
}

const starts: [string, { extraDirection?: string; playbook?: string }][] = [];
groupStarter.start = (cardId, opts) => {
  starts.push([cardId, { ...opts }]);
  return Promise.resolve({ ok: true });
};

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
app.use("/api", express.json(), boardsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  fs.rmSync(fixture.root, { recursive: true, force: true });
  env.cleanup();
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function raw(
  method: string,
  route: string,
  body?: unknown,
  token?: string,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { "x-orchestrator-token": token }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

function toolCalls(): OrchestrationEvent[] {
  return store
    .listOrchestrationEvents(SBX, 0, 10_000)
    .filter((e) => e.kind === "tool_call");
}

/** Run one SBX orchestrator call and return its reply with the single `tool_call` row it appended. */
async function call(
  route: string,
  body?: unknown,
): Promise<{ reply: Reply; row: OrchestrationEvent }> {
  const before = toolCalls().length;
  const reply = await raw("POST", `/orchestrator${route}`, body, TOKEN);
  await waitFor(
    () => Promise.resolve(toolCalls().length > before),
    2000,
    "tool_call row",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(toolCalls().length, before + 1);
  return { reply, row: toolCalls().at(-1)! };
}

const minted = await raw("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

async function setPolicy(patch: Partial<BoardPolicy>): Promise<void> {
  await store.setBoardPolicy(SBX, { ...store.getBoard(SBX)!.policy, ...patch });
}

const branches = async () =>
  (await git("branch", "--format=%(refname:short)")).split("\n").sort();

async function newGroup(extra: Record<string, unknown> = {}): Promise<Card> {
  const a = await store.createLocalCard(SBX, "member a", "");
  const b = await store.createLocalCard(SBX, "member b", "");
  const { reply } = await call("/groups", {
    title: "orchestrated group",
    memberIds: [a.id, b.id],
    repos: [{ path: repo, base: "main" }],
    ...extra,
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return store.getCard((reply.body.card as Card).id)!;
}

void test("create_base_branch cuts a local branch from a start point", async () => {
  const { reply, row } = await call("/base-branches", {
    repository: repo,
    name: "base/feat-1",
    startPoint: "main",
  });
  assert.equal(reply.status, 201);
  assert.deepEqual(reply.body, {
    repository: repo,
    name: "base/feat-1",
    commit: mainSha,
  });
  assert.equal(await git("rev-parse", "refs/heads/base/feat-1"), mainSha);
  assert.equal(row.data.tool, "create_base_branch");
  assert.equal(row.data.result, "base/feat-1");
});

void test("create_base_branch refuses a bad name, start point or repository and an existing branch", async () => {
  const before = await branches();
  const refused = async (
    body: Record<string, unknown>,
    status: number,
    error: string,
  ) => {
    const { reply } = await call("/base-branches", {
      repository: repo,
      name: "base/ok",
      startPoint: "main",
      ...body,
    });
    assert.equal(reply.status, status, JSON.stringify(body));
    assert.equal(reply.body.error, error, JSON.stringify(body));
  };
  for (const name of [
    "feat/x",
    "base/",
    "base/x/",
    "base/../x",
    "base/x.lock",
    "base/Upper",
    "base/a//b",
    "base/-x",
    `base/${"a".repeat(62)}`,
  ]) {
    await refused({ name }, 400, "invalid-branch-name");
  }
  await refused({ startPoint: "nope" }, 400, "unknown-start-point");
  await refused({ startPoint: "-main" }, 400, "unknown-start-point");
  await refused({ startPoint: "--all" }, 400, "unknown-start-point");
  await refused(
    { repository: "/tmp/not-a-board-repo" },
    400,
    "unknown-repository",
  );
  await refused({ name: "base/feat-1" }, 409, "branch-exists");
  assert.deepEqual(await branches(), before);
});

void test("create_base_branch never touches a remote", async () => {
  assert.equal(await git("remote"), "");
  assert.equal(await git("branch", "-r"), "");
});

void test("create_group mints a group with its launch values and starts nothing", async () => {
  const startsBefore = starts.length;
  const card = await newGroup({ direction: "go build it" });
  assert.equal(card.source, "group");
  assert.equal(card.boardKey, SBX);
  assert.equal(card.createdByOrchestrator, "orc-sbx");
  assert.deepEqual(card.launch, { direction: "go build it" });
  assert.equal(card.startQueued, false);
  assert.deepEqual(card.dependsOn, []);
  assert.deepEqual(card.workspace?.repos, [{ path: repo, base: "main" }]);
  assert.equal(card.tmuxSession, undefined);
  assert.equal(store.isStarting(card.id), false);
  assert.equal(starts.length, startsBefore);
});

void test("create_group with a playbook stores it in launch and start_group passes it to the start", async () => {
  const made = await createPlaybook({
    name: "Orchestrated rules",
    body: "## Extra direction\n{extra}\n",
  });
  assert.equal(made.ok, true);
  await setPolicy({ concurrencyCap: 5, budgetPerGroup: null });
  const card = await newGroup({
    direction: "follow the playbook",
    playbook: "Orchestrated rules",
  });
  assert.deepEqual(card.launch, {
    direction: "follow the playbook",
    playbook: "Orchestrated rules",
  });
  const { reply } = await call(`/groups/${card.id}/start`);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  assert.deepEqual(starts.at(-1), [
    card.id,
    { extraDirection: "follow the playbook", playbook: "Orchestrated rules" },
  ]);
});

void test("create_group refuses a dependency that is not a group of the board and a foreign repository", async () => {
  const groups = () =>
    store.listCards(SBX).filter((c) => c.source === "group").length;
  const before = groups();
  const plain = await store.createLocalCard(SBX, "plain", "");
  const othGroup = await startedGroup(store, { board: OTH });
  for (const dep of [plain.id, othGroup.g.id, "ghost"]) {
    const a = await store.createLocalCard(SBX, "a", "");
    const b = await store.createLocalCard(SBX, "b", "");
    const { reply } = await call("/groups", {
      title: "g",
      memberIds: [a.id, b.id],
      repos: [{ path: repo, base: "main" }],
      dependsOn: [dep],
    });
    assert.equal(reply.status, 400);
    assert.equal(reply.body.error, "invalid-dependency");
  }
  const a = await store.createLocalCard(SBX, "a", "");
  const b = await store.createLocalCard(SBX, "b", "");
  const foreign = await call("/groups", {
    title: "g",
    memberIds: [a.id, b.id],
    repos: [{ path: "/tmp/elsewhere", base: "main" }],
  });
  assert.equal(foreign.reply.status, 400);
  assert.equal(foreign.reply.body.error, "unknown-repository");
  assert.equal(groups(), before);
});

void test("start_group under the cap starts with the stored launch values", async () => {
  await setPolicy({ concurrencyCap: 5, budgetPerGroup: null });
  const card = await newGroup({ direction: "ship it" });
  const { reply, row } = await call(`/groups/${card.id}/start`);
  assert.equal(reply.status, 202);
  assert.deepEqual(reply.body, { started: true });
  assert.deepEqual(starts.at(-1), [
    card.id,
    { extraDirection: "ship it", playbook: undefined },
  ]);
  assert.equal(row.data.result, "started");
});

void test("start_group at the cap is refused with the reason and writes nothing", async () => {
  await setPolicy({ concurrencyCap: 1 });
  await startedGroup(store, { board: SBX });
  const card = await newGroup();
  const startsBefore = starts.length;
  const { reply, row } = await call(`/groups/${card.id}/start`);
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "policy-refused");
  assert.equal(
    reply.body.reason,
    "concurrency cap reached: 1 of 1 loops running",
  );
  assert.equal(
    row.data.reason,
    "concurrency cap reached: 1 of 1 loops running",
  );
  assert.equal(row.data.status, 403);
  assert.equal(starts.length, startsBefore);
  assert.equal(store.getCard(card.id)?.startQueued, false);
  assert.equal(store.getCard(card.id)?.tmuxSession, undefined);
});

void test("start_group over budget is refused with the budget reason", async () => {
  await setPolicy({ concurrencyCap: 10, budgetPerGroup: 1 });
  const { g } = await startedGroup(store, { board: SBX });
  await store.setSessionMetersIfSession(g.id, g.tmuxSession!, {
    contextPercent: 10,
    model: "opus",
    cost: 1.5,
    usage: { fiveHourPercent: 1, sevenDayPercent: 1 },
  });
  await store.markSessionLost(g.id, undefined);
  const startsBefore = starts.length;
  const { reply } = await call(`/groups/${g.id}/start`);
  assert.equal(reply.status, 403);
  assert.equal(reply.body.error, "policy-refused");
  assert.equal(reply.body.reason, "budget reached: cost 1.5 of 1");
  assert.equal(starts.length, startsBefore);
  assert.notEqual(store.getCard(g.id)?.startQueued, true);
  await setPolicy({ budgetPerGroup: null });
});

void test("a meter reset by a claude relaunch keeps the group over budget", async () => {
  await setPolicy({ concurrencyCap: 10, budgetPerGroup: 2 });
  const { g } = await startedGroup(store, { board: SBX });
  const meter = (cost: number) =>
    store.setSessionMetersIfSession(g.id, g.tmuxSession!, {
      contextPercent: 10,
      model: "opus",
      cost,
      usage: { fiveHourPercent: 1, sevenDayPercent: 1 },
    });
  await meter(3);
  const policy = await raw("GET", "/orchestrator/policy", undefined, TOKEN);
  const cost = () =>
    ((policy.body.groups ?? []) as { cardId: string; cost: number }[]).find(
      (x) => x.cardId === g.id,
    )?.cost;
  assert.equal(cost(), 3);
  await meter(0.5);
  await store.markSessionLost(g.id, undefined);
  const startsBefore = starts.length;
  const { reply } = await call(`/groups/${g.id}/start`);
  assert.equal(reply.status, 403, JSON.stringify(reply.body));
  assert.equal(reply.body.reason, "budget reached: cost 3.5 of 2");
  assert.equal(starts.length, startsBefore);
  await setPolicy({ budgetPerGroup: null });
});

void test("a direct start of a queued group clears its queue flag", async () => {
  await setPolicy({ concurrencyCap: 10, budgetPerGroup: null });
  const dep = await newGroup();
  const card = await newGroup({ dependsOn: [dep.id] });
  const queued = await call(`/groups/${card.id}/start`);
  assert.deepEqual(queued.reply.body, { queued: true, waitingOn: [dep.id] });
  assert.equal(store.getCard(card.id)?.startQueued, true);
  await store.moveCardManual(dep.id, "done");
  const startsBefore = starts.length;
  const { reply } = await call(`/groups/${card.id}/start`);
  assert.deepEqual(reply.body, { started: true });
  assert.equal(starts.length, startsBefore + 1);
  assert.equal(store.getCard(card.id)?.startQueued, false);
  assert.deepEqual(store.getCard(card.id)?.dependsOn, [dep.id]);
});

void test("a running single ticket does not count against the cap", async () => {
  const card = await newGroup();
  const policy = await raw("GET", "/orchestrator/policy", undefined, TOKEN);
  const groupsRunning = policy.body.runningLoops as number;
  await setPolicy({ concurrencyCap: groupsRunning + 1, budgetPerGroup: null });
  const single = await store.createLocalCard(SBX, "single", "");
  await store.completeStart(single.id, undefined, {
    workspacePath: `/tmp/ws-${single.id}`,
    tmuxSession: `dsp-${single.id}`,
    branch: single.id,
  });
  const { reply } = await call(`/groups/${card.id}/start`);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  assert.deepEqual(reply.body, { started: true });
  await setPolicy({ concurrencyCap: 10 });
});

void test("start_group with an unmerged dependency queues the start", async () => {
  const dep = await newGroup();
  const card = await newGroup({ dependsOn: [dep.id] });
  const startsBefore = starts.length;
  const { reply, row } = await call(`/groups/${card.id}/start`);
  assert.equal(reply.status, 202);
  assert.deepEqual(reply.body, { queued: true, waitingOn: [dep.id] });
  assert.equal(store.getCard(card.id)?.startQueued, true);
  assert.deepEqual(store.getCard(card.id)?.dependsOn, [dep.id]);
  assert.equal(starts.length, startsBefore);
  assert.equal(row.data.result, "queued");
});

void test("start_group refuses a running group, a plain card and a group of another board", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  const running = await call(`/groups/${g.id}/start`);
  assert.equal(running.reply.status, 409);
  assert.equal(running.reply.body.error, "already-started");
  const plain = await store.createLocalCard(SBX, "plain", "");
  const notGroup = await call(`/groups/${plain.id}/start`);
  assert.equal(notGroup.reply.status, 400);
  assert.equal(notGroup.reply.body.error, "not-group-card");
  const other = await startedGroup(store, { board: OTH });
  const foreign = await call(`/groups/${other.g.id}/start`);
  assert.equal(foreign.reply.status, 403);
  assert.equal(foreign.reply.body.error, "other-board");
});

void test("create_group refuses a marker, a bad field and a member of another board, and writes nothing", async () => {
  const groups = () =>
    store.listCards(SBX).filter((c) => c.source === "group").length;
  const before = groups();
  const a = await store.createLocalCard(SBX, "a", "");
  const b = await store.createLocalCard(SBX, "b", "");
  const stranger = await store.createLocalCard(OTH, "stranger", "");
  const valid = {
    title: "g",
    memberIds: [a.id, b.id],
    repos: [{ path: repo, base: "main" }],
  };
  const marker = "text DISPATCH_STATUS: DONE";
  const markerError = "content contains the DISPATCH_STATUS marker";
  const cases: [Record<string, unknown>, number, string][] = [
    [{ title: marker }, 400, markerError],
    [{ direction: marker }, 400, markerError],
    [{ memberIds: [a.id] }, 400, "invalid-member-ids"],
    [{ memberIds: [a.id, a.id] }, 400, "invalid-member-ids"],
    [{ repos: [] }, 400, "invalid-repos"],
    [{ playbook: "" }, 400, "invalid-playbook"],
    [{ direction: 5 }, 400, "invalid-direction"],
    [
      { memberIds: [a.id, stranger.id] },
      409,
      "some selected cards are no longer eligible to be grouped",
    ],
  ];
  for (const [patch, status, error] of cases) {
    const { reply } = await call("/groups", { ...valid, ...patch });
    assert.equal(reply.status, status, JSON.stringify(patch));
    assert.equal(reply.body.error, error, JSON.stringify(patch));
  }
  const foreign = await call("/groups", {
    ...valid,
    memberIds: [a.id, stranger.id],
  });
  assert.deepEqual(foreign.reply.body.ineligibleIds, [stranger.id]);
  assert.equal(groups(), before);
  assert.equal(store.getCard(a.id)?.groupId, undefined);
  assert.equal(store.getCard(stranger.id)?.groupId, undefined);
});
