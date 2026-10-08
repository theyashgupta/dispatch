import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type {
  BoardKey,
  BoardPolicy,
  LoopGate,
  OrchestrationEventKind,
  OrchestratorPolicyOverride,
  PrInfo,
} from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { initialPassMemory, runSupervisorPass } =
  await import("./supervisor-pass.js");
type GroupStartOutcome = import("./group-launch.js").GroupStartOutcome;
const { dropWatcher, ensureWatcher, watcherNames } =
  await import("./supervisor-registry.js");
const { LOOP_PROGRESS } =
  await import("../../test-support/supervised-session.js");

await store.load();
after(() => env.cleanup());

let boardCount = 0;

/** Create a board with the supervisor on and the given policy changes. */
async function newBoard(patch: Partial<BoardPolicy> = {}): Promise<BoardKey> {
  boardCount += 1;
  const key = parseBoardKey(`T${boardCount}`) as BoardKey;
  await store.createBoard({
    key,
    name: `Board ${boardCount}`,
    workspaceRoot: "/pass/sessions",
    repositories: [],
    linearTeamKeys: [],
  });
  await setPolicy(key, patch);
  return key;
}

async function setPolicy(key: BoardKey, patch: Partial<BoardPolicy>) {
  const policy = store.getBoard(key)!.policy;
  await store.setBoardPolicy(key, { ...policy, ...patch });
}

/** Turn the supervisor off on every board so a finished test never feeds the next pass. */
async function silenceBoards() {
  for (const board of store.listBoards())
    await setPolicy(board.key, { supervisor: "off" });
}
afterEach(silenceBoards);

async function groupCard(board: BoardKey, title: string) {
  const a = await store.createLocalCard(board, `${title}-a`, "");
  const b = await store.createLocalCard(board, `${title}-b`, "");
  const made = await store.createGroupCard(board, title, [a.id, b.id]);
  assert.ok(made.ok);
  return made.card;
}

async function startCard(cardId: string): Promise<string> {
  const tmuxSession = `dsp-pass-${cardId}`;
  await store.completeStart(cardId, undefined, {
    workspacePath: `/pass/ws/${cardId}`,
    tmuxSession,
    branch: cardId,
  });
  return tmuxSession;
}

async function doneGroup(board: BoardKey, title: string) {
  const card = await groupCard(board, title);
  await store.moveCardManual(card.id, "done");
  assert.equal(store.getCard(card.id)?.column, "done");
  return card;
}

async function queuedGroup(
  board: BoardKey,
  title: string,
  dependsOn: string[],
) {
  const card = await groupCard(board, title);
  await store.setGroupQueue(card.id, { startQueued: true, dependsOn });
  return card;
}

const pr = (state: PrInfo["state"]): PrInfo => ({
  number: 7,
  url: "https://example.test/pr/7",
  title: "change",
  state,
  isDraft: false,
  ci: null,
  repo: "api",
});

function harness(outcome: GroupStartOutcome = { ok: true }) {
  const powerCalls: boolean[] = [];
  const started: string[] = [];
  const memory = initialPassMemory();
  const deps = {
    power: {
      set: (wanted: boolean) => powerCalls.push(wanted),
      pid: () => null,
    },
    startGroup: (cardId: string) => {
      started.push(cardId);
      return Promise.resolve(outcome);
    },
  };
  return {
    powerCalls,
    started,
    pass: (lateMs = 0) => runSupervisorPass(memory, lateMs, Date.now(), deps),
  };
}

function events(board: BoardKey, kind: OrchestrationEventKind) {
  return store
    .listOrchestrationEvents(board, 0, 500)
    .filter((e) => e.kind === kind);
}

function startActions(board: BoardKey, cardId: string) {
  return events(board, "supervisor_action").filter(
    (e) => e.cardId === cardId && e.data.action === "start_group",
  );
}

const GATE: LoopGate = { unit: 1, phase: 3, result: "pass", at: "2026-10-07" };

async function setGate(cardId: string, lastGate: LoopGate | null) {
  await store.setLoopProgress(cardId, {
    ...LOOP_PROGRESS,
    summary: { ...LOOP_PROGRESS.summary, lastGate },
  });
}

/** Run a group at `cost` against a budget of 10 and return its session after a pass with a gate change. */
async function budgetRun(cost: number, changeGate: boolean) {
  const board = await newBoard({ budgetPerGroup: 10 });
  const card = await groupCard(board, "budget");
  const tmux = await startCard(card.id);
  await store.setSessionMetersIfSession(card.id, tmux, {
    contextPercent: 10,
    model: "Opus 5.5",
    cost,
    usage: { fiveHourPercent: 1, sevenDayPercent: 1 },
  });
  await setGate(card.id, null);
  const h = harness();
  await h.pass();
  if (changeGate) await setGate(card.id, GATE);
  await h.pass();
  const live = store.getCard(card.id)!;
  return live.sessions!.find((s) => s.id === live.activeSessionId)!;
}

