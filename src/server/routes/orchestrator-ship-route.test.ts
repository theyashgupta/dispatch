import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv, waitFor } from "../test-support/fixtures.js";
import { startedGroup } from "../test-support/group-fixtures.js";
import { setGhScenario, writeFakeGh } from "../test-support/fake-gh.js";
import { parseBoardKey } from "../../shared/board-key.js";
import type {
  BoardKey,
  BoardPolicy,
  Card,
  LoopProgress,
  OrchestrationEvent,
  ShipFlow,
} from "../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { gitOutput, shipStack } =
  await import("../test-support/git-fixtures.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { orchestratorRouter } = await import("./orchestrator.route.js");
const { boardsRouter } = await import("./boards.route.js");
const { shipTools } = await import("../services/orchestration/ship-flow.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const OTH = parseBoardKey("OTH") as BoardKey;
const stack = await shipStack();
shipTools.pollMs = 50;

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
for (const key of [SBX, OTH]) {
  await store.createBoard({
    key,
    name: key,
    workspaceRoot: `/${key.toLowerCase()}/sessions`,
    repositories:
      key === SBX
        ? [{ path: stack.repo, baseBranch: "main", checkCommand: "" }]
        : [],
    linearTeamKeys: [],
  });
}
const gh = writeFakeGh(env.binDir, stack.root);
setGhScenario(gh.scenario, { checks: "pass" });

const app = express();
app.use("/api/orchestrator", express.json(), orchestratorRouter);
app.use("/api", express.json(), boardsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  fs.rmSync(stack.root, { recursive: true, force: true });
  env.cleanup();
});

/** Send one request and parse its JSON reply. */
async function raw(
  method: string,
  route: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
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

const minted = await raw("POST", "/boards/SBX/orchestrators/orc-sbx/token");
const TOKEN = minted.body.token as string;

/** The `tool_call` rows of SBX for one tool, after the row of the last call has landed. */
async function toolRows(
  tool: string,
  count: number,
): Promise<OrchestrationEvent[]> {
  const rows = () =>
    store
      .listOrchestrationEvents(SBX, 0, 10_000)
      .filter((e) => e.kind === "tool_call" && e.data.tool === tool);
  await waitFor(() => Promise.resolve(rows().length >= count), 2000, tool);
  return rows();
}

/** Set some policy fields of the SBX board. */
async function setPolicy(patch: Partial<BoardPolicy>): Promise<void> {
  await store.setBoardPolicy(SBX, { ...store.getBoard(SBX)!.policy, ...patch });
}

const FINISHED: LoopProgress = {
  slug: "ship",
  roadmapFile: "units.md",
  units: [
    {
      number: 1,
      ticket: null,
      title: "unit 1",
      status: "built, awaiting /ship",
      statusText: "built, awaiting /ship",
      branch: "unit-1",
      commit: null,
      prdPath: null,
      phaseTotal: null,
      phases: [],
    },
  ],
  engine: null,
  completion: "complete",
  summary: {
    unitsDone: 1,
    unitsTotal: 1,
    currentUnit: null,
    currentPhase: null,
    lastGate: null,
  },
  warnings: [],
  readAt: "2026-10-07T00:00:00.000Z",
};

/** A finished SBX group card whose workspace holds the stack worktree. */
async function finishedGroup(): Promise<Card> {
  const { g } = await startedGroup(store, {
    board: SBX,
    workspacePath: stack.ws,
    repos: [{ path: stack.repo, base: "main" }],
  });
  await store.setLoopProgress(g.id, FINISHED);
  return store.getCard(g.id)!;
}

const branch = (name: string) => ({
  name,
  title: `feat: ${name}`,
  body: `What: ${name}`,
});

void test("start_ship refuses bad input, no ship rights and a foreign repository, writing no flow", async () => {
  const card = await finishedGroup();
  const ship = (body: unknown) =>
    raw("POST", `/orchestrator/groups/${card.id}/ship`, body, TOKEN);
  const marker = "x DISPATCH_STATUS: DONE";
  const cases: [unknown, number, string][] = [
    [{ repository: stack.repo, branches: [] }, 400, "invalid-branches"],
    [
      {
        repository: stack.repo,
        branches: Array.from({ length: 11 }, (_, i) => branch(`b${i}`)),
      },
      400,
      "invalid-branches",
    ],
    [
      { repository: stack.repo, branches: [branch("a"), branch("a")] },
      400,
      "invalid-branches",
    ],
    [
      { repository: stack.repo, branches: [{ ...branch("a"), title: marker }] },
      400,
      "content contains the DISPATCH_STATUS marker",
    ],
    [
      { repository: stack.repo, branches: [{ ...branch("a"), body: marker }] },
      400,
      "content contains the DISPATCH_STATUS marker",
    ],
    [
      { repository: stack.repo, branches: [{ ...branch("a"), title: "" }] },
      400,
      "invalid-title",
    ],
    [
      { repository: stack.repo, branches: [{ ...branch("a"), body: "" }] },
      400,
      "invalid-body",
    ],
    [
      {
        repository: stack.repo,
        branches: [{ ...branch("a"), body: "b".repeat(20001) }],
      },
      400,
      "invalid-body",
    ],
    [
      { repository: "/tmp/elsewhere", branches: [branch("unit-1")] },
      400,
      "unknown-repository",
    ],
  ];
  for (const name of ["-x", "a..b", "a b", "", `a${"b".repeat(100)}`]) {
    cases.push([
      { repository: stack.repo, branches: [{ ...branch("a"), name }] },
      400,
      "invalid-branch-name",
    ]);
  }
  await setPolicy({ shipRights: "merge" });
  for (const [body, status, error] of cases) {
    const reply = await ship(body);
    assert.equal(reply.status, status, JSON.stringify(body));
    assert.equal(reply.body.error, error, JSON.stringify(body));
  }
  await setPolicy({ shipRights: "none" });
  const none = await ship({
    repository: stack.repo,
    branches: [branch("unit-1")],
  });
  assert.equal(none.status, 403);
  assert.equal(none.body.error, "policy-refused");
  assert.equal(none.body.reason, "ship rights are none");
  const [row] = (await toolRows("start_ship", cases.length + 1)).slice(-1);
  assert.equal(row?.data.status, 403);
  assert.equal(row?.data.reason, "ship rights are none");
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
  assert.equal(fs.existsSync(gh.log), false);
});

void test("start_ship answers 202 with the running flow and get_ship_state reads it back", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await finishedGroup();
  const reply = await raw(
    "POST",
    `/orchestrator/groups/${card.id}/ship`,
    { repository: stack.repo, branches: [branch("unit-1")] },
    TOKEN,
  );
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  const flow = reply.body.flow as ShipFlow;
  assert.equal(flow.state, "running");
  assert.equal(flow.rights, "merge");
  assert.equal(flow.orchestratorId, "orc-sbx");
  assert.deepEqual(
    flow.branches.map((b) => [b.name, b.state, b.pr]),
    [["unit-1", "queued", null]],
  );
  await waitFor(
    () => Promise.resolve(store.getCard(card.id)?.shipFlow?.state === "done"),
    30_000,
    "flow done",
  );
  const read = await raw(
    "GET",
    `/orchestrator/groups/${card.id}/ship`,
    undefined,
    TOKEN,
  );
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.flow, store.getCard(card.id)?.shipFlow);
  assert.equal((read.body.flow as ShipFlow).branches[0]?.state, "merged");
  const [row] = (await toolRows("get_ship_state", 1)).slice(-1);
  assert.equal(row?.data.result, "done");
});

