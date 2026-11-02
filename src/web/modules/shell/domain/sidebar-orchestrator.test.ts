import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, OrchestratorRecord } from "../../../../shared/types.js";
import { sidebarOrchestrator } from "./sidebar-orchestrator.js";

function record(
  role: OrchestratorRecord["role"],
  state: OrchestratorRecord["state"],
): OrchestratorRecord {
  return {
    id: role,
    name: role,
    role,
    state,
    cardId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  } as OrchestratorRecord;
}

function board(
  orchestrators: OrchestratorRecord[],
  supervisor: "on" | "off" = "on",
): Pick<Board, "orchestrators" | "policy"> {
  return { orchestrators, policy: { supervisor } as Board["policy"] };
}

test("no board gives no entry", () => {
  assert.equal(sidebarOrchestrator(null, 3), null);
});

test("a board with no records offers Add orchestrator in the stopped state", () => {
  const entry = sidebarOrchestrator(board([]), 0);
  assert.equal(entry?.hasOrchestrator, false);
  assert.equal(entry?.label, "Add orchestrator");
  assert.equal(entry?.state, "stopped");
});

test("a main record gives the label Orchestrator and its state", () => {
  const entry = sidebarOrchestrator(board([record("main", "running")]), 0);
  assert.equal(entry?.hasOrchestrator, true);
  assert.equal(entry?.label, "Orchestrator");
  assert.equal(entry?.state, "running");
});

test("only an extra record keeps the label Orchestrator and the stopped state", () => {
  const entry = sidebarOrchestrator(board([record("extra", "running")]), 0);
  assert.equal(entry?.hasOrchestrator, true);
  assert.equal(entry?.label, "Orchestrator");
  assert.equal(entry?.state, "stopped");
});

test("hasMain is true only when a main record exists", () => {
  assert.equal(sidebarOrchestrator(board([]), 0)?.hasMain, false);
  assert.equal(
    sidebarOrchestrator(board([record("main", "stopped")]), 0)?.hasMain,
    true,
  );
  assert.equal(
    sidebarOrchestrator(board([record("extra", "running")]), 0)?.hasMain,
    false,
  );
});

test("the needs-you count passes through", () => {
  assert.equal(sidebarOrchestrator(board([]), 7)?.needsYou, 7);
});

test("the badge is null with no orchestrator even with a count", () => {
  assert.equal(sidebarOrchestrator(board([]), 4)?.badge, null);
});

test("the badge is null with an orchestrator and a count of 0", () => {
  assert.equal(
    sidebarOrchestrator(board([record("main", "running")]), 0)?.badge,
    null,
  );
});

test("the badge equals the count with an orchestrator and a count of 2", () => {
  assert.equal(
    sidebarOrchestrator(board([record("main", "running")]), 2)?.badge,
    2,
  );
});

test("stateLabel names each of the four states", () => {
  const labels = {
    running: "Running",
    starting: "Starting",
    stopping: "Stopping",
    stopped: "Stopped",
  } as const;
  for (const [state, label] of Object.entries(labels)) {
    assert.equal(
      sidebarOrchestrator(
        board([record("main", state as OrchestratorRecord["state"])]),
        0,
      )?.stateLabel,
      label,
    );
  }
});

test("canStart is true with no main record or a stopped one while the supervisor is on", () => {
  assert.equal(sidebarOrchestrator(board([]), 0)?.canStart, true);
  assert.equal(
    sidebarOrchestrator(board([record("main", "stopped")]), 0)?.canStart,
    true,
  );
  assert.equal(
    sidebarOrchestrator(board([record("extra", "running")]), 0)?.canStart,
    true,
  );
});

test("canStart is false for a running, starting or stopping main record", () => {
  for (const state of ["running", "starting", "stopping"] as const) {
    assert.equal(
      sidebarOrchestrator(board([record("main", state)]), 0)?.canStart,
      false,
    );
  }
});

test("canStart is false when the supervisor is off", () => {
  assert.equal(sidebarOrchestrator(board([], "off"), 0)?.canStart, false);
  assert.equal(
    sidebarOrchestrator(board([record("main", "stopped")], "off"), 0)?.canStart,
    false,
  );
});
