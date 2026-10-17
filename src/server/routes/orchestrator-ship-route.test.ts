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

/**
 * A started SBX ticket card with a launch in `column`, its session branch ahead of `main` or level.
 *
 * @remarks The fake gh squash merge fails on an empty diff, so a flow that must merge needs a tree
 * that `main` does not hold yet.
 */
async function launchedTicket(
  column: "agent_done" | "needs_input" | null,
  { ahead = true, launched = true, tree = "unit-1" } = {},
): Promise<Card> {
  const t = await store.createLocalCard(SBX, "launched ticket", "");
  if (launched) {
    await store.setOrchestratorFields(t.id, {
      launch: { direction: "ship it" },
    });
  }
  await store.setCardWorkspace(t.id, {
    folder: stack.ws,
    repos: [{ path: stack.repo, base: "main" }],
  });
  await store.completeStart(t.id, undefined, {
    workspacePath: stack.ws,
    tmuxSession: `dsp-${t.id}`,
    branch: t.id,
  });
  if (column !== null) {
    await store.applyMarker(
      t.id,
      undefined,
      column,
      undefined,
      `marker-${t.id}`,
      column === "agent_done" ? "status_agent_done" : "status_needs_input",
    );
  }
  const tip = ahead
    ? await gitOutput(
        stack.repo,
        "commit-tree",
        await gitOutput(stack.repo, "rev-parse", `${tree}^{tree}`),
        "-p",
        "main",
        "-m",
        `${t.id} work`,
      )
    : "main";
  await gitOutput(stack.repo, "branch", t.id, tip);
  return store.getCard(t.id)!;
}

const awaitingShip: LoopProgress = {
  ...FINISHED,
  units: FINISHED.units.map((u) => ({
    ...u,
    branch: null,
    phaseTotal: 1,
    phases: [
      {
        number: 1,
        name: "Ship it",
        gate: "pass",
        attempts: 1,
        passedAt: "2026-10-07T00:00:00.000Z",
      },
    ],
  })),
};

void test("start_ship answers 202 for a launched ticket card that is done, ahead and clean, and records shipped", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done", { tree: "unit-2" });
  assert.equal(card.source, "local");
  const reply = await shipOf(card, card.id);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  const flow = reply.body.flow as ShipFlow;
  assert.equal(flow.state, "running");
  assert.equal(flow.rights, "merge");
  assert.deepEqual(
    flow.branches.map((b) => b.name),
    [card.id],
  );
  await waitFor(
    () => Promise.resolve(store.getCard(card.id)?.shipFlow?.state === "done"),
    30_000,
    "flow done",
  );
  assert.equal(store.getCard(card.id)?.shipFlow?.branches[0]?.state, "merged");
  const shipped = store
    .listOrchestrationEvents(SBX, 0, 10_000)
    .filter(
      (e) =>
        e.kind === "group_state" &&
        e.cardId === card.id &&
        e.data.state === "shipped",
    );
  assert.equal(shipped.length, 1);
});

void test("start_ship answers 202 for a launched ticket card with Part A progress whose unit is built, awaiting /ship", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done", {
    tree: "test/ship-specs",
  });
  await store.setLoopProgress(card.id, awaitingShip);
  const reply = await shipOf(card, card.id);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  await waitFor(
    () => Promise.resolve(store.getCard(card.id)?.shipFlow?.state === "done"),
    30_000,
    "flow done",
  );
});

void test("start_ship answers 202 for a ticket card the user started from the board and the flow merges one PR", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done", {
    launched: false,
    tree: await freshTree("user-started-tree"),
  });
  assert.equal(card.launch, undefined);
  const reply = await shipOf(card, card.id);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  await waitFor(
    () => Promise.resolve(store.getCard(card.id)?.shipFlow?.state === "done"),
    30_000,
    "flow done",
  );
  const flow = store.getCard(card.id)?.shipFlow as ShipFlow;
  assert.equal(flow.branches.length, 1);
  assert.equal(flow.branches[0]?.state, "merged");
  assert.notEqual(flow.branches[0]?.pr, null);
});

