import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv, waitFor } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";
import {
  setGhScenario,
  writeFakeGh,
  type FakeGhScenario,
} from "../../test-support/fake-gh.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type {
  BoardKey,
  BoardPolicy,
  Card,
  LoopProgress,
  LoopUnitStatus,
  ShipBranchState,
  ShipFlow,
} from "../../../shared/types.js";
import type { HttpError } from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { run } = await import("../../adapters/exec.js");
const { gitOutput, pushToBranch, pushToMain, shipStack, SHIP_IDENTITY } =
  await import("../../test-support/git-fixtures.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const {
  resumeShipFlows,
  shipTools,
  startShip: startShipFlow,
} = await import("./ship-flow.js");

const SBX = parseBoardKey("SBX") as BoardKey;
const ME = SHIP_IDENTITY;
const SPECS = "test/ship-specs";
const DIFF_ARGS = [
  "-c",
  "color.ui=never",
  "-c",
  "color.diff=never",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.srcPrefix=a/",
  "-c",
  "diff.dstPrefix=b/",
  "-c",
  "core.quotePath=false",
  "diff",
  "-".repeat(2) + "no-ext-diff",
];
const CALLER = { boardKey: SBX, orchestratorId: "orc-sbx" };
const roots: string[] = [];

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});

interface Call {
  cmd: string;
  args: string[];
  opts: { timeout?: number; maxBuffer?: number };
}
const calls: Call[] = [];
const afterCall: { hook: (call: Call) => Promise<void> } = {
  hook: () => Promise.resolve(),
};
shipTools.pollMs = 50;
shipTools.run = async (cmd, args, opts) => {
  const call = { cmd, args: [...args], opts: { ...opts } };
  calls.push(call);
  const out = await run(cmd, args, opts);
  await afterCall.hook(call);
  return out;
};

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  env.cleanup();
});

async function setPolicy(patch: Partial<BoardPolicy>): Promise<void> {
  await store.setBoardPolicy(SBX, { ...store.getBoard(SBX)!.policy, ...patch });
}

beforeEach(() => setPolicy({ shipRights: "merge" }));

function progress(
  statuses: LoopUnitStatus[],
  engine: LoopProgress["engine"] = null,
): LoopProgress {
  return {
    slug: "ship",
    roadmapFile: "units.md",
    units: statuses.map((status, i) => ({
      number: i + 1,
      ticket: null,
      title: `unit ${i + 1}`,
      status,
      statusText: status,
      branch: `unit-${i + 1}`,
      commit: null,
      prdPath: null,
      phaseTotal: null,
      phases: [],
    })),
    engine,
    completion: "complete",
    summary: {
      unitsDone: statuses.length,
      unitsTotal: statuses.length,
      currentUnit: null,
      currentPhase: null,
      lastGate: null,
    },
    warnings: [],
    readAt: "2026-10-07T00:00:00.000Z",
  };
}

interface Stack {
  card: Card;
  repo: string;
  bare: string;
  worktree: string;
  ghLog: string;
  ghScenario: string;
}

/** A fresh stack repository, the fake gh on PATH and a finished SBX group card that names it. */
async function newStack(
  opts: { checkCommand?: string; scenario?: FakeGhScenario } = {},
): Promise<Stack> {
  const { root, repo, ws, bare, worktree } = await shipStack();
  roots.push(root);
  await store.updateBoard(SBX, {
    repositories: [
      {
        path: repo,
        baseBranch: "main",
        checkCommand: opts.checkCommand ?? "git status",
      },
    ],
  });
  const { g } = await startedGroup(store, {
    board: SBX,
    workspacePath: ws,
    repos: [{ path: repo, base: "main" }],
  });
  await store.setLoopProgress(
    g.id,
    progress(["built, awaiting /ship", "shipped"]),
  );
  const gh = writeFakeGh(env.binDir, root);
  setGhScenario(gh.scenario, opts.scenario ?? { checks: "pass" });
  calls.length = 0;
  afterCall.hook = () => Promise.resolve();
  return {
    card: store.getCard(g.id)!,
    repo,
    bare,
    worktree,
    ghLog: gh.log,
    ghScenario: gh.scenario,
  };
}

const branchInput = (name: string) => ({
  name,
  title: `feat: ${name}`,
  body: `What: ${name}\nWhy: ship\nHow: tests`,
});

function startShip(stack: Stack, names: string[]): Promise<ShipFlow> {
  return startShipFlow(CALLER, store.getCard(stack.card.id)!, {
    repository: stack.repo,
    branches: names.map(branchInput),
  });
}

async function finished(card: Card): Promise<ShipFlow> {
  await waitFor(
    () =>
      Promise.resolve(store.getCard(card.id)?.shipFlow?.state !== "running"),
    30_000,
    "ship flow end",
  );
  return store.getCard(card.id)!.shipFlow!;
}

function ghCalls(stack: Stack): string[][] {
  if (!fs.existsSync(stack.ghLog)) return [];
  return fs
    .readFileSync(stack.ghLog, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as string[]);
}

/**
 * Assert the call log is safe and bounded.
 *
 * @remarks No rebase, no force, a push only of a commit to the ref of a branch, a checkout with the
 * no-guess option and the separator, diffs with fixed settings, a time limit and a 64 MiB buffer on
 * every call, and a local origin.
 */
async function assertSafeCalls(stack: Stack): Promise<void> {
  assert.ok(calls.length > 0);
  for (const { cmd, args, opts } of calls) {
    const line = `${cmd} ${args.join(" ")}`;
    assert.equal(args.includes("rebase"), false, line);
    assert.equal(
      args.some((a) => a.startsWith("-".repeat(2) + "force") || a === "-f"),
      false,
      line,
    );
    assert.equal(opts.maxBuffer, 64 * 1024 * 1024, line);
    const network =
      cmd === "git" && (args[0] === "push" || args[0] === "fetch");
    const timeout = cmd === "env" ? 30 * 60_000 : network ? 300_000 : 120_000;
    assert.equal(opts.timeout, timeout, line);
    if (cmd === "git" && args[0] === "push") {
      assert.equal(args.length, 4, line);
      assert.deepEqual(args.slice(0, 3), ["push", "-u", "origin"]);
      assert.match(args[3] ?? "", /^[0-9a-f]{40}:refs\/heads\/[^:]+$/);
    }
    if (cmd === "git" && args[0] === "checkout") {
      assert.equal(args.length, 4, line);
      assert.equal(args[1], "-".repeat(2) + "no-guess", line);
      assert.equal(args[3], "-".repeat(2), line);
    }
    if (cmd === "git" && args.includes("diff")) {
      assert.deepEqual(args.slice(0, DIFF_ARGS.length), DIFF_ARGS, line);
    }
  }
  const url = await gitOutput(stack.worktree, "remote", "get-url", "origin");
  assert.equal(fs.realpathSync(url), fs.realpathSync(stack.bare));
}

