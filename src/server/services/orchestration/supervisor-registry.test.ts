import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import { startedGroup } from "../../test-support/group-fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { ensureWatcher, watcherNames, dropWatcher, supervisePane } =
  await import("./supervisor-registry.js");
await store.load();
after(() => env.cleanup());

const SBX = parseBoardKey("SBX")!;
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});

const PANES = new URL("../../test-support/fixtures/panes/", import.meta.url);
const pane = (name: string) => readFileSync(new URL(name, PANES), "utf8");

async function startedCard(board: BoardKey, title: string) {
  const created = await store.createLocalCard(board, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: `/tmp/ws-${title}`,
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
  for (const now of [dayOne, dayTwo]) {
    await store.setSessionStateIfSession(ids.cardId, ids.sessionId, "working");
    await supervisePane({ ...ids, pane: pane("api-error.txt") }, now);
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
