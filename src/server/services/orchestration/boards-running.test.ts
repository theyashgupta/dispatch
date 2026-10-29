import test, { after } from "node:test";
import assert from "node:assert/strict";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey, Card, LoopEngine } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { LOOP_PROGRESS } =
  await import("../../test-support/supervised-session.js");
const { runningLoops } = await import("./boards.js");

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

const OPEN: LoopEngine = {
  active: true,
  iteration: 2,
  sessionId: "conv",
  handoffPending: false,
  startedAt: null,
  closed: false,
};
const CLOSED: LoopEngine = {
  ...OPEN,
  active: false,
  closed: true,
  closedReason: "promise",
};

async function loopGroup(engine: LoopEngine | null): Promise<Card> {
  const { g } = await startedGroup(store, { board: SBX });
  await store.setLoopProgress(g.id, { ...LOOP_PROGRESS, engine });
  return store.getCard(g.id)!;
}

async function launchedTicket(engine: LoopEngine | null): Promise<Card> {
  const card = await store.createLocalCard(SBX, "ticket", "");
  await store.completeStart(card.id, undefined, {
    workspacePath: `/tmp/ws-${card.id}`,
    tmuxSession: `dsp-${card.id}`,
    branch: card.id,
  });
  await store.setOrchestratorFields(card.id, {
    launch: { playbook: "Write code directly", direction: "" },
  });
  await store.setLoopProgress(card.id, { ...LOOP_PROGRESS, engine });
  return store.getCard(card.id)!;
}

async function moveToNeedsInput(card: Card): Promise<void> {
  await store.moveCardManual(card.id, "needs_input");
  assert.equal(store.getCard(card.id)?.column, "needs_input");
}

function expectSlot(card: Card, holds: boolean, from: number): void {
  assert.equal(runningLoops(SBX), from + (holds ? 1 : 0));
  assert.equal(runningLoops(SBX, card.id), from);
}

void test("a running group and a running launched card with no engine count", async () => {
  const base = runningLoops(SBX);
  expectSlot(await loopGroup(null), true, base);
  expectSlot(await launchedTicket(null), true, base + 1);
});

void test("a running card with an open engine counts", async () => {
  const base = runningLoops(SBX);
  expectSlot(await loopGroup(OPEN), true, base);
  expectSlot(await launchedTicket(OPEN), true, base + 1);
});

void test("a running card with a closed engine in In progress does not count", async () => {
  const base = runningLoops(SBX);
  const group = await loopGroup(CLOSED);
  assert.equal(group.column, "in_progress");
  expectSlot(group, false, base);
  expectSlot(await launchedTicket(CLOSED), false, base);
});

void test("a finished card does not count: a closed engine in Needs input holds no slot", async () => {
  const base = runningLoops(SBX);
  const group = await loopGroup(CLOSED);
  await moveToNeedsInput(group);
  expectSlot(group, false, base);
  const open = await loopGroup(OPEN);
  await moveToNeedsInput(open);
  expectSlot(open, true, base);
});

void test("a card in Agent done does not count and a card in Done does not count", async () => {
  const base = runningLoops(SBX);
  const waiting = await loopGroup(OPEN);
  assert.equal(runningLoops(SBX), base + 1);
  await store.applyMarker(
    waiting.id,
    undefined,
    "agent_done",
    undefined,
    `marker-${waiting.id}`,
    "status_agent_done",
  );
  assert.equal(store.getCard(waiting.id)?.column, "agent_done");
  assert.equal(runningLoops(SBX), base);
  const finished = await launchedTicket(OPEN);
  assert.equal(runningLoops(SBX), base + 1);
  await store.moveCardManual(finished.id, "done");
  assert.equal(store.getCard(finished.id)?.column, "done");
  assert.equal(runningLoops(SBX), base);
});

void test("a running card that is not a group and has no launch does not count", async () => {
  const base = runningLoops(SBX);
  const card = await store.createLocalCard(SBX, "plain", "");
  await store.completeStart(card.id, undefined, {
    workspacePath: `/tmp/ws-${card.id}`,
    tmuxSession: `dsp-${card.id}`,
    branch: card.id,
  });
  assert.equal(store.getCard(card.id)?.column, "in_progress");
  assert.equal(runningLoops(SBX), base);
});
