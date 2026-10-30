import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { installFakeTmux } from "../../test-support/fake-tmux.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import type { ActionDeps } from "./supervisor-actions.js";
import { startedGroup } from "../../test-support/group-fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const {
  ensureWatcher,
  watcherNames,
  dropWatcher,
  supervisePane,
  superviseLost,
} = await import("./supervisor-registry.js");
const { actionTools } = await import("./supervisor-actions.js");
const { recordMemory } = await import("../../test-support/memory-fixtures.js");
const { LOOP_PROGRESS } =
  await import("../../test-support/supervised-session.js");
await store.load();
const realTools = { ...actionTools };
after(() => {
  Object.assign(actionTools, realTools);
  env.cleanup();
});

const SBX = parseBoardKey("SBX")!;
const MINUTE = 60_000;
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const PANES = new URL("../../test-support/fixtures/panes/", import.meta.url);
const pane = (name: string) => readFileSync(new URL(name, PANES), "utf8");

async function startedCard(
  board: BoardKey,
  title: string,
  workspacePath = `/tmp/ws-${title}`,
) {
  const created = await store.createLocalCard(board, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath,
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  const card = store.getCard(created.id)!;
  const session = card.sessions!.find((s) => s.id === card.activeSessionId)!;
  return {
    cardId: card.id,
    sessionId: session.id,
    tmuxSession: `dsp-${title}`,
  };
}

function stateEvents(board: BoardKey, cardId: string) {
  return store
    .listOrchestrationEvents(board, 0, 100)
    .filter((e) => e.cardId === cardId && e.kind === "supervisor_state");
}

function sessionOf(cardId: string) {
  const card = store.getCard(cardId);
  return card?.sessions?.find((s) => s.id === card.activeSessionId);
}

void test("two concurrent ensureWatcher calls for one session give one entry", async () => {
  const [a, b] = await Promise.all([
    Promise.resolve().then(() => ensureWatcher("dsp-twice")),
    Promise.resolve().then(() => ensureWatcher("dsp-twice")),
  ]);
  assert.equal(a, b);
  assert.equal(watcherNames().filter((n) => n === "dsp-twice").length, 1);
  dropWatcher("dsp-twice");
  assert.ok(!watcherNames().includes("dsp-twice"));
});

void test("a session on a supervisor off board gets no watcher, no state and no event", async () => {
  const ids = await startedCard(DEFAULT_BOARD_KEY, "off-board");
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await supervisePane({ ...ids, pane: pane("needs-input-question.txt") });
  assert.ok(!watcherNames().includes(ids.tmuxSession));
  assert.equal(sessionOf(ids.cardId)?.state, undefined);
  assert.equal(stateEvents(DEFAULT_BOARD_KEY, ids.cardId).length, 0);
  assert.notEqual(store.getCard(ids.cardId)?.column, "needs_input");
});

void test("one event per transition and none for a repeated state", async () => {
  const ids = await startedCard(SBX, "on-board");
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await supervisePane({ ...ids, pane: pane("working.txt") });
  assert.ok(watcherNames().includes(ids.tmuxSession));
  const session = sessionOf(ids.cardId);
  assert.equal(session?.state, "working");
  assert.ok(session?.stateSince);
  const events = stateEvents(SBX, ids.cardId);
  assert.equal(events.length, 1);
  assert.deepEqual(
    { from: events[0].data.from, to: events[0].data.to },
    { from: null, to: "working" },
  );
  assert.equal(events[0].sessionId, ids.sessionId);
  assert.equal(events[0].boardKey, SBX);
});

void test("a needs_input state moves the card to the needs_input column once", async () => {
  const ids = await startedCard(SBX, "asks");
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await supervisePane({ ...ids, pane: pane("needs-input-question.txt") });
  await supervisePane({ ...ids, pane: pane("needs-input-question.txt") });
  assert.equal(sessionOf(ids.cardId)?.state, "needs_input");
  assert.equal(store.getCard(ids.cardId)?.column, "needs_input");
  const events = stateEvents(SBX, ids.cardId);
  assert.deepEqual(
    events.map((e) => e.data.to),
    ["working", "needs_input"],
  );
  assert.equal(events[1].data.from, "working");
  const moves = store
    .listEvents(SBX, ids.cardId, 50)
    .filter((e) => e.type === "status_needs_input");
  assert.equal(moves.length, 1);
});

void test("a sample for a tmux name the session does not own is ignored", async () => {
  const ids = await startedCard(SBX, "owner");
  await supervisePane({
    ...ids,
    tmuxSession: "dsp-other",
    pane: pane("working.txt"),
  });
  assert.equal(sessionOf(ids.cardId)?.state, undefined);
  assert.ok(!watcherNames().includes("dsp-other"));
});

void test("a server restart with the session still idle writes no new event", async () => {
  const ids = await startedCard(SBX, "restart-idle");
  await store.setSessionStateIfSession(ids.cardId, ids.sessionId, "idle");
  const before = stateEvents(SBX, ids.cardId).length;
  dropWatcher(ids.tmuxSession);
  await supervisePane({ ...ids, pane: pane("idle.txt") });
  await supervisePane({ ...ids, pane: pane("idle.txt") });
  assert.equal(sessionOf(ids.cardId)?.state, "idle");
  assert.equal(stateEvents(SBX, ids.cardId).length, before);
  await supervisePane({ ...ids, pane: pane("working.txt") });
  assert.equal(sessionOf(ids.cardId)?.state, "working");
  assert.deepEqual(
    stateEvents(SBX, ids.cardId).map((e) => [e.data.from, e.data.to]),
    [["idle", "working"]],
  );
});

void test("a stored usage_limit_wait read by a fresh watcher runs the limit duty once, and the next sample does not", async () => {
  const ids = await startedCard(SBX, "restart-limit");
  await store.setSessionStateIfSession(
    ids.cardId,
    ids.sessionId,
    "usage_limit_wait",
  );
  dropWatcher(ids.tmuxSession);
  const limitWaits = () =>
    store
      .listOrchestrationEvents(SBX, 0, 500)
      .filter(
        (e) =>
          e.cardId === ids.cardId &&
          e.kind === "supervisor_action" &&
          e.data.action === "limit_wait",
      ).length;
  await supervisePane({ ...ids, pane: pane("auto-continue.txt") });
  assert.equal(sessionOf(ids.cardId)?.state, "usage_limit_wait");
  assert.equal(stateEvents(SBX, ids.cardId).length, 0);
  assert.equal(limitWaits(), 1);
  await supervisePane({ ...ids, pane: pane("auto-continue.txt") });
  assert.equal(limitWaits(), 1);
  dropWatcher(ids.tmuxSession);
});

void test("a paused card gets the paused state and no action even over an api error pane", async () => {
  const ids = await startedCard(SBX, "paused-card");
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await store.markCardPaused(ids.cardId, ids.sessionId, {
    at: "2026-10-13T00:00:00.000Z",
    by: "user",
    sessionId: ids.sessionId,
    pids: [101],
  });
  await supervisePane({ ...ids, pane: pane("api-error.txt") });
  const session = sessionOf(ids.cardId);
  assert.equal(session?.state, "paused");
  assert.deepEqual(
    store
      .listOrchestrationEvents(SBX, 0, 100)
      .filter((e) => e.cardId === ids.cardId)
      .map((e) => [e.kind, e.data.to]),
    [
      ["supervisor_state", "working"],
      ["supervisor_state", "paused"],
    ],
  );
  await store.clearCardPaused(ids.cardId);
  await supervisePane({ ...ids, pane: pane("working.txt") });
  assert.equal(sessionOf(ids.cardId)?.state, "working");
});

void test("an orchestrator's continue budget is keyed by the UTC day, so a new day gets a fresh one", async () => {
  const hidden = await store.createOrchestratorCard(
    SBX,
    "Orchestrator: Main",
    "main",
  );
  await store.completeStart(hidden.id, undefined, {
    workspacePath: "/tmp/ws-orchestrator",
    tmuxSession: "dsp-orchestrator-day",
    branch: "orchestrator",
  });
  await store.setBoardOrchestrators(SBX, [
    {
      id: "main",
      name: "Main",
      role: "main",
      scope: { groupIds: [], ticketIds: [] },
      policyOverride: {},
      cardId: hidden.id,
      state: "running",
      createdAt: "2026-10-08T00:00:00.000Z",
    },
  ]);
  const card = store.getCard(hidden.id)!;
  const ids = {
    cardId: card.id,
    sessionId: card.activeSessionId!,
    tmuxSession: "dsp-orchestrator-day",
  };
  const dayOne = Date.UTC(2026, 9, 8, 12);
  const dayTwo = Date.UTC(2026, 9, 9, 12);
  actionTools.send = () => Promise.resolve("confirmed");
  try {
    for (const now of [dayOne, dayTwo]) {
      await store.setSessionStateIfSession(
        ids.cardId,
        ids.sessionId,
        "working",
      );
      await supervisePane({ ...ids, pane: pane("api-error.txt") }, now);
    }
  } finally {
    delete actionTools.send;
  }
  assert.deepEqual(ensureWatcher(ids.tmuxSession).plan.prompts, {
    "retry:orchestrator/2026-10-08": 1,
    "retry:orchestrator/2026-10-09": 1,
  });
  dropWatcher(ids.tmuxSession);
});

function groupStates(board: BoardKey, cardId: string) {
  return store
    .listOrchestrationEvents(board, 0, 500)
    .filter((e) => e.cardId === cardId && e.kind === "group_state")
    .map((e) => e.data);
}

async function groupSession() {
  const { g } = await startedGroup(store, { board: SBX });
  const card = store.getCard(g.id)!;
  return {
    cardId: card.id,
    sessionId: card.activeSessionId!,
    tmuxSession: card.tmuxSession!,
  };
}

void test("a group card entering api_error writes one loop_error event, and a repeat sample writes none", async () => {
  const ids = await groupSession();
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await supervisePane({ ...ids, pane: pane("api-error.txt") });
  await supervisePane({ ...ids, pane: pane("api-error.txt") });
  assert.deepEqual(groupStates(SBX, ids.cardId), [
    { state: "loop_error", reason: "api_error" },
  ]);
});

void test("a group card at the usage limit dialog writes a usage_limit event", async () => {
  const ids = await groupSession();
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await supervisePane({ ...ids, pane: pane("limit-menu.txt") });
  await supervisePane({ ...ids, pane: pane("limit-menu.txt") }).catch(
    () => undefined,
  );
  assert.equal(sessionOf(ids.cardId)?.state, "usage_limit_dialog");
  const states = groupStates(SBX, ids.cardId);
  assert.equal(states.length, 1);
  assert.equal(states[0].state, "usage_limit");
});

void test("a ticket card and the orchestrator card write no group_state event on an error state", async () => {
  const ticket = await startedCard(SBX, "ticket-error");
  await supervisePane({ ...ticket, pane: pane("working.txt") });
  await supervisePane({ ...ticket, pane: pane("api-error.txt") });
  assert.equal(sessionOf(ticket.cardId)?.state, "api_error");
  assert.equal(groupStates(SBX, ticket.cardId).length, 0);

  const hidden = await store.createOrchestratorCard(
    SBX,
    "Orchestrator: Err",
    "err",
  );
  await store.completeStart(hidden.id, undefined, {
    workspacePath: "/tmp/ws-orchestrator-err",
    tmuxSession: "dsp-orchestrator-err",
    branch: "orchestrator",
  });
  const card = store.getCard(hidden.id)!;
  const ids = {
    cardId: card.id,
    sessionId: card.activeSessionId!,
    tmuxSession: "dsp-orchestrator-err",
  };
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await supervisePane({ ...ids, pane: pane("api-error.txt") });
  assert.equal(sessionOf(ids.cardId)?.state, "api_error");
  assert.equal(groupStates(SBX, ids.cardId).length, 0);
  dropWatcher(ids.tmuxSession);
});

function supervisorEvents(board: BoardKey, cardId: string) {
  return store
    .listOrchestrationEvents(board, 0, 500)
    .filter(
      (e) =>
        e.cardId === cardId &&
        (e.kind === "supervisor_state" || e.kind === "supervisor_action"),
    );
}

void test("superviseLost does nothing for a partial loss whose card still has a live session", async () => {
  const ids = await startedCard(SBX, "partial-loss");
  const reserved = await store.reserveNewSession(
    ids.cardId,
    store.getCard(ids.cardId)!.identifier,
  );
  await store.completeStart(ids.cardId, reserved!.sessionId, {
    workspacePath: "/tmp/ws-partial-loss-2",
    tmuxSession: "dsp-partial-loss-2",
    branch: "partial-loss-2",
  });
  await store.markSessionLost(
    ids.cardId,
    store.getCard(ids.cardId)!.activeSessionId,
  );
  const card = store.getCard(ids.cardId)!;
  assert.equal(card.sessionLost, false);
  assert.equal(card.activeSessionId, ids.sessionId);
  await store.setSessionStateIfSession(ids.cardId, ids.sessionId, "working");
  const before = supervisorEvents(SBX, ids.cardId).length;
  await superviseLost(ids.cardId);
  assert.equal(supervisorEvents(SBX, ids.cardId).length, before);
  assert.equal(sessionOf(ids.cardId)?.state, "working");
});

void test("superviseLost records lost and runs the duty once for a whole-card loss", async () => {
  const ids = await startedCard(SBX, "whole-loss");
  await store.setSessionStateIfSession(ids.cardId, ids.sessionId, "working");
  await store.markSessionLost(ids.cardId, ids.sessionId);
  assert.equal(store.getCard(ids.cardId)?.sessionLost, true);
  store.beginStart(ids.cardId);
  try {
    await superviseLost(ids.cardId);
    const events = supervisorEvents(SBX, ids.cardId);
    assert.equal(sessionOf(ids.cardId)?.state, "lost");
    assert.deepEqual(
      events.map((e) => [e.kind, e.data.to ?? e.data.action]),
      [
        ["supervisor_state", "lost"],
        ["supervisor_action", "resume"],
      ],
    );
    assert.equal(events[0].data.from, "working");
    await superviseLost(ids.cardId);
    assert.equal(supervisorEvents(SBX, ids.cardId).length, events.length);
  } finally {
    store.endStart(ids.cardId);
  }
});

const JOB = 5100;

function frozenFixture() {
  const calls = { kill: 0, relaunch: 0 };
  let atPrompt = false;
  const fake: Partial<ActionDeps> = {
    paneTerminal: () =>
      Promise.resolve({ pgid: 5000, tpgid: atPrompt ? 5000 : JOB }),
    kill: () => {
      calls.kill++;
      atPrompt = true;
    },
    relaunch: () => {
      calls.relaunch++;
      atPrompt = false;
      return Promise.resolve("launched");
    },
    resume: () => Promise.resolve(),
    atShellPrompt: () => Promise.resolve(atPrompt),
    shellRoot: () => Promise.resolve(true),
    send: () => Promise.resolve("confirmed"),
    claudeUpMs: 50,
    grace: { hangupMs: 50, killMs: 50, pollMs: 10 },
  };
  return { calls, fake };
}

function relaunchEvents(cardId: string) {
  return store
    .listOrchestrationEvents(SBX, 0, 500)
    .filter(
      (e) =>
        e.cardId === cardId &&
        e.kind === "supervisor_action" &&
        e.data.action === "relaunch_frozen",
    );
}

async function frozenSession(title: string) {
  const workspace = path.join(env.root, "ws", title);
  mkdirSync(workspace, { recursive: true });
  const ids = await startedCard(SBX, title, workspace);
  const file = path.join(env.root, "projects", title, "transcript.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '{"type":"summary"}\n');
  await store.setTranscriptPath(ids.cardId, ids.sessionId, file);
  await store.setSessionMetersIfSession(ids.cardId, ids.tmuxSession, {
    contextPercent: 0,
    model: "Opus 5.5",
    cost: null,
    usage: { fiveHourPercent: null, sevenDayPercent: null },
  });
  recordMemory(2048, 1000);
  const base = Date.now();
  await supervisePane({ ...ids, pane: pane("frozen-compacted.txt") }, base);
  await supervisePane(
    { ...ids, pane: pane("frozen-compacted.txt") },
    base + 60_000,
  );
  const session = sessionOf(ids.cardId);
  assert.equal(session?.state, "frozen");
  return { ids, since: Date.parse(session.stateSince!) };
}

void test("a session frozen for 15 minutes is relaunched once and later samples add nothing", async () => {
  delete process.env.DISPATCH_FROZEN_RELAUNCH_MS;
  const { calls, fake } = frozenFixture();
  Object.assign(actionTools, fake);
  try {
    const { ids, since } = await frozenSession("frozen-15");
    const frozen = { ...ids, pane: pane("frozen-compacted.txt") };
    await supervisePane(frozen, since + 15 * 60_000 - 1_000);
    assert.equal(calls.kill, 0);
    assert.equal(relaunchEvents(ids.cardId).length, 0);
    await supervisePane(frozen, since + 15 * 60_000);
    assert.equal(calls.kill, 1);
    assert.equal(calls.relaunch, 1);
    assert.equal(relaunchEvents(ids.cardId).length, 1);
    await supervisePane(frozen, since + 16 * 60_000);
    await supervisePane(frozen, since + 17 * 60_000);
    assert.equal(calls.kill, 1);
    assert.equal(calls.relaunch, 1);
    assert.equal(relaunchEvents(ids.cardId).length, 1);
    assert.equal(sessionOf(ids.cardId)?.state, "frozen");
    assert.equal(Date.parse(sessionOf(ids.cardId)!.stateSince!), since);
  } finally {
    Object.assign(actionTools, realTools);
  }
});

void test("DISPATCH_FROZEN_RELAUNCH_MS moves the relaunch time", async () => {
  process.env.DISPATCH_FROZEN_RELAUNCH_MS = "120000";
  const { calls, fake } = frozenFixture();
  Object.assign(actionTools, fake);
  try {
    const { ids, since } = await frozenSession("frozen-env");
    const frozen = { ...ids, pane: pane("frozen-compacted.txt") };
    await supervisePane(frozen, since + 119_000);
    assert.equal(calls.kill, 0);
    await supervisePane(frozen, since + 120_000);
    assert.equal(calls.kill, 1);
    assert.equal(relaunchEvents(ids.cardId).length, 1);
  } finally {
    delete process.env.DISPATCH_FROZEN_RELAUNCH_MS;
    Object.assign(actionTools, realTools);
  }
});

void test("a second freeze in the same phase gives needs_input with resume_failed and never flaps back to frozen", async () => {
  delete process.env.DISPATCH_FROZEN_RELAUNCH_MS;
  const { calls, fake } = frozenFixture();
  Object.assign(actionTools, fake);
  try {
    const { ids, since } = await frozenSession("frozen-twice");
    const frozen = { ...ids, pane: pane("frozen-compacted.txt") };
    await supervisePane(frozen, since + 15 * 60_000);
    assert.equal(calls.kill, 1);
    assert.equal(calls.relaunch, 1);
    const healthy = since + 16 * 60_000;
    await supervisePane({ ...ids, pane: pane("working.txt") }, healthy);
    assert.notEqual(sessionOf(ids.cardId)?.state, "frozen");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await supervisePane(frozen, healthy + 60_000);
    await supervisePane(frozen, healthy + 120_000);
    const second = sessionOf(ids.cardId);
    assert.equal(second?.state, "frozen");
    const due = Math.max(
      Date.parse(second.stateSince!) + 15 * 60_000,
      healthy + 180_000,
    );
    await supervisePane(frozen, due);
    assert.equal(sessionOf(ids.cardId)?.state, "needs_input");
    assert.equal(sessionOf(ids.cardId)?.stateReason, "resume_failed");
    await supervisePane(frozen, due + 60_000);
    await supervisePane(frozen, due + 120_000);
    assert.equal(sessionOf(ids.cardId)?.state, "needs_input");
    assert.equal(sessionOf(ids.cardId)?.stateReason, "resume_failed");
    assert.equal(calls.kill, 1);
    assert.equal(calls.relaunch, 1);
    assert.equal(relaunchEvents(ids.cardId).length, 1);
  } finally {
    Object.assign(actionTools, realTools);
  }
});

void test("a server restart keeps a frozen session frozen with the same stateSince", async () => {
  const { ids } = await frozenSession("frozen-restart");
  const before = sessionOf(ids.cardId);
  const events = stateEvents(SBX, ids.cardId).length;
  dropWatcher(ids.tmuxSession);
  const frozen = { ...ids, pane: pane("frozen-compacted.txt") };
  await supervisePane(frozen, Date.now());
  await supervisePane(frozen, Date.now() + 1_000);
  const kept = sessionOf(ids.cardId);
  assert.equal(kept?.state, "frozen");
  assert.equal(kept?.stateSince, before?.stateSince);
  assert.equal(stateEvents(SBX, ids.cardId).length, events);
});

void test("a released session that samples a shell prompt keeps its state, records no event and plans no resume", async () => {
  const fake = installFakeTmux(env);
  const calls = { resume: 0, relaunch: 0 };
  Object.assign(actionTools, {
    resume: () => {
      calls.resume++;
      return Promise.resolve();
    },
    relaunch: () => {
      calls.relaunch++;
      return Promise.resolve("launched" as const);
    },
  });
  writeFileSync(path.join(fake.state, "at-prompt"), "");
  const shell = (title: string) => startedCard(SBX, title);

  const control = await shell("exited-idle");
  await store.setSessionStateIfSession(
    control.cardId,
    control.sessionId,
    "idle",
  );
  await supervisePane({ ...control, pane: pane("working.txt") });
  assert.ok(
    stateEvents(SBX, control.cardId).some((e) => e.data.to === "shell_prompt"),
    "without the hold, the same sample records shell_prompt",
  );
  calls.resume = 0;
  calls.relaunch = 0;

  const ids = await shell("released-shell");
  await store.setSessionStateIfSession(ids.cardId, ids.sessionId, "released");
  const events = stateEvents(SBX, ids.cardId).length;
  await supervisePane({ ...ids, pane: pane("working.txt") });
  await supervisePane({ ...ids, pane: pane("working.txt") });
  assert.equal(sessionOf(ids.cardId)?.state, "released");
  assert.equal(stateEvents(SBX, ids.cardId).length, events);
  assert.deepEqual(calls, { resume: 0, relaunch: 0 });
  assert.equal(
    store
      .listOrchestrationEvents(SBX, 0, 500)
      .filter((e) => e.cardId === ids.cardId && e.kind === "group_state")
      .length,
    0,
  );
});

void test("a released session whose pane shows another foreground command writes no supervisor_state event and stays released", async () => {
  rmSync(path.join(env.root, "fake-tmux", "at-prompt"), { force: true });
  const control = await startedCard(SBX, "idle-working");
  await store.setSessionStateIfSession(
    control.cardId,
    control.sessionId,
    "idle",
  );
  await supervisePane({ ...control, pane: pane("working.txt") });
  assert.ok(
    stateEvents(SBX, control.cardId).some((e) => e.data.to === "working"),
    "without the hold, the same sample records working",
  );

  const ids = await startedCard(SBX, "released-working");
  await store.setSessionStateIfSession(ids.cardId, ids.sessionId, "released");
  const git = "$ git log\ncommit 1a2b3c\nAuthor: someone\n:";
  await supervisePane({ ...ids, pane: git });
  await supervisePane({ ...ids, pane: git });
  assert.equal(stateEvents(SBX, ids.cardId).length, 0);
  assert.equal(sessionOf(ids.cardId)?.state, "released");
});

void test("a released session whose pane shows an idle Claude with the ready footer ends the hold and writes a state event", async () => {
  rmSync(path.join(env.root, "fake-tmux", "at-prompt"), { force: true });
  const ids = await startedCard(SBX, "released-claude");
  await store.setSessionStateIfSession(ids.cardId, ids.sessionId, "released");
  await supervisePane({ ...ids, pane: pane("idle.txt") });
  assert.notEqual(sessionOf(ids.cardId)?.state, "released");
  assert.equal(
    stateEvents(SBX, ids.cardId).filter((e) => e.data.from === "released")
      .length,
    1,
  );
});

void test("superviseLost on a card whose active session is released plans no resume and keeps released", async () => {
  const calls = { resume: 0 };
  Object.assign(actionTools, {
    resume: () => {
      calls.resume++;
      return Promise.resolve();
    },
  });
  const ids = await startedCard(SBX, "released-lost");
  await store.setSessionStateIfSession(ids.cardId, ids.sessionId, "released");
  await store.markSessionLost(ids.cardId, ids.sessionId);
  assert.equal(store.getCard(ids.cardId)?.sessionLost, true);
  await superviseLost(ids.cardId);
  assert.equal(calls.resume, 0);
  assert.equal(supervisorEvents(SBX, ids.cardId).length, 0);
  assert.equal(sessionOf(ids.cardId)?.state, "released");
});

async function finishedLoop(title: string, completion: "running" | "complete") {
  const ids = await startedCard(SBX, title);
  await store.setOrchestratorFields(ids.cardId, {
    launch: { direction: "run the loop" },
  });
  await store.setLoopProgress(ids.cardId, {
    ...LOOP_PROGRESS,
    completion,
    engine: {
      active: true,
      iteration: 1,
      sessionId: "s-1",
      handoffPending: false,
      startedAt: null,
      closed: false,
    },
  });
  await store.applyMarker(
    ids.cardId,
    ids.sessionId,
    "agent_done",
    undefined,
    "DONE built",
    "status_agent_done",
  );
  ensureWatcher(ids.tmuxSession, null).progressRead = true;
  return ids;
}

async function idleTwice(ids: Awaited<ReturnType<typeof startedCard>>) {
  const t0 = Date.now();
  const at = (minute: number, name: string) =>
    supervisePane({ ...ids, pane: pane(name) }, t0 + minute * 60_000);
  for (const minute of [0, 1, 2]) await at(minute, "idle.txt");
  await at(3, "working.txt");
  for (const minute of [4, 5, 6]) await at(minute, "idle.txt");
}

void test("an unchanged pane keeps a complete loop in Agent done with its DONE marker", async () => {
  const ids = await finishedLoop("done-frozen", "complete");
  try {
    await idleTwice(ids);
    const card = store.getCard(ids.cardId);
    assert.equal(sessionOf(ids.cardId)?.state, "needs_input");
    assert.equal(card?.column, "agent_done");
    assert.equal(card?.lastMarker, "DONE built");
  } finally {
    dropWatcher(ids.tmuxSession);
  }
});

void test("an unchanged pane still moves a running loop in Agent done to Needs input", async () => {
  const ids = await finishedLoop("done-running", "running");
  try {
    await idleTwice(ids);
    assert.equal(sessionOf(ids.cardId)?.state, "needs_input");
    assert.equal(store.getCard(ids.cardId)?.column, "needs_input");
  } finally {
    dropWatcher(ids.tmuxSession);
  }
});

void test("an idle loop whose engine Dispatch only kept open gets no restart prompt", async () => {
  const ids = await startedCard(SBX, "kept-open");
  await store.setOrchestratorFields(ids.cardId, {
    launch: { direction: "run the loop" },
  });
  await store.setLoopProgress(ids.cardId, {
    ...LOOP_PROGRESS,
    engine: {
      active: true,
      iteration: 1,
      sessionId: "s-1",
      handoffPending: false,
      startedAt: null,
      closed: false,
      keptOpen: true,
    },
  });
  ensureWatcher(ids.tmuxSession, null).progressRead = true;
  try {
    const t0 = Date.now();
    for (const minute of [0, 1, 2])
      await supervisePane(
        { ...ids, pane: pane("idle.txt") },
        t0 + minute * 60_000,
      );
    assert.equal(sessionOf(ids.cardId)?.state, "idle");
    const actions = store
      .listOrchestrationEvents(SBX, 0, 500)
      .filter((e) => e.cardId === ids.cardId && e.kind === "supervisor_action");
    assert.deepEqual(actions, []);
  } finally {
    dropWatcher(ids.tmuxSession);
  }
});

const LOOP_SLUG = LOOP_PROGRESS.slug;
const ENGINE_REL = path.join(".claude", "ralph-loop.local.md");
const PROMISE_PANE = `⏺ All units are green.\n  <promise>RALPH COMPLETE ${LOOP_SLUG}</promise>\n✻ Worked for 6s · done 4:01 AM\n❯ \n  Opus 5.5 · high  │  ██░░░░░░░░   17%  174k/1.0M\n`;
const DONE_PANE = PROMISE_PANE.replace(
  "✻ Worked",
  "  DISPATCH_STATUS: DONE - built\n✻ Worked",
);

async function completeLoop(title: string, blockedClose = false) {
  const root = mkdtempSync(path.join(env.root, `${title}-`));
  const ids = await startedCard(SBX, title, root);
  await store.setOrchestratorFields(ids.cardId, {
    launch: { direction: "run the loop" },
  });
  const engine = path.join(root, ENGINE_REL);
  mkdirSync(path.dirname(engine), { recursive: true });
  writeFileSync(
    engine,
    `---\nactive: true\niteration: 1\nsession_id: s-1\ncompletion_promise: "RALPH COMPLETE ${LOOP_SLUG}"\n---\nbody\n`,
  );
  if (blockedClose)
    mkdirSync(path.join(`${engine}.done`, "keep"), { recursive: true });
  const seed = () =>
    store.setLoopProgress(ids.cardId, {
      ...LOOP_PROGRESS,
      completion: "complete",
      engine: {
        active: true,
        iteration: 1,
        sessionId: "s-1",
        handoffPending: false,
        startedAt: null,
        closed: false,
      },
    });
  await seed();
  ensureWatcher(ids.tmuxSession, null).progressRead = true;
  const closeRows = () =>
    store
      .listOrchestrationEvents(SBX, 0, 500)
      .filter(
        (e) =>
          e.cardId === ids.cardId &&
          e.kind === "supervisor_action" &&
          e.data.action === "close_loop",
      );
  return { ids, engine, seed, closeRows };
}

void test("a promise with no DONE line gives roadmap_complete and leaves the engine file in place", async () => {
  const loop = await completeLoop("promise-only");
  try {
    await supervisePane({ ...loop.ids, pane: PROMISE_PANE }, 10 * MINUTE);
    await supervisePane({ ...loop.ids, pane: PROMISE_PANE }, 20 * MINUTE);
    assert.equal(sessionOf(loop.ids.cardId)?.state, "roadmap_complete");
    assert.deepEqual(loop.closeRows(), []);
    assert.equal(existsSync(loop.engine), true);
    assert.equal(existsSync(`${loop.engine}.done`), false);
  } finally {
    dropWatcher(loop.ids.tmuxSession);
  }
});

void test("a promise and a DONE line close the engine with the reason done_marker", async () => {
  const loop = await completeLoop("promise-and-done");
  try {
    await supervisePane({ ...loop.ids, pane: DONE_PANE }, 10 * MINUTE);
    assert.equal(sessionOf(loop.ids.cardId)?.state, "roadmap_complete");
    assert.equal(loop.closeRows().length, 1);
    assert.equal(loop.closeRows()[0].data.result, "closed");
    assert.equal(loop.closeRows()[0].data.reason, "done_marker");
    assert.equal(existsSync(loop.engine), false);
    assert.match(
      readFileSync(`${loop.engine}.done`, "utf8"),
      /^closed_reason: done_marker$/m,
    );
  } finally {
    dropWatcher(loop.ids.tmuxSession);
  }
});

void test("a DONE line that arrives after the promise closes the engine on the next retry", async () => {
  const loop = await completeLoop("done-after-promise");
  try {
    await supervisePane({ ...loop.ids, pane: PROMISE_PANE }, 10 * MINUTE);
    assert.deepEqual(loop.closeRows(), []);
    await supervisePane({ ...loop.ids, pane: DONE_PANE }, 12 * MINUTE);
    assert.equal(loop.closeRows().length, 1);
    assert.equal(loop.closeRows()[0].data.reason, "done_marker");
    assert.equal(existsSync(loop.engine), false);
  } finally {
    dropWatcher(loop.ids.tmuxSession);
  }
});

void test("the close retry after a failed rename runs once a minute and only while the DONE line is seen", async () => {
  const loop = await completeLoop("retry-gated", true);
  try {
    const sample = async (pane: string, at: number) => {
      await loop.seed();
      await supervisePane({ ...loop.ids, pane }, at);
    };
    await sample(DONE_PANE, 10 * MINUTE);
    assert.equal(loop.closeRows().length, 1);
    assert.match(String(loop.closeRows()[0].data.result), /^failed/);
    await sample(DONE_PANE, 10 * MINUTE + 30_000);
    assert.equal(loop.closeRows().length, 1);
    await sample(DONE_PANE, 11 * MINUTE + 1_000);
    assert.equal(loop.closeRows().length, 2);
    await sample(PROMISE_PANE, 13 * MINUTE);
    await sample(PROMISE_PANE, 15 * MINUTE);
    assert.equal(loop.closeRows().length, 2);
    await sample(DONE_PANE, 17 * MINUTE);
    assert.equal(loop.closeRows().length, 3);
    assert.equal(existsSync(loop.engine), true);
  } finally {
    dropWatcher(loop.ids.tmuxSession);
  }
});

void test("a DONE line 10 s after a promise-only read closes the engine without waiting for the retry", async () => {
  const loop = await completeLoop("done-ten-seconds-after-promise");
  try {
    await supervisePane({ ...loop.ids, pane: PROMISE_PANE }, 10 * MINUTE);
    assert.equal(sessionOf(loop.ids.cardId)?.state, "roadmap_complete");
    assert.deepEqual(loop.closeRows(), []);
    await supervisePane({ ...loop.ids, pane: DONE_PANE }, 10 * MINUTE + 10_000);
    assert.equal(loop.closeRows().length, 1);
    assert.equal(loop.closeRows()[0].data.result, "closed");
    assert.equal(loop.closeRows()[0].data.reason, "done_marker");
    assert.equal(existsSync(loop.engine), false);
  } finally {
    dropWatcher(loop.ids.tmuxSession);
  }
});