void test("start_ship answers 400 not-group-card for a ticket card with no launch and no session branch", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await store.createLocalCard(SBX, "no session", "");
  await store.setCardWorkspace(card.id, {
    folder: stack.ws,
    repos: [{ path: stack.repo, base: "main" }],
  });
  const reply = await shipOf(store.getCard(card.id)!, card.id);
  assert.equal(reply.status, 400);
  assert.equal(reply.body.error, "not-group-card");
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship refuses a user-started ticket card in Done with already-shipped and in Inbox with card-not-done", async () => {
  await setPolicy({ shipRights: "merge" });
  for (const [column, error] of [
    ["done", "already-shipped"],
    ["inbox", "card-not-done"],
  ] as const) {
    const card = await launchedTicket("agent_done", { launched: false });
    await store.moveCardManual(card.id, column);
    assert.equal(store.getCard(card.id)?.column, column);
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 409, column);
    assert.equal(reply.body.error, error, column);
    assert.equal(store.getCard(card.id)?.shipFlow, undefined);
  }
});

void test("start_ship answers 403 policy-refused for a user-started ticket card when ship rights are none", async () => {
  const card = await launchedTicket("agent_done", { launched: false });
  await setPolicy({ shipRights: "none" });
  try {
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error, "policy-refused");
  } finally {
    await setPolicy({ shipRights: "merge" });
  }
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship answers 409 card-not-done for a launched ticket card in Needs input and In progress", async () => {
  await setPolicy({ shipRights: "merge" });
  for (const column of ["needs_input", null] as const) {
    const card = await launchedTicket(column);
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 409, String(column));
    assert.equal(reply.body.error, "card-not-done");
    assert.equal(store.getCard(card.id)?.shipFlow, undefined);
  }
});

void test("start_ship answers 400 invalid-branch-name for a launched ticket card and a branch that is not its session branch", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done");
  for (const name of ["unit-1", "main"]) {
    const reply = await shipOf(card, name);
    assert.equal(reply.status, 400, name);
    assert.equal(reply.body.error, "invalid-branch-name", name);
    assert.equal(reply.body.branch, name, name);
  }
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship answers 409 branch-not-ahead for a launched ticket card whose branch has no commit beyond the base", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done", { ahead: false });
  const reply = await shipOf(card, card.id);
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "branch-not-ahead");
  assert.equal(reply.body.branch, card.id);
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship answers 409 worktree-dirty for a launched ticket card with an untracked file", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done");
  const untracked = path.join(stack.worktree, "stray.txt");
  try {
    fs.writeFileSync(untracked, "x\n");
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 409);
    assert.equal(reply.body.error, "worktree-dirty");
  } finally {
    fs.rmSync(untracked, { force: true });
  }
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship answers 409 engine-not-closed for a launched ticket card with an engine file at its session root", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done");
  const engine = path.join(stack.ws, ".claude", "ralph-loop.local.md");
  try {
    fs.mkdirSync(path.dirname(engine), { recursive: true });
    fs.writeFileSync(engine, "---\nactive: true\n---\n");
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 409);
    assert.equal(reply.body.error, "engine-not-closed");
  } finally {
    fs.rmSync(engine, { force: true });
  }
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship answers 409 loop-not-finished for a launched ticket card whose unit is in progress", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done");
  await store.setLoopProgress(card.id, {
    ...awaitingShip,
    units: awaitingShip.units.map((u) => ({ ...u, status: "in progress" })),
  });
  const reply = await shipOf(card, card.id);
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "loop-not-finished");
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
});

void test("start_ship answers 403 policy-refused for a launched ticket card when ship rights are none", async () => {
  await setPolicy({ shipRights: "none" });
  try {
    const card = await launchedTicket("agent_done");
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error, "policy-refused");
    assert.equal(store.getCard(card.id)?.shipFlow, undefined);
  } finally {
    await setPolicy({ shipRights: "merge" });
  }
});

const doneFlow = (branchName: string): ShipFlow => ({
  state: "done",
  rights: "merge",
  repository: stack.repo,
  repo: null,
  orchestratorId: "orc-sbx",
  identity: { name: "Ship Test", email: "ship@example.com" },
  branches: [
    {
      ...branch(branchName),
      state: "merged",
      pr: null,
      checks: null,
      identity: null,
      admin: false,
      tip: null,
      checked: null,
    },
  ],
  failedStep: null,
  reason: null,
  decisionId: null,
  startedAt: "2026-10-07T00:00:00.000Z",
  finishedAt: "2026-10-07T00:01:00.000Z",
});

