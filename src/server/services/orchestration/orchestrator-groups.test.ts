import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, BoardPolicy } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";
import {
  ConflictError,
  ForbiddenError,
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
const { appendToExtraScope, editOrchestrator, writeState } =
  await import("./orchestrator-session.js");
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
  assert.equal(stored.ownerOrchestrator, "orc-sbx");
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

void test("two overlapping starts of one group start it once and refuse the other as already-started", async () => {
  await setPolicy({ concurrencyCap: 10, budgetPerGroup: null });
  const created = await createOrchestratorGroup(CALLER, {
    title: "same group",
    memberIds: await members(),
    repos: [{ path: repo, base: "main" }],
  });
  const card = store.getCard(created.id)!;
  const startsBefore = starts.length;
  const results = await Promise.allSettled([
    startOrchestratorGroup(CALLER, card),
    startOrchestratorGroup(CALLER, card),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["fulfilled", "rejected"],
  );
  const refused = results[1] as PromiseRejectedResult;
  assert.ok(refused.reason instanceof ConflictError);
  assert.equal(refused.reason.status, 409);
  assert.equal(refused.reason.code, "already-started");
  assert.deepEqual(starts.slice(startsBefore), [card.id]);
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

const EXT = parseBoardKey("EXT") as BoardKey;
await store.createBoard({
  key: EXT,
  name: "Extras",
  workspaceRoot: "/ext/sessions",
  repositories: [{ path: repo, baseBranch: "main", checkCommand: "" }],
  linearTeamKeys: [],
});
const extOwn = await store.createLocalCard(EXT, "extra ticket", "");
const extMain = await store.createLocalCard(EXT, "main ticket", "");
await store.setBoardOrchestrators(EXT, [
  {
    id: "main",
    name: "Main",
    role: "main",
    scope: { groupIds: [], ticketIds: [] },
    policyOverride: {},
    cardId: null,
    state: "stopped",
    createdAt: "2026-10-07T00:00:00.000Z",
  },
  {
    id: "extra-1",
    name: "Extra 1",
    role: "extra",
    scope: { groupIds: [], ticketIds: [extOwn.id] },
    policyOverride: {},
    cardId: null,
    state: "stopped",
    createdAt: "2026-10-07T00:00:00.000Z",
  },
]);
const EXTRA = { boardKey: EXT, orchestratorId: "extra-1" };
const MAIN = { boardKey: EXT, orchestratorId: "main" };
const extGroups = () =>
  store.listCards(EXT).filter((c) => c.source === "group").length;
const scopeOf = (id: string) =>
  store.getBoard(EXT)!.orchestrators.find((r) => r.id === id)!.scope;

void test("create_group refuses a member outside the caller's scope with 403 other-owner, writing nothing", async () => {
  const before = extGroups();
  await assert.rejects(
    createOrchestratorGroup(EXTRA, {
      title: "takes the main's ticket",
      memberIds: [extOwn.id, extMain.id],
      repos: [{ path: repo, base: "main" }],
    }),
    (err) => err instanceof ForbiddenError && err.code === "other-owner",
  );
  assert.equal(extGroups(), before);
  assert.equal(store.getCard(extMain.id)?.groupId, undefined);
});

void test("create_group refuses an orchestrator session card as a member, for the main too", async () => {
  const hidden = await store.createOrchestratorCard(
    EXT,
    "Orchestrator: Main",
    "main",
  );
  const before = extGroups();
  await assert.rejects(
    createOrchestratorGroup(EXTRA, {
      title: "takes a session",
      memberIds: [hidden.id],
      repos: [{ path: repo, base: "main" }],
    }),
    (err) => err instanceof ForbiddenError && err.code === "other-owner",
  );
  await assert.rejects(
    createOrchestratorGroup(MAIN, {
      title: "takes a session",
      memberIds: [hidden.id],
      repos: [{ path: repo, base: "main" }],
    }),
    (err) =>
      err instanceof ConflictError &&
      JSON.stringify(err.details?.ineligibleIds) ===
        JSON.stringify([hidden.id]),
  );
  assert.equal(extGroups(), before);
});

void test("a group an extra creates joins that extra's scope; a group the main creates changes no scope", async () => {
  const made = await createOrchestratorGroup(EXTRA, {
    title: "extra group",
    memberIds: [extOwn.id],
    repos: [{ path: repo, base: "main" }],
  });
  assert.deepEqual(scopeOf("extra-1").groupIds, [made.id]);
  const loose = await store.createLocalCard(EXT, "main loose", "");
  await createOrchestratorGroup(MAIN, {
    title: "main group",
    memberIds: [loose.id],
    repos: [{ path: repo, base: "main" }],
  });
  assert.deepEqual(scopeOf("extra-1").groupIds, [made.id]);
  assert.deepEqual(scopeOf("main"), { groupIds: [], ticketIds: [] });
});

void test("two parallel scope appends by one extra keep both ids", async () => {
  const x = await store.createLocalCard(EXT, "parallel x", "");
  const y = await store.createLocalCard(EXT, "parallel y", "");
  const before = scopeOf("extra-1").ticketIds;
  await Promise.all([
    appendToExtraScope(EXTRA, "ticketIds", x.id),
    appendToExtraScope(EXTRA, "ticketIds", y.id),
  ]);
  assert.deepEqual(scopeOf("extra-1").ticketIds, [...before, x.id, y.id]);
});

void test("a user scope edit and an append queued at the same time both land", async () => {
  const t7 = await store.createLocalCard(EXT, "user pick", "");
  const g = await store.createLocalCard(EXT, "appended", "");
  const scope = scopeOf("extra-1");
  await Promise.all([
    writeState(EXTRA, "busy", false),
    editOrchestrator(store.getBoard(EXT)!, "extra-1", {
      scope: { ...scope, ticketIds: [...scope.ticketIds, t7.id] },
    }),
    appendToExtraScope(EXTRA, "ticketIds", g.id),
  ]);
  assert.deepEqual(scopeOf("extra-1").ticketIds, [
    ...scope.ticketIds,
    t7.id,
    g.id,
  ]);
});

void test("create_group by an extra with a stale scope id and a stale wider override still answers the group and appends it", async () => {
  const records = store.getBoard(EXT)!.orchestrators;
  const cap = store.getBoard(EXT)!.policy.concurrencyCap;
  await store.setBoardOrchestrators(
    EXT,
    records.map((r) =>
      r.id === "extra-1"
        ? {
            ...r,
            scope: { ...r.scope, groupIds: [...r.scope.groupIds, "EXT-GONE"] },
            policyOverride: { concurrencyCap: cap + 1 },
          }
        : r,
    ),
  );
  const before = scopeOf("extra-1").groupIds;
  const owned = await store.createLocalCard(EXT, "stale owned", "");
  await appendToExtraScope(EXTRA, "ticketIds", owned.id);
  try {
    const made = await createOrchestratorGroup(EXTRA, {
      title: "stale extra group",
      memberIds: [owned.id],
      repos: [{ path: repo, base: "main" }],
    });
    assert.deepEqual(scopeOf("extra-1").groupIds, [...before, made.id]);
  } finally {
    await store.setBoardOrchestrators(
      EXT,
      store.getBoard(EXT)!.orchestrators.map((r) =>
        r.id === "extra-1"
          ? {
              ...r,
              scope: {
                ...r.scope,
                groupIds: r.scope.groupIds.filter((id) => id !== "EXT-GONE"),
              },
              policyOverride: {},
            }
          : r,
      ),
    );
  }
});

void test("the main may depend on a group an extra owns", async () => {
  const [extraGroup] = scopeOf("extra-1").groupIds;
  assert.ok(extraGroup);
  const loose = await store.createLocalCard(EXT, "main waits", "");
  const made = await createOrchestratorGroup(MAIN, {
    title: "after the extra",
    memberIds: [loose.id],
    repos: [{ path: repo, base: "main" }],
    dependsOn: [extraGroup],
  });
  assert.deepEqual(store.getCard(made.id)?.dependsOn, [extraGroup]);
});

void test("start_group by an extra with a cap override of 1 is refused while one loop runs, and the main under the board cap starts it", async () => {
  await store.setBoardPolicy(EXT, {
    ...store.getBoard(EXT)!.policy,
    concurrencyCap: 10,
  });
  const { g: running } = await startedGroup(store, { board: EXT });
  await appendToExtraScope(EXTRA, "groupIds", running.id);
  assert.ok(runningLoops(EXT) >= 1);
  const owned = await store.createLocalCard(EXT, "capped owned", "");
  await appendToExtraScope(EXTRA, "ticketIds", owned.id);
  const held = await createOrchestratorGroup(EXTRA, {
    title: "capped extra group",
    memberIds: [owned.id],
    repos: [{ path: repo, base: "main" }],
  });
  const records = store.getBoard(EXT)!.orchestrators;
  await store.setBoardOrchestrators(
    EXT,
    records.map((r) =>
      r.id === "extra-1" ? { ...r, policyOverride: { concurrencyCap: 1 } } : r,
    ),
  );
  try {
    const startsBefore = starts.length;
    await assert.rejects(
      startOrchestratorGroup(EXTRA, store.getCard(held.id)!),
      PolicyError,
    );
    assert.equal(starts.length, startsBefore);
    assert.equal(store.getCard(held.id)?.startQueued, false);
    assert.deepEqual(
      await startOrchestratorGroup(MAIN, store.getCard(held.id)!),
      { started: true },
    );
  } finally {
    await store.setBoardOrchestrators(
      EXT,
      store
        .getBoard(EXT)!
        .orchestrators.map((r) =>
          r.id === "extra-1" ? { ...r, policyOverride: {} } : r,
        ),
    );
  }
});
