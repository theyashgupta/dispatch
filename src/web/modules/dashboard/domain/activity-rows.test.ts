import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type {
  Card,
  OrchestrationEvent,
  OrchestrationEventKind,
} from "../../../../shared/types.js";
import { ACTIVITY_PAGE_SIZE, activityRows } from "./activity-rows.js";

const CARDS = [
  { id: "c13", identifier: "GROUP-13" },
  { id: "c14", identifier: "GROUP-14" },
  { id: "m1", identifier: "LOCAL-1", groupId: "c14" },
] as Card[];

function event(
  id: number,
  kind: OrchestrationEventKind,
  cardId: string | null,
  data: Record<string, unknown>,
  ts = `2026-10-07T10:${String(id).padStart(2, "0")}:00Z`,
): OrchestrationEvent {
  return {
    id,
    boardKey: DEFAULT_BOARD_KEY,
    cardId,
    sessionId: null,
    kind,
    data,
    ts,
  };
}

const HASH = "#";
const UTC = { actor: "all", timeZone: "UTC" } as const;

function texts(events: OrchestrationEvent[]) {
  return activityRows(events, CARDS, UTC).map((r) => r.text);
}

test("tool calls read tool, group and result", () => {
  assert.deepEqual(
    texts([
      event(1, "tool_call", "c13", { tool: "send_input", result: "confirmed" }),
      event(2, "tool_call", null, { tool: "list_cards", result: "ok" }),
      event(3, "tool_call", "c13", { tool: "get_card" }),
    ]),
    [
      "get_card to GROUP-13",
      "list_cards: ok",
      "send_input to GROUP-13: confirmed",
    ],
  );
});

test("gates, states, decisions, prs and wake have fixed copy", () => {
  assert.deepEqual(
    texts([
      event(1, "loop_gate", "c14", { phase: 3, result: "pass" }),
      event(2, "loop_gate", "c14", { phase: 4, result: "fail" }),
      event(3, "supervisor_state", "c14", { to: "usage_limit_wait" }),
      event(4, "decision_raised", "c14", {}),
      event(5, "decision_answered", "c14", {}),
      event(6, "pr_state", "c14", {
        from: [[177, "open"]],
        to: [[177, "merged"]],
      }),
      event(7, "machine_wake", null, {}),
    ]).reverse(),
    [
      "phase 3 gate passed on GROUP-14",
      "phase 4 gate failed on GROUP-14",
      "GROUP-14 is now Waiting for usage reset",
      "raised a decision for GROUP-14",
      "answered a decision for GROUP-14",
      `PR ${HASH}177 is merged for GROUP-14`,
      "the machine woke",
    ],
  );
});

test("supervisor actions use the map and unknown ones fall back", () => {
  assert.deepEqual(
    texts([
      event(1, "supervisor_action", "c14", { action: "continue" }),
      event(2, "supervisor_action", "c14", { action: "limit_wait" }),
      event(3, "supervisor_action", "c14", { action: "resume" }),
      event(4, "supervisor_action", "c14", { action: "handoff_request" }),
      event(5, "supervisor_action", "c14", { action: "close_loop" }),
      event(6, "supervisor_action", "c14", { action: "budget_release" }),
      event(7, "supervisor_action", "c14", { action: "needs_input" }),
      event(8, "supervisor_action", "c14", { action: "mystery" }),
    ]).reverse(),
    [
      "sent one continue prompt to GROUP-14",
      "selected wait at the usage limit dialog",
      "resumed GROUP-14",
      "requested a handoff from GROUP-14",
      "closed the loop of GROUP-14",
      "released the budget stop of GROUP-14",
      "moved GROUP-14 to Needs input",
      "mystery on GROUP-14",
    ],
  );
});

test("rows are newest first with a 24 hour time and the actor", () => {
  const rows = activityRows(
    [
      event(1, "decision_answered", "c14", {}, "2026-10-07T09:05:00Z"),
      event(2, "tool_call", "c13", { tool: "t" }, "2026-10-07T13:41:00Z"),
      event(3, "machine_wake", null, {}, "2026-10-07T11:00:00Z"),
    ],
    CARDS,
    UTC,
  );
  assert.deepEqual(
    rows.map((r) => [r.time, r.actor]),
    [
      ["13:41", "Orchestrator"],
      ["11:00", "Supervisor"],
      ["09:05", "You"],
    ],
  );
});

test("the actor and group filters narrow the rows", () => {
  const events = [
    event(1, "tool_call", "c13", { tool: "t" }),
    event(2, "supervisor_action", "c14", { action: "continue" }),
    event(3, "supervisor_action", "m1", { action: "resume" }),
    event(4, "decision_answered", "c14", {}),
  ];
  const count = (filter: Parameters<typeof activityRows>[2]) =>
    activityRows(events, CARDS, filter).length;
  assert.equal(count({ actor: "orchestrator" }), 1);
  assert.equal(count({ actor: "supervisor" }), 2);
  assert.equal(count({ actor: "you" }), 1);
  assert.equal(count({ actor: "all", groupId: "c14" }), 3);
  assert.equal(count({ actor: "supervisor", groupId: "c13" }), 0);
});

