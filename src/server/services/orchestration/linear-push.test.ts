import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { LinearStateMap, WorkflowState } from "../../../shared/types.js";
import type { TicketSource } from "../../adapters/source-gateway.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { issue } from "../../test-support/fake-source.js";
import { restoreFetch } from "../../test-support/linear-fetch.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const outbound = await import("./linear-outbound.js");
await store.load();

const TEAM = { id: "team-eng", key: "ENG", name: "Engineering" };
const STATES: WorkflowState[] = [
  { id: "st-backlog", name: "Backlog", type: "backlog", position: 0 },
  { id: "st-todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "st-progress", name: "In Progress", type: "started", position: 2 },
  { id: "st-review", name: "In Review", type: "started", position: 3 },
  { id: "st-done", name: "Done", type: "completed", position: 4 },
];
const TODO = { id: "st-todo", name: "Todo", type: "unstarted" };

class AuthError extends Error {
  override name = "LinearAuthError";
}

function fakeLinear(
  opts: { slowState?: string; fail?: Error; workflowFail?: Error } = {},
) {
  const sent: string[] = [];
  const polls: string[] = [];
  const source = {
    workflow: () =>
      opts.workflowFail
        ? Promise.reject(opts.workflowFail)
        : Promise.resolve({
            viewerId: "user-me",
            teams: [{ ...TEAM, states: STATES }],
          }),
    updateState: async (issueId: string, stateId: string) => {
      if (stateId === opts.slowState) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (opts.fail) throw opts.fail;
      sent.push(`${issueId}:${stateId}`);
    },
  } as unknown as TicketSource;
  const deps = {
    source: () => source,
    poll: (id: string) => {
      polls.push(id);
      return true;
    },
    now: Date.now,
  };
  return { sent, polls, deps };
}

function useMap(stateMap: LinearStateMap = {}): void {
  setOrchestrationConfig({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k", stateMap } },
  });
}

async function todoCard(id: string): Promise<void> {
  await store.applyIssues(
    [issue(id, { team: TEAM, state: TODO })],
    new Date().toISOString(),
  );
  await store.moveCardManual(id, "todo");
}

function move(id: string, column: "todo" | "in_review" | "parked" | "done") {
  return store.moveCardManual(id, column);
}

const pushedEvents = (id: string) =>
  store.listEvents(id, 20).filter((e) => e.type === "linear_state_pushed");

after(restoreFetch);

beforeEach(() => {
  outbound.invalidateWorkflow();
  useMap();
});

test("a move from To Do to Done pushes the completed state, then polls once", async () => {
  await todoCard("p1");
  const fake = fakeLinear();
  await outbound.pushColumnChanges(await move("p1", "done"), fake.deps);
  assert.deepEqual(fake.sent, ["p1:st-done"]);
  assert.deepEqual(fake.polls, ["linear"]);
  const card = store.getCard("p1");
  assert.equal(card?.linearState?.id, "st-done");
  assert.equal(card?.pendingState?.id, "st-done");
  assert.equal(pushedEvents("p1")[0]?.reason, "Done");
});

test("two quick moves reach Linear in move order", async () => {
  useMap({ "team-eng": { in_review: "st-review", parked: "st-backlog" } });
  await todoCard("p2");
  const fake = fakeLinear({ slowState: "st-review" });
  const first = outbound.pushColumnChanges(
    await move("p2", "in_review"),
    fake.deps,
  );
  const second = outbound.pushColumnChanges(
    await move("p2", "parked"),
    fake.deps,
  );
  await Promise.all([first, second]);
  assert.deepEqual(fake.sent, ["p2:st-review", "p2:st-backlog"]);
  assert.equal(store.getCard("p2")?.linearState?.id, "st-backlog");
});

test("a target equal to the current state sends nothing and records nothing", async () => {
  await todoCard("p3");
  await store.moveCardManual("p3", "in_review");
  const fake = fakeLinear();
  await outbound.pushColumnChanges(await move("p3", "todo"), fake.deps);
  assert.deepEqual(fake.sent, []);
  assert.deepEqual(pushedEvents("p3"), []);
});

test("Done mapped to do not sync sends nothing and writes no event", async () => {
  useMap({ "team-eng": { done: null } });
  await todoCard("p4");
  const fake = fakeLinear();
  await outbound.pushColumnChanges(await move("p4", "done"), fake.deps);
  assert.deepEqual(fake.sent, []);
  assert.deepEqual(fake.polls, []);
  assert.deepEqual(pushedEvents("p4"), []);
});

test("an auth failure keeps the column and state and records the fixed copy", async () => {
  await todoCard("p5");
  const fake = fakeLinear({ fail: new AuthError("401") });
  await outbound.pushColumnChanges(await move("p5", "done"), fake.deps);
  const card = store.getCard("p5");
  const copy =
    "Linear state not updated. Linear rejected the API key. Check it in Settings.";
  assert.equal(card?.column, "done");
  assert.equal(card?.linearState?.id, "st-todo");
  assert.equal(card?.pendingState, undefined);
  assert.equal(card?.linearError, copy);
  assert.equal(pushedEvents("p5")[0]?.reason, `failed: ${copy}`);
  assert.deepEqual(fake.polls, []);
});

test("setLinearState pushes the chosen state without a map lookup", async () => {
  await todoCard("p6");
  const fake = fakeLinear();
  await outbound.setLinearState("p6", "st-review", fake.deps);
  assert.deepEqual(fake.sent, ["p6:st-review"]);
  assert.equal(store.getCard("p6")?.pendingState?.id, "st-review");
});

test("a card without a team or from another source is never pushed", async () => {
  await store.applyIssues(
    [issue("p7", { state: TODO })],
    new Date().toISOString(),
  );
  await store.moveCardManual("p7", "todo");
  const local = await store.createLocalCard("Local", "Body");
  const fake = fakeLinear();
  await outbound.pushColumnChanges(
    [...(await move("p7", "done")), ...(await move(local.id, "done"))],
    fake.deps,
  );
  assert.deepEqual(fake.sent, []);
});

function spyPushMarks(): string[] {
  const marked: string[] = [];
  const original = store.setPushing.bind(store);
  store.setPushing = (id: string, pushing: boolean) => {
    if (pushing) marked.push(id);
    original(id, pushing);
  };
  return marked;
}

test("agent marker and flip-back moves never queue a Linear push", async () => {
  const marked = spyPushMarks();
  await todoCard("p8");
  await store.moveCardManual("p8", "in_review");
  await store.applyMarker(
    "p8",
    undefined,
    "needs_input",
    "blocked",
    "marker-1",
    "status_needs_input",
  );
  assert.equal(store.getCard("p8")?.column, "needs_input");
  assert.equal(await store.flipBack("p8", undefined), true);
  assert.equal(store.getCard("p8")?.column, "in_progress");
  assert.deepEqual(marked, []);
  assert.deepEqual(pushedEvents("p8"), []);
});

test("two overlapping moves on one card record their own columns", async () => {
  useMap({ "team-eng": { in_review: "st-review", parked: "st-backlog" } });
  await todoCard("p9");
  const fake = fakeLinear();
  const moveAndPush = async (column: "in_review" | "parked") => {
    await outbound.pushColumnChanges(
      await store.moveCardManual("p9", column),
      fake.deps,
    );
  };
  await Promise.all([moveAndPush("in_review"), moveAndPush("parked")]);
  assert.deepEqual(fake.sent, ["p9:st-review", "p9:st-backlog"]);
  assert.deepEqual(
    pushedEvents("p9")
      .map((e) => `${e.fromCol}>${e.toCol}`)
      .reverse(),
    ["todo>in_review", "in_review>parked"],
  );
});

test("a poll that lands while a Done card's push to To Do is in flight keeps the card", async () => {
  await todoCard("p10");
  const fake = fakeLinear({ slowState: "st-todo" });
  await outbound.pushColumnChanges(await move("p10", "done"), fake.deps);
  const done = store.getCard("p10");
  assert.ok(done);
  done.pendingState = undefined;
  const pushing = outbound.pushColumnChanges(
    await move("p10", "todo"),
    fake.deps,
  );
  await store.applyIssues([], new Date().toISOString(), {
    tracked: { issues: [], requested: new Set() },
  });
  assert.equal(store.getCard("p10")?.column, "todo");
  await pushing;
  assert.deepEqual(fake.sent, ["p10:st-done", "p10:st-todo"]);
  assert.equal(store.getCard("p10")?.pendingState?.id, "st-todo");

  await new Promise((resolve) => setImmediate(resolve));
  const settled = store.getCard("p10");
  assert.ok(settled);
  settled.pendingState = undefined;
  await store.applyIssues([], new Date().toISOString(), {
    tracked: { issues: [], requested: new Set() },
  });
  assert.equal(store.getCard("p10"), undefined);
});

test("a workflow read failure on a mapped move records the notice and sends nothing", async () => {
  await todoCard("p11");
  const fake = fakeLinear({ workflowFail: new AuthError("401") });
  await outbound.pushColumnChanges(await move("p11", "done"), fake.deps);
  const copy =
    "Linear state not updated. Linear rejected the API key. Check it in Settings.";
  assert.deepEqual(fake.sent, []);
  assert.equal(store.getCard("p11")?.linearError, copy);
  assert.equal(pushedEvents("p11")[0]?.reason, `failed: ${copy}`);
});

test("a do-not-sync move records nothing even when Linear is unreachable", async () => {
  useMap({ "team-eng": { done: null } });
  await todoCard("p12");
  const fake = fakeLinear({ workflowFail: new AuthError("401") });
  await outbound.pushColumnChanges(await move("p12", "in_review"), fake.deps);
  await outbound.pushColumnChanges(await move("p12", "done"), fake.deps);
  assert.deepEqual(fake.sent, []);
  assert.equal(store.getCard("p12")?.linearError ?? null, null);
  assert.deepEqual(pushedEvents("p12"), []);
});

test("a card whose team is missing from the workflow sends and records nothing", async () => {
  await store.applyIssues(
    [
      issue("p13", {
        team: { id: "team-gone", key: "GONE", name: "Gone" },
        state: TODO,
      }),
    ],
    new Date().toISOString(),
  );
  await store.moveCardManual("p13", "todo");
  const fake = fakeLinear();
  await outbound.pushColumnChanges(await move("p13", "done"), fake.deps);
  assert.deepEqual(fake.sent, []);
  assert.equal(store.getCard("p13")?.linearError ?? null, null);
  assert.deepEqual(pushedEvents("p13"), []);
});