void test("startShip refuses each failed precondition and writes no flow", async () => {
  const stack = await newStack();
  const id = stack.card.id;
  const refused = async (
    status: number,
    code: string,
    reason?: string,
    card: Card = store.getCard(id)!,
    repository = stack.repo,
  ) => {
    await assert.rejects(
      startShipFlow(CALLER, card, {
        repository,
        branches: [branchInput("unit-1")],
      }),
      (err: HttpError) => {
        assert.equal(err.status, status);
        assert.equal(err.code, code);
        if (reason !== undefined) assert.equal(err.details?.reason, reason);
        return true;
      },
    );
    assert.equal(store.getCard(card.id)?.shipFlow, undefined);
  };
  const plain = await store.createLocalCard(SBX, "plain", "");
  await refused(400, "not-group-card", undefined, plain);

  await setPolicy({ shipRights: "none" });
  try {
    await refused(403, "policy-refused", "ship rights are none");
  } finally {
    await setPolicy({ shipRights: "merge" });
  }

  await refused(
    400,
    "unknown-repository",
    undefined,
    undefined,
    "/tmp/elsewhere",
  );

  await store.setLoopProgress(
    id,
    progress(["built, awaiting /ship", "in progress"]),
  );
  await refused(409, "loop-not-finished");
  await store.setLoopProgress(id, progress([]));
  await refused(409, "loop-not-finished");

  const engine = {
    active: true,
    iteration: 3,
    sessionId: null,
    handoffPending: false,
    startedAt: null,
    closed: false,
  };
  await store.setLoopProgress(id, progress(["shipped"], engine));
  await refused(409, "engine-not-closed");
  await store.setLoopProgress(
    id,
    progress(["shipped"], { ...engine, closed: true }),
  );

  const dep = await startedGroup(store, { board: SBX });
  await store.setGroupQueue(id, { startQueued: false, dependsOn: [dep.g.id] });
  await refused(409, "dependency-not-merged", dep.g.id);
  await store.setGroupQueue(id, { startQueued: false, dependsOn: [] });

  const other = await startedGroup(store, { board: SBX });
  const running: ShipFlow = {
    state: "running",
    rights: "merge",
    repository: stack.repo,
    repo: null,
    orchestratorId: "orc-sbx",
    identity: ME,
    branches: [],
    failedStep: null,
    reason: null,
    decisionId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  await store.setShipFlow(other.g.id, running);
  await refused(409, "ship-flow-running");
  await store.setShipFlow(other.g.id, { ...running, state: "stopped" });
  assert.deepEqual(calls, []);
});

void test("startShip refuses a card with no workspace and a repository with no git identity", async () => {
  const stack = await newStack();
  const card = store.getCard(stack.card.id)!;
  const input = { repository: stack.repo, branches: [branchInput("unit-1")] };
  const refused = (target: Card, code: string) =>
    assert.rejects(startShipFlow(CALLER, target, input), (err: HttpError) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, code);
      return true;
    });

  const unplaced = { ...card };
  delete unplaced.workspacePath;
  await refused(unplaced, "no-workspace");
  assert.equal(calls.length, 0);

  await gitOutput(stack.repo, "config", "--unset", "user.name");
  await gitOutput(stack.repo, "config", "--unset", "user.email");
  await refused(card, "no-git-identity");
  assert.equal(store.getCard(card.id)?.shipFlow, undefined);
  assert.ok(calls.every((c) => c.args[0] !== "push"));
});

function decisionsOf(cardId: string) {
  return store
    .listDecisionItems(SBX, "open")
    .filter((d) => d.cardId === cardId);
}

void test("with merge rights a two unit stack and its specs branch ship in order and the card moves to Done", async () => {
  const stack = await newStack();
  const started = await startShip(stack, ["unit-1", "unit-2", SPECS]);
  assert.equal(started.state, "running");
  assert.deepEqual(started.identity, ME);
  assert.deepEqual(
    started.branches.map((b) => b.state),
    ["queued", "queued", "queued"],
  );
  const flow = await finished(stack.card);
  assert.equal(flow.state, "done", flow.reason ?? "");
  assert.notEqual(flow.finishedAt, null);
  assert.deepEqual(
    flow.branches.map((b) => [
      b.name,
      b.state,
      b.pr,
      b.checks,
      b.identity,
      b.admin,
    ]),
    [
      ["unit-1", "merged", 1, "passed", "passed", false],
      ["unit-2", "merged", 2, "passed", "passed", false],
      [SPECS, "merged", 3, "passed", "passed", false],
    ],
  );
  const gh = ghCalls(stack);
  assert.deepEqual(
    gh.filter((a) => a[1] === "create").map((a) => a[a.indexOf("--head") + 1]),
    ["unit-1", "unit-2", SPECS],
  );
  assert.deepEqual(
    gh.filter((a) => a[1] === "merge"),
    [1, 2, 3].map((n, i) => [
      "pr",
      "merge",
      String(n),
      "--squash",
      "--subject",
      `feat: ${["unit-1", "unit-2", SPECS][i]} (#${n})`,
      "--body",
      "",
      "-".repeat(2) + "match-head-commit",
      flow.branches[i]?.checked,
    ]),
  );
  const pushes = calls.filter((c) => c.cmd === "git" && c.args[0] === "push");
  assert.deepEqual(
    pushes.map((c) => c.args[3]),
    flow.branches.map((b) => `${b.checked}:refs/heads/${b.name}`),
  );
  assert.ok(flow.branches.every((b) => /^[0-9a-f]{40}$/.test(b.checked ?? "")));
  assert.equal(flow.repo, null);
  assert.ok(gh.every((a) => !a.includes("-".repeat(2) + "repo")));
  const log = (
    await gitOutput(stack.bare, "log", "--format=%an|%s", "main")
  ).split("\n");
  assert.deepEqual(log.slice(0, 3), [
    `Ship Bot|feat: ${SPECS} (#3)`,
    "Ship Bot|feat: unit-2 (#2)",
    "Ship Bot|feat: unit-1 (#1)",
  ]);
  await waitFor(
    () => Promise.resolve(store.getCard(stack.card.id)?.column === "done"),
    5000,
    "card in Done",
  );
  assert.equal(decisionsOf(stack.card.id).length, 0);
  await assertSafeCalls(stack);
  const checkRuns = calls.filter((c) => c.cmd === "env");
  assert.equal(checkRuns.length, 3);
  assert.deepEqual(checkRuns[0]?.args, ["-u", "NODE_ENV", "git", "status"]);
});