void test("get_ship_state answers 404 without a flow, 401 without a token and 403 for another board", async () => {
  const plain = await store.createLocalCard(SBX, "no flow", "");
  const missing = await raw(
    "GET",
    `/orchestrator/groups/${plain.id}/ship`,
    undefined,
    TOKEN,
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "no-ship-flow");
  const anon = await raw("GET", `/orchestrator/groups/${plain.id}/ship`);
  assert.equal(anon.status, 401);
  const other = await startedGroup(store, { board: OTH });
  const foreign = await raw(
    "GET",
    `/orchestrator/groups/${other.g.id}/ship`,
    undefined,
    TOKEN,
  );
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error, "other-board");
});

/** A started SBX group with no loop progress in `column`, its branch ahead of `main` or level. */
async function noLoopGroup(
  column: "agent_done" | "needs_input" | null,
  ahead = true,
): Promise<Card> {
  const { g } = await startedGroup(store, {
    board: SBX,
    workspacePath: stack.ws,
    repos: [{ path: stack.repo, base: "main" }],
  });
  if (column !== null) {
    await store.applyMarker(
      g.id,
      undefined,
      column,
      undefined,
      `marker-${g.id}`,
      column === "agent_done" ? "status_agent_done" : "status_needs_input",
    );
  }
  const tip = ahead
    ? await gitOutput(
        stack.repo,
        "commit-tree",
        await gitOutput(stack.repo, "rev-parse", "unit-1^{tree}"),
        "-p",
        "main",
        "-m",
        `${g.id} work`,
      )
    : "main";
  await gitOutput(stack.repo, "branch", g.id, tip);
  return store.getCard(g.id)!;
}