test("the first pass records no pr_state, a changed PR list records one, an unchanged pass none", async () => {
  const board = await newBoard();
  const card = await groupCard(board, "prs");
  const tmux = await startCard(card.id);
  await store.setPrsIfSession(card.id, tmux, [pr("open")]);
  const h = harness();
  await h.pass();
  assert.deepEqual(events(board, "pr_state"), []);

  await store.setPrsIfSession(card.id, tmux, [pr("merged")]);
  await h.pass();
  const changes = events(board, "pr_state");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].cardId, card.id);
  assert.deepEqual(changes[0].data, {
    from: [[7, "open"]],
    to: [[7, "merged"]],
  });

  await h.pass();
  assert.equal(events(board, "pr_state").length, 1);
});

test("a queued group starts once when its dependency is Done and the board has room", async () => {
  const board = await newBoard();
  const dep = await doneGroup(board, "dep");
  const queued = await queuedGroup(board, "held", [dep.id]);
  const h = harness();
  await h.pass();
  assert.deepEqual(h.started, [queued.id]);
  assert.equal(store.getCard(queued.id)?.startQueued, false);
  const actions = startActions(board, queued.id);
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].data.dependsOn, [dep.id]);

  await h.pass();
  assert.deepEqual(h.started, [queued.id]);
  assert.equal(startActions(board, queued.id).length, 1);
});

test("a failed start of a queued group puts it back in the queue and records the failure", async () => {
  const board = await newBoard();
  const dep = await doneGroup(board, "dep");
  const queued = await queuedGroup(board, "held", [dep.id]);
  const h = harness({
    ok: false,
    reason: "start failed at creating worktrees",
  });
  await h.pass();
  assert.deepEqual(h.started, [queued.id]);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.getCard(queued.id)?.startQueued, true);
  const failures = events(board, "supervisor_action").filter(
    (e) => e.cardId === queued.id && e.data.action === "start_group_failed",
  );
  assert.deepEqual(
    failures.map((e) => e.data),
    [
      {
        action: "start_group_failed",
        reason: "start failed at creating worktrees",
      },
    ],
  );
});

test("a queued group starts when every PR of its dependency is merged", async () => {
  const board = await newBoard();
  const dep = await groupCard(board, "dep");
  const tmux = await startCard(dep.id);
  await store.setPrsIfSession(dep.id, tmux, [pr("merged")]);
  const queued = await queuedGroup(board, "held", [dep.id]);
  const h = harness();
  await h.pass();
  assert.deepEqual(h.started, [queued.id]);
});

test("a queued group stays queued while another group of the board fills the cap", async () => {
  const board = await newBoard({ concurrencyCap: 1 });
  const dep = await doneGroup(board, "dep");
  const busy = await groupCard(board, "busy");
  await startCard(busy.id);
  const queued = await queuedGroup(board, "held", [dep.id]);
  const h = harness();
  await h.pass();
  assert.deepEqual(h.started, []);
  assert.equal(store.getCard(queued.id)?.startQueued, true);
  assert.deepEqual(startActions(board, queued.id), []);
});

test("a running single ticket does not count against the cap of a queued group start", async () => {
  const board = await newBoard({ concurrencyCap: 1 });
  const dep = await doneGroup(board, "dep");
  const single = await store.createLocalCard(board, "single", "");
  await startCard(single.id);
  const queued = await queuedGroup(board, "held", [dep.id]);
  const h = harness();
  await h.pass();
  assert.deepEqual(h.started, [queued.id]);
  assert.equal(store.getCard(queued.id)?.startQueued, false);
});

test("a start that lands during the pass's queue write counts against the cap of the next held group", async () => {
  const board = await newBoard({ concurrencyCap: 2 });
  const dep = await doneGroup(board, "dep");
  const first = await queuedGroup(board, "held-a", [dep.id]);
  const second = await queuedGroup(board, "held-b", [dep.id]);
  const outside = await groupCard(board, "outside");
  const started: string[] = [];
  const deps = {
    power: { set: () => undefined, pid: () => null },
    startGroup: (cardId: string) => {
      started.push(cardId);
      store.beginStart(cardId);
      void Promise.resolve().then(() => store.beginStart(outside.id));
      return Promise.resolve<GroupStartOutcome>({ ok: true });
    },
  };
  try {
    await runSupervisorPass(initialPassMemory(), 0, Date.now(), deps);
    assert.deepEqual(started, [first.id]);
    assert.equal(store.getCard(second.id)?.startQueued, true);
  } finally {
    for (const id of [first.id, second.id, outside.id]) store.endStart(id);
  }
});