void test("with open_prs rights the flow waits for the user merge and leaves the card in place", async () => {
  await setPolicy({ shipRights: "open_prs" });
  try {
    const stack = await newStack({
      scenario: { checks: "pending", pendingPolls: 2, userMergesAfterPolls: 3 },
    });
    const seen = new Set<string>();
    afterCall.hook = () => {
      for (const b of store.getCard(stack.card.id)?.shipFlow?.branches ?? []) {
        seen.add(b.state);
      }
      return Promise.resolve();
    };
    const started = await startShip(stack, ["unit-1"]);
    assert.equal(started.rights, "open_prs");
    const flow = await finished(stack.card);
    assert.equal(flow.state, "done", flow.reason ?? "");
    assert.equal(flow.branches[0]?.identity, "passed");
    assert.ok(seen.has("waiting_checks"));
    assert.ok(seen.has("waiting_merge"));
    const gh = ghCalls(stack);
    assert.equal(gh.filter((a) => a[1] === "merge").length, 0);
    assert.equal(
      gh.filter((a) => a[1] === "view" && a[4] === "state,statusCheckRollup")
        .length,
      3,
    );
    assert.equal(
      gh.filter((a) => a[1] === "view" && a[4] === "state").length,
      3,
    );
    assert.equal(store.getCard(stack.card.id)?.column, "in_progress");
    await assertSafeCalls(stack);
  } finally {
    await setPolicy({ shipRights: "merge" });
  }
});

void test("a wrong author merge stops at verifying with a decision item and later branches stay queued", async () => {
  const stack = await newStack({
    scenario: {
      checks: "pass",
      author: { name: "Web Flow", email: "noreply@example.com" },
    },
  });
  await startShip(stack, ["unit-1", "unit-2", SPECS]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "verifying");
  assert.equal(
    flow.reason,
    "author Web Flow <noreply@example.com> is not Ship Bot <ship@example.com>",
  );
  assert.deepEqual(
    flow.branches.map((b) => [b.state, b.identity]),
    [
      ["failed", "failed"],
      ["queued", null],
      ["queued", null],
    ],
  );
  const [item, ...rest] = decisionsOf(stack.card.id);
  assert.equal(rest.length, 0);
  assert.equal(item?.id, flow.decisionId);
  assert.equal(item?.kind, "ship_failure");
  assert.equal(item?.orchestratorId, "orc-sbx");
  assert.equal(item?.recommendedOptionId, "retry");
  assert.deepEqual(
    item?.options.map((o) => o.id),
    ["retry", "stop"],
  );
  assert.equal(
    item?.question,
    `Ship stopped at verifying on unit-1: ${flow.reason}`,
  );
  assert.equal(ghCalls(stack).filter((a) => a[1] === "create").length, 1);
  assert.equal(store.getCard(stack.card.id)?.column, "in_progress");
  await assertSafeCalls(stack);
});

void test("a Co-Authored-By line on the merged commit stops at verifying", async () => {
  const stack = await newStack({
    scenario: { checks: "pass", coAuthor: true },
  });
  await startShip(stack, ["unit-1", "unit-2", SPECS]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "verifying");
  assert.equal(flow.reason, "commit has a Co-Authored-By line");
  assert.deepEqual(
    flow.branches.map((b) => [b.state, b.identity]),
    [
      ["failed", "failed"],
      ["queued", null],
      ["queued", null],
    ],
  );
  const [item, ...rest] = decisionsOf(stack.card.id);
  assert.equal(rest.length, 0);
  assert.equal(item?.id, flow.decisionId);
  assert.equal(item?.kind, "ship_failure");
  assert.equal(ghCalls(stack).filter((a) => a[1] === "create").length, 1);
  await assertSafeCalls(stack);
});

void test("a failing check command stops at checking before any push", async () => {
  const stack = await newStack({ checkCommand: "node -e process.exit(3)" });
  await startShip(stack, ["unit-1", "unit-2"]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "checking");
  assert.match(flow.reason ?? "", /^check command failed/);
  assert.deepEqual(
    flow.branches.map((b) => b.state),
    ["failed", "queued"],
  );
  assert.equal(
    calls.some((c) => c.args[0] === "push"),
    false,
  );
  assert.deepEqual(ghCalls(stack), []);
  assert.equal(decisionsOf(stack.card.id).length, 1);
});

void test("a signature rule refusal merges once more as admin and records it", async () => {
  const stack = await newStack({
    scenario: { checks: "pass", signatureBlock: true },
  });
  await startShip(stack, ["unit-1"]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "done", flow.reason ?? "");
  assert.equal(flow.branches[0]?.admin, true);
  const merges = ghCalls(stack).filter((a) => a[1] === "merge");
  assert.equal(merges.length, 2);
  assert.equal(merges[0]?.includes("--admin"), false);
  assert.equal(merges[1]?.at(-1), "--admin");
  await assertSafeCalls(stack);
});

