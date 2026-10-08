import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, BoardPolicy } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";
import {
  ConflictError,
  NotFoundError,
  PolicyError,
  ValidationError,
} from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { gitOutput, tempRepoWithWorkspace } =
  await import("../../test-support/git-fixtures.js");
const { resolveBoard } = await import("./boards.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const {
  createBaseBranch,
  createOrchestratorGroup,
  enforce,
  groupStarter,
  startOrchestratorGroup,
} = await import("./orchestrator-groups.js");
const { runningLoops } = await import("./boards.js");
type GroupStartOutcome = import("./group-launch.js").GroupStartOutcome;

const SBX = parseBoardKey("SBX") as BoardKey;
const fixture = await tempRepoWithWorkspace();
const repo = fixture.repo;
const CALLER = { boardKey: SBX, orchestratorId: "orc-sbx" };
const starts: string[] = [];
let nextOutcome: GroupStartOutcome = { ok: true };
groupStarter.start = (cardId) => {
  starts.push(cardId);
  store.beginStart(cardId);
  const outcome = nextOutcome;
  return new Promise((resolve) =>
    setTimeout(() => {
      store.endStart(cardId);
      resolve(outcome);
    }, 20),
  );
};

setOrchestrationConfig({ linearApiKey: "" });
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [{ path: repo, baseBranch: "main", checkCommand: "" }],
  linearTeamKeys: [],
});
after(() => {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  env.cleanup();
});

async function setPolicy(patch: Partial<BoardPolicy>): Promise<void> {
  await store.setBoardPolicy(SBX, { ...store.getBoard(SBX)!.policy, ...patch });
}

async function members() {
  const a = await store.createLocalCard(SBX, "member a", "");
  const b = await store.createLocalCard(SBX, "member b", "");
  return [a.id, b.id];
}

void test("resolveBoard returns the caller board and refuses a board that is gone with 404", () => {
  assert.equal(resolveBoard(CALLER.boardKey).key, SBX);
  assert.throws(
    () => resolveBoard("GONE" as BoardKey),
    (err) => err instanceof NotFoundError && err.code === "unknown-board",
  );
});

void test("enforce passes an allowed check and throws a refused one as a policy error", () => {
  enforce({ ok: true });
  assert.throws(
    () => enforce({ ok: false, reason: "no room" }),
    (err) => err instanceof PolicyError && err.details?.reason === "no room",
  );
});

void test("createBaseBranch cuts a local branch and refuses an existing name", async () => {
  const main = await gitOutput(repo, "rev-parse", "main");
  const made = await createBaseBranch(CALLER, {
    repository: repo,
    name: "base/svc-1",
    startPoint: "main",
  });
  assert.deepEqual(made, {
    repository: repo,
    name: "base/svc-1",
    commit: main,
  });
  assert.equal(
    await gitOutput(repo, "rev-parse", "refs/heads/base/svc-1"),
    main,
  );
  await assert.rejects(
    createBaseBranch(CALLER, {
      repository: repo,
      name: "base/svc-1",
      startPoint: "main",
    }),
    (err) => err instanceof ConflictError && err.code === "branch-exists",
  );
});

void test("createBaseBranch refuses a repository outside the board, a bad name and an unknown start point", async () => {
  const input = { repository: repo, name: "base/svc-2", startPoint: "main" };
  await assert.rejects(
    createBaseBranch(CALLER, { ...input, repository: "/tmp/elsewhere" }),
    (err) =>
      err instanceof ValidationError && err.code === "unknown-repository",
  );
  await assert.rejects(
    createBaseBranch(CALLER, { ...input, name: "base/a//b" }),
    (err) =>
      err instanceof ValidationError && err.code === "invalid-branch-name",
  );
  await assert.rejects(
    createBaseBranch(CALLER, { ...input, startPoint: "nope" }),
    (err) =>
      err instanceof ValidationError && err.code === "unknown-start-point",
  );
  assert.equal(
    (await gitOutput(repo, "branch", "--list", "base/svc-2")).trim(),
    "",
  );
});

void test("createOrchestratorGroup stores a group with its launch values and starts nothing", async () => {
  const startsBefore = starts.length;
  const card = await createOrchestratorGroup(CALLER, {
    title: "svc group",
    memberIds: await members(),
    repos: [{ path: repo, base: "main" }],
    direction: "build it",
  });
  const stored = store.getCard(card.id)!;
  assert.equal(stored.source, "group");
  assert.equal(stored.createdByOrchestrator, "orc-sbx");
  assert.deepEqual(stored.launch, { direction: "build it" });
  assert.equal(stored.startQueued, false);
  assert.equal(starts.length, startsBefore);
});

void test("createOrchestratorGroup refuses a foreign repository and a dependency that is no group, writing nothing", async () => {
  const groups = () =>
    store.listCards(SBX).filter((c) => c.source === "group").length;
  const before = groups();
  const ids = await members();
  await assert.rejects(
    createOrchestratorGroup(CALLER, {
      title: "g",
      memberIds: ids,
      repos: [{ path: "/tmp/elsewhere", base: "main" }],
    }),
    (err) =>
      err instanceof ValidationError && err.code === "unknown-repository",
  );
  await assert.rejects(
    createOrchestratorGroup(CALLER, {
      title: "g",
      memberIds: ids,
      repos: [{ path: repo, base: "main" }],
      dependsOn: [ids[0]],
    }),
    (err) =>
      err instanceof ValidationError && err.code === "invalid-dependency",
  );
  assert.equal(groups(), before);
});