test("a queued group stays queued while its dependency is open", async () => {
  const board = await newBoard();
  const dep = await groupCard(board, "dep");
  const queued = await queuedGroup(board, "held", [dep.id]);
  const h = harness();
  await h.pass();
  assert.deepEqual(h.started, []);
  assert.equal(store.getCard(queued.id)?.startQueued, true);
  assert.deepEqual(startActions(board, queued.id), []);
});

test(
  "at the budget a gate change moves the active session to needs_input with reason budget",
  {},
  async () => {
    const session = await budgetRun(12, true);
    assert.equal(session.state, "needs_input");
    assert.equal(session.stateReason, "budget");
  },
);

test("a budget stop is recorded once across gate changes and clears when the budget is raised", async () => {
  const board = await newBoard({ budgetPerGroup: 10 });
  const card = await groupCard(board, "budget-once");
  const tmux = await startCard(card.id);
  await store.setSessionMetersIfSession(card.id, tmux, {
    contextPercent: 10,
    model: "Opus 5.5",
    cost: 12,
    usage: { fiveHourPercent: 1, sevenDayPercent: 1 },
  });
  await setGate(card.id, null);
  const h = harness();
  await h.pass();
  await setGate(card.id, GATE);
  await h.pass();
  await setGate(card.id, { ...GATE, phase: 4 });
  await h.pass();
  const stops = events(board, "supervisor_action").filter(
    (e) => e.cardId === card.id && e.data.reason === "budget",
  );
  assert.equal(stops.length, 1);

  const policy = store.getBoard(board)!.policy;
  await store.setBoardPolicy(board, { ...policy, budgetPerGroup: 20 });
  await h.pass();
  const live = store.getCard(card.id)!;
  const session = live.sessions!.find((s) => s.id === live.activeSessionId)!;
  assert.equal(session.state, "needs_input");
  assert.equal(session.stateReason, undefined);
  const releases = events(board, "supervisor_action").filter(
    (e) => e.cardId === card.id && e.data.action === "budget_release",
  );
  assert.equal(releases.length, 1);
});

test("at the budget with no gate change nothing happens", async () => {
  const session = await budgetRun(12, false);
  assert.notEqual(session.state, "needs_input");
  assert.equal(session.stateReason, undefined);
});

test("under the budget a gate change does nothing", async () => {
  const session = await budgetRun(3, true);
  assert.notEqual(session.state, "needs_input");
  assert.equal(session.stateReason, undefined);
});

test("a cost meter that drops after a relaunch adds to the earlier cost, so the budget stop still fires", async () => {
  const board = await newBoard({ budgetPerGroup: 9 });
  const card = await groupCard(board, "budget-relaunch");
  const tmux = await startCard(card.id);
  const meter = (cost: number) =>
    store.setSessionMetersIfSession(card.id, tmux, {
      contextPercent: 10,
      model: "Opus 5.5",
      cost,
      usage: { fiveHourPercent: 1, sevenDayPercent: 1 },
    });
  const stateOf = () => {
    const live = store.getCard(card.id)!;
    return live.sessions!.find((s) => s.id === live.activeSessionId)!;
  };
  await setGate(card.id, null);
  const h = harness();
  await meter(8);
  await h.pass();
  await meter(2);
  await h.pass();
  assert.equal(stateOf().stateReason, undefined);

  await setGate(card.id, GATE);
  await h.pass();
  assert.equal(stateOf().state, "needs_input");
  assert.equal(stateOf().stateReason, "budget");
});

test("a pass 45 s late records one machine_wake per supervised board and 10 s late records none", async () => {
  const first = await newBoard();
  const second = await newBoard();
  const off = await newBoard({ supervisor: "off" });
  const h = harness();
  await h.pass(10_000);
  for (const board of [first, second, off])
    assert.deepEqual(events(board, "machine_wake"), []);

  await h.pass(45_000);
  for (const board of [first, second]) {
    const wakes = events(board, "machine_wake");
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].data.sleptSeconds, 45);
  }
  assert.deepEqual(events(off, "machine_wake"), []);
});

test("power is released with no live supervised session", async () => {
  await newBoard();
  const h = harness();
  await h.pass();
  assert.deepEqual(h.powerCalls, [false]);
});

