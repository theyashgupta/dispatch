import assert from "node:assert/strict";
import { test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import { issue } from "../test-support/fake-source.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

isolateEnv();
const { store } = await import("./board.store.js");
await store.load();

const TEAM = { id: "team-eng", key: "ENG", name: "Engineering" };
const TODO = { id: "st-todo", name: "Todo", type: "unstarted" };
const DONE = { id: "st-done", name: "Done", type: "completed", position: 4 };

async function linearCard(id: string): Promise<void> {
  await store.applyIssues(
    [issue(id, { team: TEAM, state: TODO })],
    new Date().toISOString(),
  );
  await store.moveCardManual(id, "todo");
  await store.moveCardManual(id, "done");
}

const pushed = (id: string) =>
  store
    .listEvents(DEFAULT_BOARD_KEY, id, 20)
    .filter((e) => e.type === "linear_state_pushed");

test("a recorded success sets the state and its hold, clears the notice, and writes one event", async () => {
  await linearCard("s1");
  await store.setLinearError("s1", "old notice");
  await store.recordLinearPush("s1", {
    ok: true,
    state: DONE,
    fromCol: "todo",
    toCol: "done",
  });
  const card = store.getCard("s1");
  assert.deepEqual(card?.linearState, {
    id: "st-done",
    name: "Done",
    type: "completed",
    color: undefined,
  });
  assert.equal(card?.pendingState?.id, "st-done");
  assert.equal(card?.linearError, null);
  const events = pushed("s1");
  assert.equal(events.length, 1);
  assert.deepEqual(
    [
      events[0]?.source,
      events[0]?.fromCol,
      events[0]?.toCol,
      events[0]?.reason,
    ],
    ["user", "todo", "done", "Done"],
  );
});

test("a recorded failure sets the notice and leaves column, state and hold untouched", async () => {
  await linearCard("s2");
  const copy =
    "Linear state not updated. Linear could not be reached. Try again.";
  await store.recordLinearPush("s2", {
    ok: false,
    copy,
    fromCol: "todo",
    toCol: "done",
  });
  const card = store.getCard("s2");
  assert.equal(card?.column, "done");
  assert.equal(card?.linearState?.id, "st-todo");
  assert.equal(card?.pendingState, undefined);
  assert.equal(card?.linearError, copy);
  assert.equal(pushed("s2")[0]?.reason, `failed: ${copy}`);
});
