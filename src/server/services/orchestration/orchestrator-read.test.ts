import test, { after } from "node:test";
import assert from "node:assert/strict";
import { parseBoardKey } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { startedGroup } from "../../test-support/group-fixtures.js";
import { ConflictError, ValidationError } from "../domain/errors.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { LOOP_PROGRESS } =
  await import("../../test-support/supervised-session.js");
const {
  cardWithMembers,
  eventsAfter,
  groupCost,
  groupProgress,
  paneReader,
  paneTail,
  policySummary,
} = await import("./orchestrator-read.js");

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

const meter = (cost: number) => ({
  contextPercent: 10,
  model: "opus",
  cost,
  usage: { fiveHourPercent: 1, sevenDayPercent: 1 },
});

void test("cardWithMembers returns the members of a group and none for a plain card", async () => {
  const { g, a, b } = await startedGroup(store, { board: SBX });
  const group = cardWithMembers(g);
  assert.equal(group.card.id, g.id);
  assert.deepEqual(group.members.map((m) => m.id).sort(), [a.id, b.id].sort());
  const plain = await store.createLocalCard(SBX, "plain", "");
  assert.deepEqual(cardWithMembers(plain).members, []);
});

void test("groupProgress returns the loop progress of a group and refuses a plain card", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  await store.setLoopProgress(g.id, LOOP_PROGRESS);
  assert.deepEqual(groupProgress(store.getCard(g.id)!), {
    cardId: g.id,
    loopProgress: LOOP_PROGRESS,
  });
  const plain = await store.createLocalCard(SBX, "plain", "");
  assert.throws(
    () => groupProgress(plain),
    (err) => err instanceof ValidationError && err.code === "not-group-card",
  );
});

void test("paneTail returns the last lines without the blank rows and refuses a card with no live session", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  const targets: string[] = [];
  paneReader.capture = (target) => {
    targets.push(target);
    return Promise.resolve("one\ntwo\nthree\n\n  \n");
  };
  const tail = await paneTail(g, 2);
  assert.deepEqual(tail.lines, ["two", "three"]);
  assert.deepEqual(targets, [`=${g.tmuxSession}:`]);
  const plain = await store.createLocalCard(SBX, "plain", "");
  paneReader.capture = () => Promise.resolve("x");
  await assert.rejects(
    paneTail(plain, 5),
    (err) => err instanceof ConflictError && err.code === "no-live-session",
  );
  paneReader.capture = () => Promise.reject(new Error("gone"));
  await assert.rejects(
    paneTail(g, 5),
    (err) => err instanceof ConflictError && err.code === "no-live-session",
  );
});

void test("eventsAfter returns the board events after the cursor and keeps the cursor when there are none", () => {
  const ids = [1, 2, 3].map(
    () =>
      store.appendOrchestrationEvent({
        boardKey: SBX,
        cardId: null,
        sessionId: null,
        kind: "pr_state",
        data: {},
        ts: new Date().toISOString(),
      }).id,
  );
  const page = eventsAfter(SBX, ids[0] - 1, 2);
  assert.deepEqual(
    page.events.map((e) => e.id),
    ids.slice(0, 2),
  );
  assert.equal(page.cursor, ids[1]);
  assert.deepEqual(eventsAfter(SBX, ids[2], 10), {
    events: [],
    cursor: ids[2],
  });
});

void test("groupCost adds a meter that restarted from zero to the cost before the restart", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  const set = (cost: number) =>
    store.setSessionMetersIfSession(g.id, g.tmuxSession!, meter(cost));
  await set(3);
  assert.equal(groupCost(store.getCard(g.id)!), 3);
  await set(0.5);
  assert.equal(groupCost(store.getCard(g.id)!), 3.5);
  assert.equal(groupCost(await store.createLocalCard(SBX, "plain", "")), 0);
});

void test("policySummary lists the groups of the board with the policy budget and cap", async () => {
  const { g } = await startedGroup(store, { board: SBX });
  await store.setBoardPolicy(SBX, {
    ...store.getBoard(SBX)!.policy,
    concurrencyCap: 4,
    budgetPerGroup: 9,
  });
  const summary = await policySummary({
    boardKey: SBX,
    orchestratorId: "orc",
  });
  assert.equal(summary.concurrencyCap, 4);
  assert.ok(summary.runningLoops >= 1);
  const entry = summary.groups.find((x) => x.cardId === g.id);
  assert.equal(entry?.budget, 9);
  assert.deepEqual(
    (
      await policySummary({
        boardKey: "GONE" as BoardKey,
        orchestratorId: "orc",
      })
    ).policy,
    null,
  );
});