void test("failed PR checks stop the flow at waiting_checks", async () => {
  const stack = await newStack({ scenario: { checks: "fail" } });
  await startShip(stack, ["unit-1"]);
  const flow = await finished(stack.card);
  assert.equal(flow.failedStep, "waiting_checks");
  assert.equal(flow.branches[0]?.checks, "failed");
  assert.equal(
    ghCalls(stack).some((a) => a[1] === "merge"),
    false,
  );
});

void test("a merge conflict with main stops at merging_main and aborts the merge", async () => {
  const stack = await newStack();
  await pushToMain(stack.bare, { "a.txt": "main side\n" }, "main edit");
  await startShip(stack, ["unit-1", "unit-2"]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "merging_main");
  assert.deepEqual(
    flow.branches.map((b) => b.state),
    ["failed", "queued"],
  );
  assert.equal(await gitOutput(stack.worktree, "status", "--porcelain"), "");
  assert.ok(calls.some((c) => c.args.join(" ") === "merge --abort"));
  assert.equal(
    calls.some((c) => c.args[0] === "push"),
    false,
  );
  assert.deepEqual(ghCalls(stack), []);
});

void test("the subset check stops at checking when a branch carries a file only an earlier branch changed", async () => {
  const stack = await newStack();
  afterCall.hook = async (call) => {
    if (call.cmd === "gh" && call.args[1] === "merge") {
      await pushToMain(stack.bare, { "a.txt": null }, "drop a");
    }
  };
  await startShip(stack, ["unit-1", "unit-2"]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "checking");
  assert.equal(flow.reason, "files outside this branch: a.txt");
  assert.deepEqual(
    flow.branches.map((b) => b.state),
    ["merged", "failed"],
  );
  assert.equal(ghCalls(stack).filter((a) => a[1] === "create").length, 1);
  await assertSafeCalls(stack);
});

