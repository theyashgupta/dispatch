import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { WorkflowState } from "../../../shared/types.js";
import type { TicketSource } from "../../adapters/source-gateway.js";
import { isolateEnv } from "../../test-support/fixtures.js";
import { issue } from "../../test-support/fake-source.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setOrchestrationConfig } = await import("../infra/config-holder.js");
const outbound = await import("./linear-outbound.js");
await store.load();

const TEAM = { id: "team-eng", key: "ENG", name: "Engineering" };
const STATES: WorkflowState[] = [
  { id: "st-todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "st-review", name: "In Review", type: "started", position: 3 },
  { id: "st-done", name: "Done", type: "completed", position: 4 },
];
const TODO = { id: "st-todo", name: "Todo", type: "unstarted" };

function fakeLinear(
  opts: { withWorkflow?: boolean; pollThrows?: boolean } = {},
) {
  const sent: string[] = [];
  const source = {
    ...(opts.withWorkflow === false
      ? {}
      : {
          workflow: () =>
            Promise.resolve({
              viewerId: "user-me",
              teams: [{ ...TEAM, states: STATES }],
            }),
        }),
    updateState: (issueId: string, stateId: string) => {
      sent.push(`${issueId}:${stateId}`);
      return Promise.resolve();
    },
  } as unknown as TicketSource;
  const deps = {
    source: () => source,
    poll: () => {
      if (opts.pollThrows) throw new Error("poll exploded");
      return true;
    },
    now: Date.now,
  };
  return { sent, deps };
}

async function todoCard(id: string): Promise<void> {
  await store.applyIssues(
    [issue(id, { team: TEAM, state: TODO })],
    new Date().toISOString(),
  );
  await store.moveCardManual(id, "todo");
}

beforeEach(() => {
  outbound.invalidateWorkflow();
  setOrchestrationConfig({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k" } },
  });
});

test("a chosen state missing from the team inside the chain fails and records the notice", async () => {
  await todoCard("m1");
  const fake = fakeLinear();
  const result = await outbound.setLinearState("m1", "st-gone", fake.deps);
  const copy =
    "Linear state not updated. The chosen state is no longer on the card's team.";
  assert.deepEqual(result, { ok: false, error: copy });
  assert.deepEqual(fake.sent, []);
  assert.equal(store.getCard("m1")?.linearError, copy);
});

test("a push that throws inside the chain answers a failure, never a success", async () => {
  await todoCard("m2");
  const fake = fakeLinear({ pollThrows: true });
  const result = await outbound.setLinearState("m2", "st-review", fake.deps);
  const copy = "Linear state not updated. Try again.";
  assert.deepEqual(result, { ok: false, error: copy });
  assert.equal(store.getCard("m2")?.linearError, copy);
});

test("a source without a workflow read answers 409 and writes nothing", async () => {
  await todoCard("m3");
  const fake = fakeLinear({ withWorkflow: false });
  const outcome = await outbound.moveLinearState("m3", "st-review", fake.deps);
  assert.deepEqual(outcome, {
    ok: false,
    status: 409,
    error: "Linear is not connected",
  });
  assert.deepEqual(fake.sent, []);
  assert.equal(store.getCard("m3")?.linearError ?? null, null);
});

test("a target equal to the pending state sends nothing", async () => {
  await todoCard("m4");
  const card = store.getCard("m4");
  assert.ok(card);
  card.pendingState = { id: "st-review", at: new Date().toISOString() };
  const fake = fakeLinear();
  const result = await outbound.setLinearState("m4", "st-review", fake.deps);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fake.sent, []);
});
