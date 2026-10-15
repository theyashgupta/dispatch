import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CENTRE_CONTROL_LABELS,
  contextText,
  costText,
  countsText,
  orchestratorsTabLabel,
  regionErrorText,
  regionState,
  selectedRecord,
  showSwitcher,
  switcherOptions,
  tileMeters,
  unknownOrchestrator,
} from "./centre-page-state.js";
import type { OrchestratorView } from "./centre-model.js";

function record(
  id: string,
  role: "main" | "extra",
  state: OrchestratorView["state"],
  session: Partial<NonNullable<OrchestratorView["session"]>> | null = null,
): OrchestratorView {
  return {
    id,
    name: `Name ${id}`,
    role,
    scope: { groupIds: [], ticketIds: [] },
    policyOverride: {},
    cardId: session === null ? null : "card-1",
    state,
    createdAt: "2026-10-08T00:00:00.000Z",
    session:
      session === null
        ? null
        : {
            cardId: "card-1",
            state: null,
            stateReason: null,
            contextPercent: null,
            cost: null,
            model: null,
            hasTmuxSession: true,
            activeSessionId: "s1",
            ttydPort: 7000,
            stateSince: null,
            startError: null,
            ...session,
          },
  };
}

test("the counts text follows the spec pattern for zero, one and many", () => {
  assert.equal(countsText(0, 0), "0 branches, 0 need you");
  assert.equal(countsText(1, 1), "1 branch, 1 need you");
  assert.equal(countsText(3, 2), "3 branches, 2 need you");
});

test("the control labels are the spec copy", () => {
  assert.deepEqual(CENTRE_CONTROL_LABELS, {
    start: "Start",
    stop: "Stop",
    resume: "Resume",
  });
});

test("the context and cost texts follow the spec copy", () => {
  assert.equal(contextText(42), "Context 42%");
  assert.equal(contextText(0), "Context 0%");
  assert.equal(costText(3.5), "$3.50 today");
  assert.equal(costText(0), "$0.00 today");
  assert.equal(costText(12.345), "$12.35 today");
});

test("a planned branch with no session shows Not started in place of the meters", () => {
  assert.deepEqual(
    tileMeters({ state: "planned", contextPercent: null, cost: null }),
    ["Not started"],
  );
});

test("a running branch shows the meters it has and never Not started", () => {
  assert.deepEqual(
    tileMeters({ state: "running", contextPercent: 61, cost: 1.2 }),
    ["Context 61%", "$1.20"],
  );
  assert.deepEqual(
    tileMeters({ state: "running", contextPercent: null, cost: 0.5 }),
    ["$0.50"],
  );
  assert.deepEqual(
    tileMeters({ state: "running", contextPercent: null, cost: null }),
    [],
  );
});

test("the region state is loading, error, empty or ready", () => {
  assert.equal(
    regionState({ loading: true, error: false, empty: false }),
    "loading",
  );
  assert.equal(
    regionState({ loading: false, error: true, empty: false }),
    "error",
  );
  assert.equal(
    regionState({ loading: false, error: false, empty: true }),
    "empty",
  );
  assert.equal(
    regionState({ loading: false, error: false, empty: false }),
    "ready",
  );
});

test("an error wins over loading and empty, and loading wins over empty", () => {
  assert.equal(
    regionState({ loading: true, error: true, empty: true }),
    "error",
  );
  assert.equal(
    regionState({ loading: true, error: false, empty: true }),
    "loading",
  );
});

test("the region error text follows the spec copy and drops a trailing period", () => {
  assert.equal(
    regionErrorText("Canvas", "offline"),
    "Canvas did not load: offline.",
  );
  assert.equal(
    regionErrorText("Canvas", "offline."),
    "Canvas did not load: offline.",
  );
});

test("the switcher shows only with two or more orchestrators", () => {
  const main = record("main", "main", "running");
  const extra = record("extra-1", "extra", "stopped");
  assert.equal(showSwitcher([]), false);
  assert.equal(showSwitcher([main]), false);
  assert.equal(showSwitcher([main, extra]), true);
});

test("the switcher lists each orchestrator with Main or Extra", () => {
  assert.deepEqual(
    switcherOptions([
      record("main", "main", "running"),
      record("extra-1", "extra", "stopped"),
    ]),
    [
      { value: "main", label: "Name main (Main)" },
      { value: "extra-1", label: "Name extra-1 (Extra)" },
    ],
  );
});

test("the page shows the orchestrator in the path, the main one with no path id, and none for an unknown id", () => {
  const main = record("main", "main", "running");
  const extra = record("extra-1", "extra", "stopped");
  assert.equal(selectedRecord([extra, main], undefined)?.id, "main");
  assert.equal(selectedRecord([main, extra], "extra-1")?.id, "extra-1");
  assert.equal(selectedRecord([], undefined), null);
  assert.equal(selectedRecord([main, extra], "ghost"), null);
});

test("an id that no record has is unknown, and no id is never unknown", () => {
  const main = record("main", "main", "running");
  assert.equal(unknownOrchestrator([main], "ghost"), true);
  assert.equal(unknownOrchestrator([main], "main"), false);
  assert.equal(unknownOrchestrator([main], undefined), false);
});

test("the Orchestrators tab shows its count once the records loaded", () => {
  assert.equal(orchestratorsTabLabel(null), "Orchestrators");
  assert.equal(orchestratorsTabLabel(0), "Orchestrators (0)");
  assert.equal(orchestratorsTabLabel(2), "Orchestrators (2)");
});
