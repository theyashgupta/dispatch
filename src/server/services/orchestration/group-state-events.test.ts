import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { recordGroupState } = await import("./group-state-events.js");

const SBX = parseBoardKey("SBX") as BoardKey;
await store.load();
await store.createBoard({
  key: SBX,
  name: "Sandbox",
  workspaceRoot: "/sbx/sessions",
  repositories: [],
  linearTeamKeys: [],
});
after(() => env.cleanup());

const rows = (cardId: string) =>
  store
    .listOrchestrationEvents(SBX, 0, 500)
    .filter((e) => e.cardId === cardId && e.kind === "group_state");

void test("a group card gets one event with the board key, card id, session id and data", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  recordGroupState(g, "agent_done", "DONE marker");
  const added = rows(g.id);
  assert.equal(added.length, 1);
  assert.equal(added[0].boardKey, SBX);
  assert.equal(added[0].sessionId, g.activeSessionId);
  assert.deepEqual(added[0].data, {
    state: "agent_done",
    reason: "DONE marker",
  });
});

void test("a ticket card and the orchestrator card write no event", async () => {
  const { a } = await startedGroup(store, { board: SBX });
  const hidden = await store.createOrchestratorCard(
    SBX,
    "Orchestrator",
    "main",
  );
  recordGroupState(a, "agent_done", "x");
  recordGroupState(hidden, "agent_done", "x");
  recordGroupState(undefined, "agent_done", "x");
  assert.equal(rows(a.id).length, 0);
  assert.equal(rows(hidden.id).length, 0);
});

void test("a repeat is suppressed and a different state in between allows it", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  recordGroupState(g, "agent_done", "one");
  recordGroupState(g, "agent_done", "two");
  assert.deepEqual(
    rows(g.id).map((e) => e.data.reason),
    ["one"],
  );
  recordGroupState(g, "needs_input", "asks");
  recordGroupState(g, "agent_done", "three");
  assert.deepEqual(
    rows(g.id).map((e) => e.data.state),
    ["agent_done", "needs_input", "agent_done"],
  );
});

void test("a repeat is written again after the card's session went back to working", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  recordGroupState(g, "agent_done", "one");
  const working = (cardId: string) =>
    store.appendOrchestrationEvent({
      boardKey: SBX,
      cardId,
      sessionId: null,
      kind: "supervisor_state",
      data: { from: "idle", to: "working" },
      ts: new Date().toISOString(),
    });
  working("someone-else");
  recordGroupState(g, "agent_done", "same");
  assert.equal(rows(g.id).length, 1);
  working(g.id);
  recordGroupState(g, "agent_done", "again");
  recordGroupState(g, "agent_done", "repeat");
  assert.deepEqual(
    rows(g.id).map((e) => e.data.reason),
    ["one", "again"],
  );
});

void test("a failing append is logged and never thrown", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  const warn = mock.method(console, "warn", () => {});
  const append = mock.method(store, "appendOrchestrationEvent", () => {
    throw new Error("disk full");
  });
  try {
    assert.doesNotThrow(() => recordGroupState(g, "shipped", "x"));
    assert.match(
      String(warn.mock.calls[0]?.arguments[0]),
      /^\[group-state\].*disk full/,
    );
  } finally {
    append.mock.restore();
    warn.mock.restore();
  }
  assert.equal(rows(g.id).length, 0);
});

void test("the repeat rule is per card", async () => {
  const one = (await startedGroup(store, { board: SBX })).g;
  const two = (await startedGroup(store, { board: SBX })).g;
  recordGroupState(one, "shipped", "x");
  recordGroupState(two, "shipped", "x");
  assert.equal(rows(one.id).length, 1);
  assert.equal(rows(two.id).length, 1);
});
