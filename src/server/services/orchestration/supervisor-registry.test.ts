import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isolateEnv } from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

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
