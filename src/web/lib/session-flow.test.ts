import test from "node:test";
import assert from "node:assert/strict";
import { hasSessionFlow, sessionFlowStage } from "./session-flow.js";

type Fields = Parameters<typeof sessionFlowStage>[0];

function card(fields: Partial<Fields>): Fields {
  return { column: "todo", ...fields };
}

const startError = { step: "creating worktrees", stderr: "boom" };

void test("a start error reads agent failed whatever the column", () => {
  assert.deepEqual(
    sessionFlowStage(card({ column: "in_progress", startError })),
    { stage: "agent", state: "failed" },
  );
});

void test("a provisioning step reads agent working", () => {
  assert.deepEqual(
    sessionFlowStage(card({ column: "todo", provisioningStep: "worktree" })),
    { stage: "agent", state: "working" },
  );
});

void test("a lost session never reads as working or waiting", () => {
  for (const column of ["in_progress", "needs_input"] as const) {
    assert.deepEqual(
      sessionFlowStage(
        card({ column, tmuxSession: "dsp-LOCAL-1", sessionLost: true }),
      ),
      { stage: "terminal", state: "lost" },
    );
  }
});

void test("in progress with a live tmux session reads terminal working", () => {
  assert.deepEqual(
    sessionFlowStage(card({ column: "in_progress", tmuxSession: "dsp-L-1" })),
    { stage: "terminal", state: "working" },
  );
  assert.deepEqual(sessionFlowStage(card({ column: "in_progress" })), {
    stage: "item",
    state: "idle",
  });
});

void test("needs input reads terminal waiting", () => {
  assert.deepEqual(sessionFlowStage(card({ column: "needs_input" })), {
    stage: "terminal",
    state: "waiting",
  });
});

void test("result reads done only from agent_done on", () => {
  for (const column of ["agent_done", "in_review", "done"] as const) {
    assert.deepEqual(sessionFlowStage(card({ column })), {
      stage: "result",
      state: "done",
    });
  }
  for (const column of [
    "todo",
    "inbox",
    "in_progress",
    "needs_input",
    "parked",
  ] as const) {
    assert.notEqual(sessionFlowStage(card({ column })).state, "done");
  }
});

void test("parked reads terminal idle and anything else item idle", () => {
  assert.deepEqual(sessionFlowStage(card({ column: "parked" })), {
    stage: "terminal",
    state: "idle",
  });
  for (const column of ["todo", "inbox"] as const) {
    assert.deepEqual(sessionFlowStage(card({ column })), {
      stage: "item",
      state: "idle",
    });
  }
});

void test("the row shows only for a card with a session or a start attempt", () => {
  assert.equal(hasSessionFlow({}), false);
  assert.equal(hasSessionFlow({ activeSessionId: "" }), false);
  assert.equal(hasSessionFlow({ tmuxSession: "dsp-LOCAL-1" }), true);
  assert.equal(hasSessionFlow({ activeSessionId: "s-LOCAL-2" }), true);
  assert.equal(hasSessionFlow({ provisioningStep: "worktree" }), true);
  assert.equal(hasSessionFlow({ startError }), true);
});

void test("a start error wins over provisioning, which wins over a lost session", () => {
  assert.deepEqual(
    sessionFlowStage(
      card({
        column: "in_progress",
        startError,
        provisioningStep: "worktree",
        sessionLost: true,
      }),
    ),
    { stage: "agent", state: "failed" },
  );
  assert.deepEqual(
    sessionFlowStage(
      card({
        column: "needs_input",
        provisioningStep: "worktree",
        sessionLost: true,
      }),
    ),
    { stage: "agent", state: "working" },
  );
});