void test("startOrchestratorGroup starts a group under the cap with its stored launch values", async () => {
  await setPolicy({ concurrencyCap: 10, budgetPerGroup: null });
  const card = await createOrchestratorGroup(CALLER, {
    title: "to start",
    memberIds: await members(),
    repos: [{ path: repo, base: "main" }],
  });
  const outcome = await startOrchestratorGroup(CALLER, store.getCard(card.id)!);
  assert.deepEqual(outcome, { started: true });
  assert.equal(starts.at(-1), card.id);
});

void test("startOrchestratorGroup queues a group whose dependency is not done", async () => {
  const dep = await createOrchestratorGroup(CALLER, {
    title: "dep",
    memberIds: await members(),
    repos: [{ path: repo, base: "main" }],
  });
  const card = await createOrchestratorGroup(CALLER, {
    title: "waits",
    memberIds: await members(),
    repos: [{ path: repo, base: "main" }],
    dependsOn: [dep.id],
  });
  const startsBefore = starts.length;
  const outcome = await startOrchestratorGroup(CALLER, store.getCard(card.id)!);
  assert.deepEqual(outcome, { queued: true, waitingOn: [dep.id] });
  assert.equal(store.getCard(card.id)?.startQueued, true);
  assert.equal(starts.length, startsBefore);
});

void test("startOrchestratorGroup refuses a plain card, a running group and a full cap", async () => {
  const plain = await store.createLocalCard(SBX, "plain", "");
  await assert.rejects(
    startOrchestratorGroup(CALLER, plain),
    (err) => err instanceof ValidationError && err.code === "not-group-card",
  );
  const { g } = await startedGroup(store, { board: SBX });
  await assert.rejects(
    startOrchestratorGroup(CALLER, g),
    (err) => err instanceof ConflictError && err.code === "already-started",
  );
  const idle = await createOrchestratorGroup(CALLER, {
    title: "idle",
    memberIds: await members(),
    repos: [{ path: repo, base: "main" }],
  });
  await setPolicy({ concurrencyCap: 1 });
  const startsBefore = starts.length;
  await assert.rejects(
    startOrchestratorGroup(CALLER, store.getCard(idle.id)!),
    PolicyError,
  );
  assert.equal(starts.length, startsBefore);
  assert.equal(store.getCard(idle.id)?.startQueued, false);
  await setPolicy({ concurrencyCap: 10 });
});

void test("two overlapping starts of queued groups under a cap of one start one group", async () => {
  await setPolicy({
    concurrencyCap: runningLoops(SBX) + 1,
    budgetPerGroup: null,
  });
  const queued = [];
  for (const title of ["race-a", "race-b"]) {
    const card = await createOrchestratorGroup(CALLER, {
      title,
      memberIds: await members(),
      repos: [{ path: repo, base: "main" }],
    });
    await store.setGroupQueue(card.id, { startQueued: true });
    queued.push(store.getCard(card.id)!);
  }
  const startsBefore = starts.length;
  const results = await Promise.allSettled(
    queued.map((card) => startOrchestratorGroup(CALLER, card)),
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["fulfilled", "rejected"],
  );
  const refused = results[1] as PromiseRejectedResult;
  assert.ok(refused.reason instanceof PolicyError);
  assert.deepEqual(starts.slice(startsBefore), [queued[0].id]);
  assert.equal(store.getCard(queued[0].id)?.startQueued, false);
  assert.equal(store.getCard(queued[1].id)?.startQueued, true);
  await setPolicy({ concurrencyCap: 10 });
});

void test("a failed start restores the queue flag, records one event and answers 409 start-failed", async () => {
  await setPolicy({ concurrencyCap: 10, budgetPerGroup: null });
  const card = await createOrchestratorGroup(CALLER, {
    title: "fails",
    memberIds: await members(),
    repos: [{ path: repo, base: "main" }],
  });
  await store.setGroupQueue(card.id, { startQueued: true });
  nextOutcome = { ok: false, reason: "start failed at creating worktrees" };
  try {
    await assert.rejects(
      startOrchestratorGroup(CALLER, store.getCard(card.id)!),
      (err) =>
        err instanceof ConflictError &&
        err.code === "start-failed" &&
        err.details?.reason === "start failed at creating worktrees",
    );
  } finally {
    nextOutcome = { ok: true };
  }
  assert.equal(store.getCard(card.id)?.startQueued, true);
  const failures = store
    .listOrchestrationEvents(SBX, 0, 500)
    .filter(
      (e) => e.cardId === card.id && e.data.action === "start_group_failed",
    );
  assert.deepEqual(
    failures.map((e) => [e.kind, e.data.reason]),
    [["supervisor_action", "start failed at creating worktrees"]],
  );
});

void test("a start with no orchestration config is refused before the queue flag changes", async () => {
  const card = await createOrchestratorGroup(CALLER, {
    title: "no config",
    memberIds: await members(),
    repos: [{ path: repo, base: "main" }],
  });
  await store.setGroupQueue(card.id, { startQueued: true });
  const startsBefore = starts.length;
  setOrchestrationConfig(
    null as unknown as Parameters<typeof setOrchestrationConfig>[0],
  );
  try {
    await assert.rejects(
      startOrchestratorGroup(CALLER, store.getCard(card.id)!),
      (err) =>
        err instanceof ValidationError &&
        err.code === "orchestration config is not loaded",
    );
  } finally {
    setOrchestrationConfig({ linearApiKey: "" });
  }
  assert.equal(store.getCard(card.id)?.startQueued, true);
  assert.equal(starts.length, startsBefore);
});
