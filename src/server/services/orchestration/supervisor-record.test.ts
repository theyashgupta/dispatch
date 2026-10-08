import test, { after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import type { Card, Session } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { continueText, markNeedsInput, record, rootOf } =
  await import("./supervisor-record.js");
const { loopFilePath } = await import("../domain/loop-progress.js");
const { LOOP_PROGRESS, SBX, setupSupervisedBoard } =
  await import("../../test-support/supervised-session.js");

await setupSupervisedBoard();
after(() => env.cleanup());

async function startedCard(title: string) {
  const created = await store.createLocalCard(SBX, title, "");
  await store.completeStart(created.id, undefined, {
    workspacePath: path.join(env.root, title),
    tmuxSession: `dsp-${title}`,
    branch: title,
  });
  const card = () => store.getCard(created.id)!;
  const session = () =>
    card().sessions!.find((s) => s.id === card().activeSessionId)!;
  return { card, session };
}

const rows = (cardId: string, kind: string) =>
  store
    .listOrchestrationEvents(SBX, 0, 500)
    .filter((e) => e.cardId === cardId && e.kind === kind);

void test("record appends one supervisor_action event with the board key, card and session ids", async () => {
  const { card, session } = await startedCard("record-one");
  record(card(), session(), { action: "continue", result: "confirmed" });
  const added = rows(card().id, "supervisor_action");
  assert.equal(added.length, 1);
  assert.equal(added[0].boardKey, SBX);
  assert.equal(added[0].cardId, card().id);
  assert.equal(added[0].sessionId, session().id);
  assert.deepEqual(added[0].data, { action: "continue", result: "confirmed" });
});

void test("markNeedsInput writes the state and reason, moves the card once and appends one state and one action row", async () => {
  const { card, session } = await startedCard("needs");
  assert.notEqual(card().column, "needs_input");
  await markNeedsInput(card(), session(), "supervisor_gave_up", "idle twice");
  assert.equal(session().state, "needs_input");
  assert.equal(session().stateReason, "supervisor_gave_up");
  assert.equal(card().column, "needs_input");
  const states = rows(card().id, "supervisor_state");
  assert.equal(states.length, 1);
  assert.equal(states[0].sessionId, session().id);
  assert.equal(states[0].data.to, "needs_input");
  assert.equal(states[0].data.reason, "supervisor_gave_up");
  assert.equal(states[0].data.evidence, "idle twice");
  const actions = rows(card().id, "supervisor_action");
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].data, {
    action: "needs_input",
    reason: "supervisor_gave_up",
    evidence: "idle twice",
  });
  const marker = card().lastMarker;
  assert.match(String(marker), /^supervisor:/);
  await markNeedsInput(card(), session(), "usage_stop", "again");
  assert.equal(card().lastMarker, marker);
  assert.equal(card().column, "needs_input");
  assert.equal(session().stateReason, "usage_stop");
});

void test("continueText names the loop progress and resume files for the restart duty", async () => {
  const { card, session } = await startedCard("continue");
  await store.setLoopProgress(card().id, LOOP_PROGRESS);
  const root = rootOf(card(), session());
  const text = continueText(card(), session(), "restart");
  assert.ok(text.startsWith("The loop stopped without a marker."));
  assert.ok(
    text.includes(
      path.join(root, loopFilePath(LOOP_PROGRESS.slug, "progress.md")),
    ),
  );
  assert.ok(
    text.includes(
      path.join(root, loopFilePath(LOOP_PROGRESS.slug, "resume.md")),
    ),
  );
});

void test("continueText without a loop only asks to continue", async () => {
  const { card, session } = await startedCard("no-loop");
  assert.equal(
    continueText(card(), session(), "api_error"),
    "The last turn ended on an API error. Continue from where you stopped.",
  );
});

void test("rootOf prefers the session workspace path over the card one and never reads the workspace folder", () => {
  const card = { workspacePath: "/card/path" } as Card;
  const withPath = {
    workspacePath: "/session/root",
    workspace: { folder: "/source/folder", repos: [] },
  } as unknown as Session;
  const folderOnly = {
    workspace: { folder: "/source/folder", repos: [] },
  } as unknown as Session;
  assert.equal(rootOf(card, withPath), "/session/root");
  assert.equal(rootOf(card, folderOnly), "/card/path");
  assert.equal(rootOf({} as unknown as Card, folderOnly), "");
});