test("the page size is 20", () => {
  assert.equal(ACTIVITY_PAGE_SIZE, 20);
});

test("the line reads as a sentence for a known supervisor action and with a colon otherwise", () => {
  const lines = activityRows(
    [
      event(1, "supervisor_action", "c14", { action: "continue" }),
      event(2, "supervisor_action", "c14", { action: "mystery" }),
      event(3, "tool_call", "c13", { tool: "send_input", result: "confirmed" }),
      event(4, "loop_gate", "c13", { phase: 3, result: "pass" }),
    ],
    CARDS,
    UTC,
  ).map((r) => r.line);
  assert.deepEqual(lines, [
    "Supervisor: phase 3 gate passed on GROUP-13",
    "Orchestrator: send_input to GROUP-13: confirmed",
    "Supervisor: mystery on GROUP-14",
    "Supervisor sent one continue prompt to GROUP-14",
  ]);
});

test("an extra orchestrator event names the extra and the user answer reads You", () => {
  const orchestrators = [
    { id: "main", name: "Main", role: "main" as const },
    { id: "x1", name: "Release", role: "extra" as const },
  ];
  const rows = activityRows(
    [
      event(1, "tool_call", "c13", {
        orchestratorId: "main",
        tool: "send_input",
      }),
      event(2, "decision_raised", "c14", { orchestratorId: "x1" }),
      event(3, "decision_answered", "c14", { orchestratorId: "x1" }),
      event(4, "supervisor_state", "c13", { to: "working" }),
    ],
    CARDS,
    { ...UTC, orchestrators },
  );
  assert.deepEqual(
    rows.map((r) => r.actor),
    ["Supervisor", "You", "Extra orchestrator Release", "Orchestrator"],
  );
  assert.deepEqual(
    activityRows(
      [event(2, "decision_raised", "c14", { orchestratorId: "x1" })],
      CARDS,
      { actor: "orchestrator", timeZone: "UTC", orchestrators },
    ).map((r) => r.line),
    ["Extra orchestrator Release: raised a decision for GROUP-14"],
  );
});

test("a prototype key in event data reads as unknown, not as a lookup hit", () => {
  const rows = activityRows(
    [
      event(1, "supervisor_action", "c14", { action: "constructor" }),
      event(2, "supervisor_state", "c14", { to: "toString" }),
    ],
    CARDS,
    UTC,
  ).reverse();
  assert.deepEqual(
    rows.map((r) => r.line),
    [
      "Supervisor: constructor on GROUP-14",
      "Supervisor: GROUP-14 is now toString",
    ],
  );
});

test("an event with an unparseable time gives a row with an empty time", () => {
  const rows = activityRows(
    [event(1, "machine_wake", null, {}, "garbage")],
    CARDS,
    UTC,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.time, "");
});

test("a group_state event reads as the Supervisor, the group id and the state label", () => {
  const states = [
    "agent_done",
    "needs_input",
    "start_failed",
    "shipped",
    "ship_stopped",
    "loop_error",
    "usage_limit",
    "mystery",
  ];
  const rows = activityRows(
    states.map((state, i) => event(i + 1, "group_state", "c14", { state })),
    CARDS,
    UTC,
  ).reverse();
  assert.deepEqual(
    rows.map((r) => r.text),
    [
      "GROUP-14 reached Agent done",
      "GROUP-14 needs input",
      "GROUP-14 failed to start",
      "GROUP-14 shipped",
      "GROUP-14 ship stopped",
      "GROUP-14 loop error",
      "GROUP-14 hit a usage limit",
      "GROUP-14 mystery",
    ],
  );
  assert.ok(rows.every((r) => r.actor === "Supervisor"));
  assert.equal(rows[0].line, "Supervisor: GROUP-14 reached Agent done");
});

test("a wake row reads Woke <orchestrator name>: <reasons>, and falls back to the card identifier", () => {
  const reasons = ["decision d1 answered", "timer 15 min"];
  assert.deepEqual(
    texts([
      event(1, "supervisor_action", "c14", {
        action: "orchestrator_wake",
        orchestrator: "Release",
        reasons,
      }),
      event(2, "supervisor_action", "c14", {
        action: "orchestrator_wake",
        reasons,
      }),
      event(3, "supervisor_action", "c14", {
        action: "orchestrator_wake",
        orchestrator: "Release",
        reasons,
        result: "unconfirmed",
      }),
    ]),
    [
      "Could not wake Release: decision d1 answered, timer 15 min",
      "Woke GROUP-14: decision d1 answered, timer 15 min",
      "Woke Release: decision d1 answered, timer 15 min",
    ],
  );
});