void test("in the Dispatch repository an em dash in an added doc line stops at checking under any diff config", async () => {
  const stack = await newStack();
  const inTree = (...args: string[]) => gitOutput(stack.worktree, ...args);
  await inTree("config", "diff.noprefix", "true");
  await inTree("config", "color.ui", "always");
  await inTree("config", "diff.mnemonicPrefix", "true");
  await inTree("checkout", "-q", "unit-1");
  fs.writeFileSync(
    path.join(stack.worktree, "package.json"),
    JSON.stringify({ name: "@theyashgupta/dispatch" }),
  );
  fs.mkdirSync(path.join(stack.worktree, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(stack.worktree, "docs", "x.md"),
    `a ${String.fromCharCode(0x2014)} b\n`,
  );
  await inTree("add", "-A");
  await inTree("commit", "-qm", "prose");
  await inTree("checkout", "-q", "group-work");
  await startShip(stack, ["unit-1"]);
  const flow = await finished(stack.card);
  assert.equal(flow.failedStep, "checking");
  assert.equal(
    flow.reason,
    "prose rule: 1 violations, first em-dash in docs/x.md",
  );
  assert.equal(
    calls.some((c) => c.args[0] === "push"),
    false,
  );
});

void test("resumeShipFlows finishes a stored running flow from its stored tips without a second PR", async () => {
  const stack = await newStack();
  const inTree = (...args: string[]) => gitOutput(stack.worktree, ...args);
  const tip1 = await inTree("rev-parse", "unit-1");
  const tip2 = await inTree("rev-parse", "unit-2");
  const tip3 = await inTree("rev-parse", SPECS);
  await pushToMain(stack.bare, { "a.txt": "unit-1\n" }, "feat: unit-1 (#1)");
  await inTree("checkout", "-q", "unit-2");
  await inTree("fetch", "-q", "origin");
  await inTree("merge", "-q", "--no-edit", "origin/main");
  await inTree("push", "-q", "-u", "origin", "unit-2");
  const checked2 = await inTree("rev-parse", "HEAD");
  fs.writeFileSync(
    path.join(path.dirname(stack.ghLog), "gh-state.json"),
    JSON.stringify({
      next: 3,
      prs: {
        "2": {
          head: "unit-2",
          title: "feat: unit-2",
          state: "OPEN",
          polls: 0,
          mergePolls: 0,
        },
      },
    }),
  );
  const shipBranch = (
    name: string,
    fields: Partial<ShipFlow["branches"][number]>,
  ) => ({
    ...branchInput(name),
    state: "queued" as const,
    pr: null,
    checks: null,
    identity: null,
    admin: false,
    tip: null,
    checked: null,
    ...fields,
  });
  await store.setShipFlow(stack.card.id, {
    state: "running",
    rights: "merge",
    repository: stack.repo,
    repo: "acme/app",
    orchestratorId: "orc-sbx",
    identity: ME,
    branches: [
      shipBranch("unit-1", {
        state: "merged",
        pr: 1,
        checks: "passed",
        identity: "passed",
        tip: tip1,
      }),
      shipBranch("unit-2", {
        state: "waiting_checks",
        pr: 2,
        checks: "pending",
        tip: tip2,
        checked: checked2,
      }),
      shipBranch(SPECS, {}),
    ],
    failedStep: null,
    reason: null,
    decisionId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  resumeShipFlows();
  const flow = await finished(stack.card);
  assert.equal(flow.state, "done", flow.reason ?? "");
  assert.deepEqual(
    flow.branches.map((b) => [b.name, b.state, b.pr, b.tip]),
    [
      ["unit-1", "merged", 1, tip1],
      ["unit-2", "merged", 2, tip2],
      [SPECS, "merged", 3, tip3],
    ],
  );
  const gh = ghCalls(stack);
  assert.deepEqual(
    gh.filter((a) => a[1] === "create").map((a) => a[a.indexOf("--head") + 1]),
    [SPECS],
  );
  assert.deepEqual(
    gh.filter((a) => a[1] === "merge").map((a) => a[2]),
    ["2", "3"],
  );
  const diffs = calls
    .filter((c) => c.cmd === "git" && c.args.includes("diff"))
    .map((c) => c.args.join(" "));
  assert.ok(
    diffs.includes(
      [...DIFF_ARGS, `${"-".repeat(2)}name-only`, tip2, tip3].join(" "),
    ),
  );
  assert.equal(
    calls.some((c) => c.args[0] === "merge-base"),
    false,
  );
  assert.deepEqual(
    calls.filter((c) => c.args[0] === "push").map((c) => c.args[3]),
    [`${flow.branches[2]?.checked}:refs/heads/${SPECS}`],
  );
  assert.ok(gh.length > 0);
  for (const argv of gh) {
    assert.deepEqual(argv.slice(-2), ["-".repeat(2) + "repo", "acme/app"]);
  }
  await assertSafeCalls(stack);
});

async function refusedBranches(
  stack: Stack,
  names: string[],
  code = "invalid-branch-name",
): Promise<void> {
  await assert.rejects(startShip(stack, names), (err: HttpError) => {
    assert.equal(err.status, 400, names.join(","));
    assert.equal(err.code, code, names.join(","));
    return true;
  });
  assert.equal(store.getCard(stack.card.id)?.shipFlow, undefined);
}

void test("startShip refuses a branch that is not a unit or specs branch, a reserved or base name and a remote-only branch", async () => {
  const stack = await newStack();
  const units = (...branches: string[]) =>
    store.setLoopProgress(stack.card.id, {
      ...progress(branches.map(() => "built, awaiting /ship")),
      units: progress(branches.map(() => "built, awaiting /ship")).units.map(
        (u, i) => ({ ...u, branch: branches[i] ?? null }),
      ),
    });
  await refusedBranches(stack, ["group-work"]);
  await refusedBranches(stack, ["unit-1", "test/other-specs"]);
  for (const name of ["main", "master", "HEAD", "refs/heads/main"]) {
    await units("unit-1", name);
    await refusedBranches(stack, [name]);
  }
  await store.setCardWorkspace(stack.card.id, {
    folder: path.dirname(stack.worktree),
    repos: [{ path: stack.repo, base: "unit-2" }],
  });
  await units("unit-1", "unit-2");
  await refusedBranches(stack, ["unit-1", "unit-2"]);
  await store.setCardWorkspace(stack.card.id, {
    folder: path.dirname(stack.worktree),
    repos: [{ path: stack.repo, base: "main" }],
  });
  await gitOutput(
    stack.worktree,
    "push",
    "-q",
    "origin",
    "unit-1:refs/heads/remote-only",
  );
  await units("unit-1", "remote-only");
  calls.length = 0;
  await refusedBranches(stack, ["unit-1", "remote-only"]);
  assert.deepEqual(
    calls.map((c) => c.args.join(" ")),
    [
      `rev-parse ${"-".repeat(2)}verify ${"-".repeat(2)}quiet refs/heads/unit-1`,
      `rev-parse ${"-".repeat(2)}verify ${"-".repeat(2)}quiet refs/heads/remote-only`,
    ],
  );
  assert.equal(
    (await gitOutput(stack.worktree, "branch", "--list", "remote-only")).trim(),
    "",
  );
});

void test("startShip refuses a repository with no board entry", async () => {
  const stack = await newStack();
  await store.updateBoard(SBX, { repositories: [] });
  await refusedBranches(stack, ["unit-1"], "unknown-repository");
  assert.deepEqual(calls, []);
});

void test("an empty check rollup waits 3 polls, then counts as passed", async () => {
  const stack = await newStack({ scenario: { checks: "none" } });
  await startShip(stack, ["unit-1"]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "done", flow.reason ?? "");
  const gh = ghCalls(stack);
  const views = gh.findIndex((a) => a[1] === "merge");
  assert.equal(gh.slice(0, views).filter((a) => a[1] === "view").length, 4);
  await assertSafeCalls(stack);
});

void test("a new start_ship reuses the open PR of a branch in place of a second create", async () => {
  const stack = await newStack();
  await gitOutput(stack.worktree, "push", "-q", "origin", "unit-1");
  fs.writeFileSync(
    path.join(path.dirname(stack.ghLog), "gh-state.json"),
    JSON.stringify({
      next: 8,
      prs: {
        "7": {
          head: "unit-1",
          title: "feat: unit-1",
          state: "OPEN",
          polls: 0,
          mergePolls: 0,
        },
      },
    }),
  );
  await startShip(stack, ["unit-1", "unit-2"]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "done", flow.reason ?? "");
  assert.deepEqual(
    flow.branches.map((b) => [b.name, b.pr]),
    [
      ["unit-1", 7],
      ["unit-2", 8],
    ],
  );
  const gh = ghCalls(stack);
  assert.deepEqual(
    gh.filter((a) => a[1] === "list"),
    ["unit-1", "unit-2"].map((name) => [
      "pr",
      "list",
      "-".repeat(2) + "head",
      name,
      "-".repeat(2) + "base",
      "main",
      "-".repeat(2) + "state",
      "open",
      "-".repeat(2) + "json",
      "number,baseRefName,isCrossRepository,headRefOid",
    ]),
  );
  assert.deepEqual(
    gh.filter((a) => a[1] === "create").map((a) => a[a.indexOf("--head") + 1]),
    ["unit-2"],
  );
  await assertSafeCalls(stack);
});

void test("ship rights set to none during a flow stop it at the current step", async () => {
  try {
    const stack = await newStack({
      scenario: { checks: "pending", pendingPolls: 50 },
    });
    afterCall.hook = async (call) => {
      if (call.cmd === "gh" && call.args[1] === "view") {
        await setPolicy({ shipRights: "none" });
      }
    };
    await startShip(stack, ["unit-1", "unit-2"]);
    const flow = await finished(stack.card);
    assert.equal(flow.state, "stopped");
    assert.equal(flow.failedStep, "waiting_checks");
    assert.equal(flow.reason, "ship rights were removed");
    assert.deepEqual(
      flow.branches.map((b) => b.state),
      ["failed", "queued"],
    );
    assert.equal(ghCalls(stack).filter((a) => a[1] === "view").length, 1);
  } finally {
    await setPolicy({ shipRights: "merge" });
  }
});

void test("ship rights lowered to open_prs during a flow wait for the user merge and never merge", async () => {
  try {
    const stack = await newStack({
      scenario: { checks: "pending", pendingPolls: 1, userMergesAfterPolls: 1 },
    });
    afterCall.hook = async (call) => {
      if (call.cmd === "gh" && call.args[1] === "view") {
        await setPolicy({ shipRights: "open_prs" });
      }
    };
    const started = await startShip(stack, ["unit-1"]);
    assert.equal(started.rights, "merge");
    const flow = await finished(stack.card);
    assert.equal(flow.state, "done", flow.reason ?? "");
    assert.equal(flow.rights, "open_prs");
    assert.equal(
      ghCalls(stack).some((a) => a[1] === "merge"),
      false,
    );
    assert.equal(store.getCard(stack.card.id)?.column, "in_progress");
  } finally {
    await setPolicy({ shipRights: "merge" });
  }
});

void test("a failed PR poll is retried, and 5 failures in a row stop the flow", async () => {
  const flaky = await newStack({ scenario: { checks: "pass", failViews: 4 } });
  await startShip(flaky, ["unit-1"]);
  const ok = await finished(flaky.card);
  assert.equal(ok.state, "done", ok.reason ?? "");

  const down = await newStack({ scenario: { checks: "pass", failViews: 5 } });
  await startShip(down, ["unit-1"]);
  const flow = await finished(down.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "waiting_checks");
  assert.equal(
    flow.reason,
    "PR poll failed 5 times: fake gh: error connecting to api.github.com",
  );
});

void test("a worktree with uncommitted changes stops at merging_main before any checkout", async () => {
  const stack = await newStack();
  fs.writeFileSync(path.join(stack.worktree, "README.md"), "edited\n");
  await startShip(stack, ["unit-1"]);
  const flow = await finished(stack.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "merging_main");
  assert.equal(flow.reason, "worktree has uncommitted changes");
  assert.equal(
    calls.some((c) => c.args[0] === "checkout" || c.args[0] === "fetch"),
    false,
  );
  assert.equal(
    await gitOutput(stack.worktree, "rev-parse", "--abbrev-ref", "HEAD"),
    "group-work",
  );
});

void test("a runner that throws in its stop handler is stored as stopped with the error line", async () => {
  const stack = await newStack();
  afterCall.hook = (call) =>
    call.args[0] === "fetch"
      ? Promise.reject(new Error("fetch broke"))
      : Promise.resolve();
  const insert = store.insertDecisionItem.bind(store);
  store.insertDecisionItem = () => {
    throw new Error("decision store is down\nsecond line");
  };
  try {
    await startShip(stack, ["unit-1"]);
    await waitFor(
      () =>
        Promise.resolve(
          store.getCard(stack.card.id)?.shipFlow?.state !== "running",
        ),
      5000,
      "flow leaves running",
    );
  } finally {
    store.insertDecisionItem = insert;
  }
  const flow = store.getCard(stack.card.id)!.shipFlow!;
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "merging_main");
  assert.equal(flow.reason, "decision store is down");
  assert.notEqual(flow.finishedAt, null);
  assert.equal(decisionsOf(stack.card.id).length, 0);
});

/** Store one open PR 7 for `head` in the fake gh state, with the given extra fields. */
function seedPr(stack: Stack, head: string, extra: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(path.dirname(stack.ghLog), "gh-state.json"),
    JSON.stringify({
      next: 8,
      prs: {
        "7": {
          head,
          title: `feat: ${head}`,
          state: "OPEN",
          polls: 0,
          mergePolls: 0,
          ...extra,
        },
      },
    }),
  );
}

void test("an open PR into another base, from a fork or with a stale head is not reused", async () => {
  for (const extra of [
    { base: "base/other" },
    { cross: true },
    { headRefOid: "0".repeat(40) },
  ]) {
    const stack = await newStack();
    seedPr(stack, "unit-1", extra);
    await startShip(stack, ["unit-1"]);
    const flow = await finished(stack.card);
    assert.equal(flow.state, "done", `${JSON.stringify(extra)} ${flow.reason}`);
    assert.equal(flow.branches[0]?.pr, 8, JSON.stringify(extra));
    const gh = ghCalls(stack);
    assert.equal(gh.filter((a) => a[1] === "create").length, 1);
    assert.deepEqual(
      gh.filter((a) => a[1] === "merge").map((a) => a[2]),
      ["8"],
    );
  }
});

void test("a resumed flow whose HEAD is not the checked commit stops before it pushes", async () => {
  const stack = await newStack();
  const tip1 = await gitOutput(stack.worktree, "rev-parse", "unit-1");
  const tip2 = await gitOutput(stack.worktree, "rev-parse", "unit-2");
  await gitOutput(stack.worktree, "checkout", "-q", "unit-2");
  await store.setShipFlow(stack.card.id, {
    state: "running",
    rights: "merge",
    repository: stack.repo,
    repo: null,
    orchestratorId: "orc-sbx",
    identity: ME,
    branches: [
      {
        ...branchInput("unit-1"),
        state: "pushing",
        pr: null,
        checks: null,
        identity: null,
        admin: false,
        tip: tip1,
        checked: tip1,
      },
    ],
    failedStep: null,
    reason: null,
    decisionId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  resumeShipFlows();
  const flow = await finished(stack.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, "pushing");
  assert.equal(flow.reason, "branch moved since the check");
  assert.notEqual(tip1, tip2);
  assert.equal(
    calls.some((c) => c.args[0] === "push"),
    false,
  );
  assert.deepEqual(ghCalls(stack), []);
  assert.equal(decisionsOf(stack.card.id).length, 1);
});

void test("a runner whose card is gone stops with no write, no decision item and no merge", async () => {
  const stack = await newStack({
    scenario: { checks: "pending", pendingPolls: 1000 },
  });
  const id = stack.card.id;
  let unwound = false;
  afterCall.hook = async (call) => {
    if (!unwound && call.cmd === "gh" && call.args[1] === "view") {
      unwound = true;
      assert.equal((await store.unwindGroup(id, "todo")).ok, true);
    }
  };
  await startShip(stack, ["unit-1", "unit-2"]);
  await waitFor(() => Promise.resolve(unwound), 30_000, "card unwound");
  await new Promise((r) => setTimeout(r, 400));
  const views = ghCalls(stack).filter((a) => a[1] === "view").length;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(ghCalls(stack).filter((a) => a[1] === "view").length, views);
  assert.equal(views, 1);
  assert.equal(store.getCard(id), undefined);
  assert.equal(
    ghCalls(stack).some((a) => a[1] === "merge"),
    false,
  );
  assert.equal(decisionsOf(id).length, 0);
  for (const board of store.listBoards()) {
    assert.deepEqual(
      store.listDecisionItems(board.key).filter((d) => d.cardId === id),
      [],
    );
  }
});

void test("a resumed flow on a card with no workspace path stops with a decision item and runs no git", async () => {
  const a = await store.createLocalCard(SBX, "nows a", "");
  const b = await store.createLocalCard(SBX, "nows b", "");
  const made = await store.createGroupCard(SBX, "no workspace", [a.id, b.id]);
  assert.ok(made.ok);
  const id = made.card.id;
  assert.equal(store.getCard(id)?.workspacePath, undefined);
  calls.length = 0;
  await store.setShipFlow(id, {
    state: "running",
    rights: "merge",
    repository: "/tmp/no-repo",
    repo: null,
    orchestratorId: "orc-sbx",
    identity: ME,
    branches: [
      {
        ...branchInput("unit-1"),
        state: "waiting_checks",
        pr: 3,
        checks: "pending",
        identity: null,
        admin: false,
        tip: "a".repeat(40),
        checked: "a".repeat(40),
      },
    ],
    failedStep: null,
    reason: null,
    decisionId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  resumeShipFlows();
  const flow = await finished(made.card);
  assert.equal(flow.state, "stopped");
  assert.equal(flow.reason, "group has no workspace");
  assert.equal(flow.failedStep, "waiting_checks");
  assert.deepEqual(calls, []);
  const [item] = decisionsOf(id);
  assert.equal(item?.id, flow.decisionId);
});

void test("a refused move to Done keeps the flow done and raises one manual move item", async () => {
  const stack = await newStack();
  const move = store.moveCardManual.bind(store);
  store.moveCardManual = () => Promise.reject(new Error("board store is down"));
  try {
    await startShip(stack, ["unit-1"]);
    const flow = await finished(stack.card);
    assert.equal(flow.state, "done", flow.reason ?? "");
    await waitFor(
      () =>
        Promise.resolve(
          store.getCard(stack.card.id)?.shipFlow?.decisionId != null,
        ),
      5000,
      "manual move item",
    );
  } finally {
    store.moveCardManual = move;
  }
  const flow = store.getCard(stack.card.id)!.shipFlow!;
  assert.equal(flow.state, "done");
  assert.equal(store.getCard(stack.card.id)?.column, "in_progress");
  const items = decisionsOf(stack.card.id);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, flow.decisionId);
  assert.equal(items[0]?.kind, "ship_failure");
  assert.equal(
    items[0]?.question,
    "Every branch merged, but the move to Done failed: board store is down. Move the group to Done by hand.",
  );
});

void test("startShip refuses a missing worktree before any git call and an empty identity value", async () => {
  const stack = await newStack();
  const input = { repository: stack.repo, branches: [branchInput("unit-1")] };
  const refused = (code: string) =>
    assert.rejects(
      startShipFlow(CALLER, store.getCard(stack.card.id)!, input),
      (err: HttpError) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, code);
        return true;
      },
    );
  await gitOutput(stack.repo, "config", "user.email", "");
  await refused("no-git-identity");
  await gitOutput(stack.repo, "config", "user.email", ME.email);
  await gitOutput(stack.repo, "config", "user.name", "");
  await refused("no-git-identity");
  await gitOutput(stack.repo, "config", "user.name", ME.name);
  assert.equal(store.getCard(stack.card.id)?.shipFlow, undefined);
  fs.rmSync(stack.worktree, { recursive: true, force: true });
  calls.length = 0;
  await refused("no-workspace");
  assert.deepEqual(calls, []);
  assert.equal(store.getCard(stack.card.id)?.shipFlow, undefined);
});

const ADMIN = "-".repeat(2) + "admin";

/** Assert the flow stopped at `step` with `reason` and one `ship_failure` item, and return the merge calls. */
function assertStoppedAt(
  stack: Stack,
  flow: ShipFlow,
  step: ShipBranchState,
  reason: string | RegExp,
): string[][] {
  assert.equal(flow.state, "stopped");
  assert.equal(flow.failedStep, step);
  if (typeof reason === "string") assert.equal(flow.reason, reason);
  else assert.match(flow.reason ?? "", reason);
  assert.equal(decisionsOf(stack.card.id).length, 1);
  return ghCalls(stack).filter((a) => a[1] === "merge");
}

void test("a merge block that is not the signature rule gets no admin retry and stops at merging", async () => {
  const blocked =
    "GraphQL: Pull request is not mergeable: the base branch policy prohibits the merge. (mergePullRequest)";
  const stack = await newStack({
    scenario: { checks: "pass", mergeError: blocked },
  });
  await startShip(stack, ["unit-1", "unit-2"]);
  const flow = await finished(stack.card);
  const merges = assertStoppedAt(stack, flow, "merging", blocked);
  assert.equal(merges.length, 1);
  assert.equal(merges[0]?.includes(ADMIN), false);
  assert.equal(flow.branches[0]?.admin, false);
  assert.deepEqual(
    flow.branches.map((b) => b.state),
    ["failed", "queued"],
  );
});

void test("an admin retry that itself fails stops at merging and records no admin merge", async () => {
  const denied =
    "GraphQL: Administrators cannot bypass this rule. (mergePullRequest)";
  const stack = await newStack({
    scenario: { checks: "pass", signatureBlock: true, adminError: denied },
  });
  await startShip(stack, ["unit-1", "unit-2"]);
  const flow = await finished(stack.card);
  const merges = assertStoppedAt(stack, flow, "merging", denied);
  assert.equal(merges.length, 2);
  assert.equal(merges[0]?.includes(ADMIN), false);
  assert.equal(merges[1]?.at(-1), ADMIN);
  assert.equal(flow.branches[0]?.admin, false);
  assert.deepEqual(
    flow.branches.map((b) => b.state),
    ["failed", "queued"],
  );
});

void test("a plain merge failure stops at merging with the first stderr line", async () => {
  const stack = await newStack({
    scenario: {
      checks: "pass",
      mergeError: "fake gh: error connecting to api.github.com\nsecond line",
    },
  });
  await startShip(stack, ["unit-1"]);
  const flow = await finished(stack.card);
  const merges = assertStoppedAt(
    stack,
    flow,
    "merging",
    "fake gh: error connecting to api.github.com",
  );
  assert.equal(merges.length, 1);
  assert.equal(flow.branches[0]?.state, "failed");
});

void test("a push to the PR branch after the check makes the pinned merge fail and the flow stops", async () => {
  const stack = await newStack();
  let pushed = false;
  afterCall.hook = async (call) => {
    if (
      !pushed &&
      call.cmd === "gh" &&
      call.args[4] === "state,statusCheckRollup"
    ) {
      pushed = true;
      await pushToBranch(
        stack.bare,
        "unit-1",
        { "late.txt": "late\n" },
        "late",
      );
    }
  };
  await startShip(stack, ["unit-1"]);
  const flow = await finished(stack.card);
  assert.equal(pushed, true);
  const merges = assertStoppedAt(
    stack,
    flow,
    "merging",
    /^GraphQL: Head branch was modified/,
  );
  assert.equal(merges.length, 1);
  assert.equal(merges[0]?.includes(ADMIN), false);
  assert.equal(
    merges[0]?.at(-1),
    flow.branches[0]?.checked,
    "the merge names the checked commit",
  );
  const log = await gitOutput(stack.bare, "log", "--format=%s", "main");
  assert.equal(log.includes("feat: unit-1"), false);
});

void test("a PR closed without a merge stops at waiting_merge", async () => {
  await setPolicy({ shipRights: "open_prs" });
  try {
    const stack = await newStack({
      scenario: { checks: "pass", prState: "CLOSED" },
    });
    await startShip(stack, ["unit-1", "unit-2"]);
    const flow = await finished(stack.card);
    const merges = assertStoppedAt(
      stack,
      flow,
      "waiting_merge",
      "PR was closed without a merge",
    );
    assert.equal(merges.length, 0);
    assert.deepEqual(
      flow.branches.map((b) => b.state),
      ["failed", "queued"],
    );
  } finally {
    await setPolicy({ shipRights: "merge" });
  }
});

function storeRunning(
  stack: Stack,
  fields: Partial<ShipFlow["branches"][number]>,
): Promise<void> {
  return store.setShipFlow(stack.card.id, {
    state: "running",
    rights: "merge",
    repository: stack.repo,
    repo: null,
    orchestratorId: "orc-sbx",
    identity: ME,
    branches: [
      {
        ...branchInput("unit-1"),
        state: "queued",
        pr: null,
        checks: null,
        identity: null,
        admin: false,
        tip: null,
        checked: null,
        ...fields,
      },
    ],
    failedStep: null,
    reason: null,
    decisionId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
}

for (const state of ["checking", "merging", "waiting_merge"] as const) {
  void test(`a resumed flow at ${state} whose HEAD is not the checked commit stops with branch moved since the check`, async () => {
    const stack = await newStack();
    const tip1 = await gitOutput(stack.worktree, "rev-parse", "unit-1");
    await gitOutput(stack.worktree, "checkout", "-q", "unit-2");
    await storeRunning(stack, { state, pr: 1, tip: tip1, checked: tip1 });
    resumeShipFlows();
    const flow = await finished(stack.card);
    assertStoppedAt(stack, flow, state, "branch moved since the check");
    assert.equal(
      calls.some((c) => c.cmd === "env" || c.args[0] === "push"),
      false,
    );
    assert.deepEqual(ghCalls(stack), []);
  });
}

void test("a resumed flow whose board rights fell to open_prs waits for the user merge and does not merge", async () => {
  await setPolicy({ shipRights: "open_prs" });
  try {
    const stack = await newStack({
      scenario: { checks: "pass", userMergesAfterPolls: 1 },
    });
    await gitOutput(stack.worktree, "checkout", "-q", "unit-1");
    await gitOutput(stack.worktree, "push", "-q", "origin", "unit-1");
    const tip1 = await gitOutput(stack.worktree, "rev-parse", "unit-1");
    seedPr(stack, "unit-1", {});
    await storeRunning(stack, {
      state: "merging",
      pr: 7,
      checks: "passed",
      tip: tip1,
      checked: tip1,
    });
    resumeShipFlows();
    const flow = await finished(stack.card);
    assert.equal(flow.state, "done", flow.reason ?? "");
    assert.equal(flow.rights, "open_prs");
    assert.deepEqual(
      flow.branches.map((b) => [b.state, b.pr, b.admin]),
      [["merged", 7, false]],
    );
    assert.equal(
      ghCalls(stack).some((a) => a[1] === "merge"),
      false,
    );
    assert.equal(store.getCard(stack.card.id)?.column, "in_progress");
  } finally {
    await setPolicy({ shipRights: "merge" });
  }
});

void test("two overlapping start_ship calls on one board start one flow and refuse the other", async () => {
  const stack = await newStack();
  const other = await startedGroup(store, {
    board: SBX,
    workspacePath: path.dirname(stack.worktree),
    repos: [{ path: stack.repo, base: "main" }],
  });
  await store.setLoopProgress(
    other.g.id,
    progress(["built, awaiting /ship", "shipped"]),
  );
  const input = { repository: stack.repo, branches: [branchInput("unit-1")] };
  const results = await Promise.allSettled([
    startShipFlow(CALLER, store.getCard(stack.card.id)!, input),
    startShipFlow(CALLER, store.getCard(other.g.id)!, input),
  ]);
  const [first, second] = results;
  assert.equal(first?.status, "fulfilled");
  assert.ok(second?.status === "rejected");
  const refusal = second.reason as HttpError;
  assert.equal(refusal.status, 409);
  assert.equal(refusal.code, "ship-flow-running");
  const flow = await finished(stack.card);
  assert.equal(flow.state, "done", flow.reason ?? "");
  assert.equal(store.getCard(other.g.id)?.shipFlow, undefined);
  assert.equal(ghCalls(stack).filter((a) => a[1] === "create").length, 1);
});