void test("start_ship refuses 409 already-shipped for a card whose ship flow is done", async () => {
  await setPolicy({ shipRights: "merge" });
  const ticket = await launchedTicket("agent_done");
  const group = await finishedGroup();
  for (const [card, name] of [
    [ticket, ticket.id],
    [group, "unit-1"],
  ] as const) {
    await store.setShipFlow(card.id, doneFlow(name));
    const reply = await shipOf(card, name);
    assert.equal(reply.status, 409, name);
    assert.equal(reply.body.error, "already-shipped", name);
    assert.deepEqual(store.getCard(card.id)?.shipFlow, doneFlow(name));
  }
});

async function settled(card: Card): Promise<ShipFlow> {
  await waitFor(
    () =>
      Promise.resolve(
        store.getCard(card.id)?.shipFlow !== undefined &&
          store.getCard(card.id)?.shipFlow?.state !== "running",
      ),
    30_000,
    "flow settled",
  );
  return store.getCard(card.id)!.shipFlow!;
}

/** Cut the branch `name` from `test/ship-specs` with one new file, so its tree is not on `main` yet. */
async function freshTree(name: string): Promise<string> {
  await gitOutput(
    stack.worktree,
    "checkout",
    "-q",
    "-b",
    name,
    "test/ship-specs",
  );
  fs.writeFileSync(path.join(stack.worktree, `${name}.txt`), `${name}\n`);
  await gitOutput(stack.worktree, "add", "-A");
  await gitOutput(stack.worktree, "commit", "-qm", `${name} work`);
  await gitOutput(stack.worktree, "checkout", "-q", "group-work");
  return name;
}

void test("start_ship writes one ship_stopped group_state row naming a launched ticket card whose PR checks fail", async () => {
  await setPolicy({ shipRights: "merge" });
  setGhScenario(gh.scenario, { checks: "fail" });
  try {
    const card = await launchedTicket("agent_done", {
      tree: await freshTree("stop-tree"),
    });
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 202, JSON.stringify(reply.body));
    const flow = await settled(card);
    assert.equal(flow.state, "stopped");
    const stopped = store
      .listOrchestrationEvents(SBX, 0, 10_000)
      .filter(
        (e) =>
          e.kind === "group_state" &&
          e.cardId === card.id &&
          e.data.state === "ship_stopped",
      );
    assert.equal(stopped.length, 1);
  } finally {
    setGhScenario(gh.scenario, { checks: "pass" });
  }
});

void test("start_ship refuses 409 ship-flow-running for a launched ticket card while another flow runs on the board", async () => {
  await setPolicy({ shipRights: "merge" });
  const other = await launchedTicket("agent_done");
  const card = await launchedTicket("agent_done");
  await store.setShipFlow(other.id, {
    ...doneFlow(other.id),
    state: "running",
    finishedAt: null,
  });
  try {
    const reply = await shipOf(card, card.id);
    assert.equal(reply.status, 409);
    assert.equal(reply.body.error, "ship-flow-running");
    assert.equal(store.getCard(card.id)?.shipFlow, undefined);
  } finally {
    await store.setShipFlow(other.id, {
      ...doneFlow(other.id),
      state: "stopped",
    });
  }
});

void test("start_ship answers 202 again for a card whose ship flow is stopped", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done", {
    tree: await freshTree("reship-tree"),
  });
  await store.setShipFlow(card.id, {
    ...doneFlow(card.id),
    state: "stopped",
    failedStep: "checking",
    reason: "check command failed",
  });
  const reply = await shipOf(card, card.id);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  const flow = await settled(card);
  assert.equal(flow.state, "done", flow.reason ?? "");
});

void test("start_ship does not refuse already-shipped for a card whose done flow is for another repository", async () => {
  await setPolicy({ shipRights: "merge" });
  const card = await launchedTicket("agent_done", {
    tree: await freshTree("other-repo-tree"),
  });
  await store.setShipFlow(card.id, {
    ...doneFlow(card.id),
    repository: path.join(stack.root, "another-repo"),
  });
  const reply = await shipOf(card, card.id);
  assert.equal(reply.status, 202, JSON.stringify(reply.body));
  assert.equal((reply.body.flow as ShipFlow).repository, stack.repo);
  await settled(card);
});