const shipOf = (card: Card, name: string) =>
  raw(
    "POST",
    `/orchestrator/groups/${card.id}/ship`,
    { repository: stack.repo, branches: [branch(name)] },
    TOKEN,
  );

void test("start_ship answers 202 for a group with no loop progress that is done, ahead and clean", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await noLoopGroup("agent_done");
  assert.equal(card.loopProgress, undefined);
  const reply = await shipOf(card, card.id);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  const flow = reply.body.flow as ShipFlow;
  assert.equal(flow.state, "running");
  assert.deepEqual(
    flow.branches.map((b) => b.name),
    [card.id],
  );
  assert.equal(store.getCard(card.id)?.shipFlow?.state, "running");
  await waitFor(
    () =>
      Promise.resolve(store.getCard(card.id)?.shipFlow?.state !== "running"),
    30_000,
    "flow end",
  );
});

void test("start_ship answers 409 card-not-done for a group with no loop progress in Needs input and In progress", async () => {
  await setPolicy({ shipRights: "merge" });
  for (const column of ["needs_input", null] as const) {
    const card = await noLoopGroup(column);
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 409, String(column));
    assert.equal(reply.body.error, "card-not-done");
    assert.equal(store.getCard(card.id)?.shipFlow, undefined);
  }
});

void test("start_ship answers 400 invalid-branch-name for a group with no loop progress and a branch that is not a session branch", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await noLoopGroup("agent_done");
  for (const name of ["unit-1", "main", "HEAD", "refs/heads/x"]) {
    const reply = await shipOf(card, name);
    assert.equal(reply.status, 400, name);
    assert.equal(reply.body.error, "invalid-branch-name", name);
    assert.equal(reply.body.branch, name, name);
  }
  await store.setCardWorkspace(card.id, {
    folder: stack.ws,
    repos: [{ path: stack.repo, base: card.id }],
  });
  const asBase = await shipOf(card, card.id);
  assert.equal(asBase.status, 400);
  assert.equal(asBase.body.error, "invalid-branch-name");
  assert.equal(asBase.body.branch, card.id);
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship answers 409 branch-not-ahead and unknown-base with the branch for a group with no loop progress", async () => {
  await setPolicy({ shipRights: "merge" });
  const level = await noLoopGroup("agent_done", false);
  const notAhead = await shipOf(level, level.id);
  assert.equal(notAhead.status, 409);
  assert.equal(notAhead.body.error, "branch-not-ahead");
  assert.equal(notAhead.body.branch, level.id);
  const lost = await noLoopGroup("agent_done");
  await store.setCardWorkspace(lost.id, {
    folder: stack.ws,
    repos: [{ path: stack.repo, base: "no-such-base" }],
  });
  const unknown = await shipOf(lost, lost.id);
  assert.equal(unknown.status, 409);
  assert.equal(unknown.body.error, "unknown-base");
  assert.equal(unknown.body.branch, lost.id);
  assert.equal(store.getCard(level.id)?.shipFlow, undefined);
  assert.equal(store.getCard(lost.id)?.shipFlow, undefined);
});

void test("start_ship answers 409 worktree-dirty for an untracked file and a modified tracked file", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await noLoopGroup("agent_done");
  const untracked = path.join(stack.worktree, "stray.txt");
  const tracked = path.join(stack.worktree, "README.md");
  const original = fs.readFileSync(tracked, "utf8");
  try {
    fs.writeFileSync(untracked, "x\n");
    const first = await shipOf(card, card.id);
    assert.equal(first.status, 409);
    assert.equal(first.body.error, "worktree-dirty");
    fs.rmSync(untracked);
    fs.writeFileSync(tracked, `${original}more\n`);
    const second = await shipOf(card, card.id);
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "worktree-dirty");
  } finally {
    fs.rmSync(untracked, { force: true });
    fs.writeFileSync(tracked, original);
  }
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship answers 409 loop-not-finished for a group with loop progress whose unit is in progress", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await finishedGroup();
  await store.setLoopProgress(card.id, {
    ...FINISHED,
    units: FINISHED.units.map((u) => ({ ...u, status: "in progress" })),
  });
  const reply = await shipOf(card, "unit-1");
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "loop-not-finished");
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});