test("a live session on a board with the supervisor off does not hold power", async () => {
  const board = await newBoard({ supervisor: "off" });
  const card = await store.createLocalCard(board, "off-board", "");
  await startCard(card.id);
  const h = harness();
  await h.pass();
  assert.deepEqual(h.powerCalls, [false]);
});

test("a live session on a supervised board holds power", async () => {
  const board = await newBoard();
  const card = await store.createLocalCard(board, "on-board", "");
  await startCard(card.id);
  const h = harness();
  await h.pass();
  assert.deepEqual(h.powerCalls, [true]);
});

test("a pass drops the watcher of a session that is gone or on an unsupervised board and keeps a live supervised one", async () => {
  const on = await newBoard();
  const off = await newBoard({ supervisor: "off" });
  const liveCard = await store.createLocalCard(on, "watch-live", "");
  const offCard = await store.createLocalCard(off, "watch-off", "");
  const live = await startCard(liveCard.id);
  const unsupervised = await startCard(offCard.id);
  const gone = "dsp-pass-watcher-gone";
  for (const name of [live, unsupervised, gone]) ensureWatcher(name);
  const h = harness();
  await h.pass();
  const names = watcherNames();
  assert.ok(names.includes(live));
  assert.ok(!names.includes(unsupervised));
  assert.ok(!names.includes(gone));
  for (const name of [live, unsupervised, gone]) dropWatcher(name);
});

/** Put `groupIds` in the scope of extra `extra-1` with `override`, beside a main. */
async function extraOwns(
  board: BoardKey,
  groupIds: string[],
  override: OrchestratorPolicyOverride,
) {
  const base = {
    policyOverride: {},
    cardId: null,
    state: "stopped" as const,
    createdAt: "2026-10-08T00:00:00.000Z",
  };
  await store.setBoardOrchestrators(board, [
    {
      ...base,
      id: "main",
      name: "Main",
      role: "main",
      scope: { groupIds: [], ticketIds: [] },
    },
    {
      ...base,
      id: "extra-1",
      name: "Extra 1",
      role: "extra",
      scope: { groupIds, ticketIds: [] },
      policyOverride: override,
    },
  ]);
}

test("a group of an extra stops at the extra's narrower budget, not the board budget", async () => {
  const board = await newBoard({ budgetPerGroup: 100 });
  const card = await groupCard(board, "extra-budget");
  await extraOwns(board, [card.id], { budgetPerGroup: 10 });
  const tmux = await startCard(card.id);
  await store.setSessionMetersIfSession(card.id, tmux, {
    contextPercent: 10,
    model: "Opus 5.5",
    cost: 12,
    usage: { fiveHourPercent: 1, sevenDayPercent: 1 },
  });
  await setGate(card.id, null);
  const h = harness();
  await h.pass();
  await setGate(card.id, GATE);
  await h.pass();
  const live = store.getCard(card.id)!;
  const session = live.sessions!.find((s) => s.id === live.activeSessionId)!;
  assert.equal(session.stateReason, "budget");
});

test("a held group of an extra stays queued at the extra's narrower cap while the board has room", async () => {
  const board = await newBoard({ concurrencyCap: 5 });
  const dep = await doneGroup(board, "dep");
  const busy = await groupCard(board, "busy");
  await startCard(busy.id);
  const queued = await queuedGroup(board, "held", [dep.id]);
  await extraOwns(board, [queued.id], { concurrencyCap: 1 });
  const h = harness();
  await h.pass();
  assert.deepEqual(h.started, []);
  assert.equal(store.getCard(queued.id)?.startQueued, true);
});

test("a held group of an extra with no cap override follows the board cap", async () => {
  const roomy = await newBoard({ concurrencyCap: 5 });
  const roomyDep = await doneGroup(roomy, "dep");
  await startCard((await groupCard(roomy, "busy")).id);
  const free = await queuedGroup(roomy, "held", [roomyDep.id]);
  await extraOwns(roomy, [free.id], {});
  const h = harness();
  await h.pass();
  assert.deepEqual(h.started, [free.id]);
  await silenceBoards();

  const full = await newBoard({ concurrencyCap: 1 });
  const fullDep = await doneGroup(full, "dep");
  await startCard((await groupCard(full, "busy")).id);
  const held = await queuedGroup(full, "held", [fullDep.id]);
  await extraOwns(full, [held.id], {});
  const second = harness();
  await second.pass();
  assert.deepEqual(second.started, []);
  assert.equal(store.getCard(held.id)?.startQueued, true);
});
