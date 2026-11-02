import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type {
  SupervisorState,
  SupervisorStateReason,
} from "../../../shared/types.js";
import {
  declineKeys,
  holdsNeedsInput,
  initialPlanMemory,
  planActions,
  planFrozenRelaunch,
  parseResetAt,
  readMenu,
  type PlanInput,
} from "./supervisor-plan.js";

const PANES = new URL("../../test-support/fixtures/panes/", import.meta.url);
const pane = (name: string) => readFileSync(new URL(name, PANES), "utf8");

const LOOP = { engineActive: true, handoffPending: false, unitPhase: "2/3" };

function plan(over: Partial<PlanInput>) {
  return planActions({
    from: "working",
    to: "idle",
    loop: LOOP,
    usageLimit: "wait",
    wokeAt: null,
    now: 1_000_000,
    memory: initialPlanMemory(),
    ...over,
  });
}

void test("each transition maps to its action list", () => {
  const table: [Partial<PlanInput>, unknown[]][] = [
    [{}, [{ kind: "continue", duty: "restart" }]],
    [
      {
        loop: { engineActive: false, handoffPending: false, unitPhase: "2/3" },
      },
      [],
    ],
    [{ loop: null }, []],
    [{ to: "api_error" }, [{ kind: "continue", duty: "api_error" }]],
    [
      { to: "api_error", loop: null },
      [{ kind: "continue", duty: "api_error" }],
    ],
    [
      { wokeAt: 1_000_000 - 60_000, loop: null },
      [{ kind: "continue", duty: "sleep_cut" }],
    ],
    [{ wokeAt: 1_000_000 - 180_000, loop: null }, []],
    [{ wokeAt: 1_000_000 - 60_000, from: "needs_input", loop: null }, []],
    [
      { to: "permission_prompt", promptKind: "dangerous_delete" },
      [{ kind: "answer_prompt", promptKind: "dangerous_delete" }],
    ],
    [
      { to: "permission_prompt", promptKind: "peer_message" },
      [{ kind: "answer_prompt", promptKind: "peer_message" }],
    ],
    [{ to: "permission_prompt", promptKind: "other" }, []],
    [{ to: "permission_prompt" }, []],
    [{ to: "roadmap_complete", doneLine: true }, [{ kind: "close_loop" }]],
    [{ to: "roadmap_complete" }, []],
    [
      {
        to: "roadmap_complete",
        doneLine: true,
        loop: { engineActive: false, handoffPending: false, unitPhase: "4/9" },
      },
      [],
    ],
    [
      {
        to: "roadmap_complete",
        doneLine: true,
        loop: { ...LOOP, orchestrator: true },
      },
      [],
    ],
    [
      {
        to: "roadmap_complete",
        loop: { ...LOOP, orchestrator: true },
      },
      [],
    ],
    [{ to: "lost" }, [{ kind: "resume" }]],
    [{ to: "shell_prompt", loop: null }, [{ kind: "resume" }]],
    [{ to: "needs_input" }, []],
    [{ to: "working", from: "idle" }, []],
    [{ to: "stale" }, []],
    [{ to: "usage_limit_dialog" }, [{ kind: "answer_limit" }]],
    [
      { to: "usage_limit_dialog", usageLimit: "stop" },
      [{ kind: "answer_limit" }],
    ],
    [{ to: "usage_limit_wait" }, [{ kind: "limit_move" }]],
    [{ to: "usage_limit_wait", loop: null }, [{ kind: "limit_move" }]],
    [
      {
        to: "usage_limit_wait",
        loop: { engineActive: true, handoffPending: true, unitPhase: "2/3" },
      },
      [{ kind: "escape_limit" }],
    ],
    [
      { to: "usage_limit_wait", usageLimit: "stop" },
      [{ kind: "needs_input", reason: "usage_stop" }],
    ],
    [
      {
        to: "usage_limit_wait",
        usageLimit: "stop",
        loop: { engineActive: true, handoffPending: true, unitPhase: "2/3" },
      },
      [{ kind: "needs_input", reason: "usage_stop" }],
    ],
    [{ to: "usage_limit_wait", from: "usage_limit_dialog" }, []],
    [
      {
        to: "usage_limit_wait",
        from: "usage_limit_dialog",
        usageLimit: "stop",
      },
      [],
    ],
    [{ to: "handoff_ready" }, [{ kind: "handoff" }]],
    [{ to: "handoff_ready", loop: null }, []],
  ];
  for (const [over, actions] of table) {
    assert.deepEqual(plan(over).actions, actions, JSON.stringify(over));
  }
});

void test("a second stop in the same unit and phase gives up instead of prompting again", () => {
  const first = plan({});
  assert.deepEqual(first.actions, [{ kind: "continue", duty: "restart" }]);
  const second = plan({ memory: first.memory, from: "working" });
  assert.deepEqual(second.actions, [
    { kind: "needs_input", reason: "supervisor_gave_up" },
  ]);
  const nextPhase = plan({
    memory: second.memory,
    loop: { engineActive: true, handoffPending: false, unitPhase: "2/4" },
  });
  assert.deepEqual(nextPhase.actions, [{ kind: "continue", duty: "restart" }]);
});

void test("a second API error in the same phase gives up, and a sleep cut shares that budget", () => {
  const first = plan({ to: "api_error" });
  const second = plan({ to: "api_error", memory: first.memory });
  assert.deepEqual(second.actions, [
    { kind: "needs_input", reason: "supervisor_gave_up" },
  ]);
  const cut = plan({ wokeAt: 1_000_000, memory: first.memory });
  assert.deepEqual(cut.actions, [
    { kind: "needs_input", reason: "supervisor_gave_up" },
  ]);
});

void test("a frozen detection releases only a supervisor_gave_up hold", () => {
  const frozen = { state: "frozen" } as const;
  assert.equal(
    holdsNeedsInput("needs_input", "supervisor_gave_up", frozen),
    false,
  );
  for (const reason of [
    "usage_stop",
    "budget",
    "stop_session",
    "resume_failed",
  ] as const)
    assert.equal(holdsNeedsInput("needs_input", reason, frozen), true, reason);
});

void test("a supervisor set needs_input holds until a busy sign, a permission prompt or a lost pane", () => {
  const held = (state: SupervisorState, busy?: true) =>
    holdsNeedsInput("needs_input", "supervisor_gave_up", {
      state,
      ...(busy ? { busy } : {}),
    });
  for (const state of [
    "idle",
    "needs_input",
    "api_error",
    "usage_limit_dialog",
    "usage_limit_wait",
    "handoff_ready",
    "stale",
    "working",
  ] as const)
    assert.equal(held(state), true, state);
  assert.equal(held("working", true), false);
  assert.equal(held("permission_prompt"), false);
  assert.equal(held("lost"), false);
  assert.equal(held("shell_prompt"), false);
  assert.equal(
    holdsNeedsInput("needs_input", "usage_stop", { state: "working" }),
    true,
  );
  for (const state of ["working", "permission_prompt", "idle"] as const)
    assert.equal(
      holdsNeedsInput("needs_input", "budget", { state, busy: true }),
      true,
      state,
    );
  assert.equal(
    holdsNeedsInput("needs_input", "budget", { state: "lost" }),
    false,
  );
  for (const state of ["shell_prompt", "lost", "working"] as const)
    assert.equal(
      holdsNeedsInput("needs_input", "resume_failed", { state }),
      true,
      state,
    );
  assert.equal(
    holdsNeedsInput("needs_input", "resume_failed", { state: "idle" }),
    false,
  );
  assert.equal(
    holdsNeedsInput("needs_input", "resume_failed", {
      state: "working",
      busy: true,
    }),
    false,
  );
  assert.equal(
    holdsNeedsInput("needs_input", "supervisor_gave_up", { state: "paused" }),
    false,
  );
  assert.equal(
    holdsNeedsInput("needs_input", undefined, { state: "idle" }),
    false,
  );
  assert.equal(
    holdsNeedsInput("idle", "supervisor_gave_up", { state: "idle" }),
    false,
  );
});

void test("a roadmap_complete detection releases every hold reason only while the engine is open", () => {
  const reasons: SupervisorStateReason[] = [
    "usage_stop",
    "budget",
    "stop_session",
    "supervisor_gave_up",
    "resume_failed",
  ];
  const detected = { state: "roadmap_complete" } as const;
  for (const reason of reasons) {
    assert.equal(
      holdsNeedsInput("needs_input", reason, detected, true),
      false,
      `open ${reason}`,
    );
    assert.equal(
      holdsNeedsInput("needs_input", reason, detected, false),
      true,
      `closed ${reason}`,
    );
    assert.equal(
      holdsNeedsInput("needs_input", reason, detected),
      true,
      `absent ${reason}`,
    );
  }
});

void test("the decline keys reach the No row of a dangerous delete prompt", () => {
  const text = pane("dangerous-delete.txt");
  assert.deepEqual(readMenu(text), { rows: ["1. Yes", "2. No"], cursor: 0 });
  assert.deepEqual(declineKeys(text, "dangerous_delete"), ["Down"]);
  const onNo = text
    .replace(" ❯ 1. Yes", "   1. Yes")
    .replace("   2. No", " ❯ 2. No");
  assert.deepEqual(declineKeys(onNo, "dangerous_delete"), []);
});

void test("the decline keys stay on the Deny row of a held peer message", () => {
  const text = pane("peer-message.txt");
  assert.equal(readMenu(text)?.cursor, 0);
  assert.deepEqual(declineKeys(text, "peer_message"), []);
  const onDeliver = text
    .replace("❯ Deny", "  Deny")
    .replace("  Deliver this message", "❯ Deliver this message");
  assert.deepEqual(declineKeys(onDeliver, "peer_message"), ["Up"]);
});

void test("a menu without the decline row or without a cursor plans no keys", () => {
  assert.equal(
    declineKeys(" ❯ 1. Yes\n   2. Yes, always", "dangerous_delete"),
    null,
  );
  assert.equal(declineKeys("   1. Yes\n   2. No", "dangerous_delete"), null);
  assert.equal(declineKeys("no menu here", "peer_message"), null);
});

void test("the reset time comes from the pane in local time", () => {
  const now = new Date(2026, 9, 6, 22, 15).getTime();
  const at = (y: number, mo: number, d: number, h: number, mi: number) =>
    new Date(y, mo, d, h, mi).getTime();
  assert.equal(
    parseResetAt("⚠ Usage limit reached · limit resets 12:40am", now),
    at(2026, 9, 7, 0, 40),
  );
  assert.equal(
    parseResetAt("Continuing automatically at 11:30pm · esc to cancel", now),
    at(2026, 9, 6, 23, 30),
  );
  assert.equal(
    parseResetAt(
      "2. Wait here, then continue automatically at Oct 8 at 8:30am",
      now,
    ),
    at(2026, 9, 8, 8, 30),
  );
  assert.equal(
    parseResetAt("continue automatically at Jan 2 at 9am", now),
    at(2027, 0, 2, 9, 0),
  );
  assert.equal(parseResetAt("resets soon", now), null);
  assert.equal(parseResetAt("no limit here", now), null);
});

void test("an idle orchestrator gets no restart nudge, but its handoff still runs", () => {
  const orchestrator = {
    engineActive: true,
    handoffPending: true,
    unitPhase: "orchestrator",
    orchestrator: true,
  };
  assert.deepEqual(plan({ loop: orchestrator }).actions, []);
  assert.deepEqual(plan({ from: "idle", loop: orchestrator }).actions, []);
  assert.deepEqual(plan({ to: "handoff_ready", loop: orchestrator }).actions, [
    { kind: "handoff" },
  ]);
});

void test("a frozen relaunch is planned once per unit and phase, then the session gives up", () => {
  const since = "2026-10-21T10:00:00.000Z";
  const first = planFrozenRelaunch(LOOP, initialPlanMemory(), since);
  assert.deepEqual(first.actions, [
    { kind: "relaunch_frozen", frozenSince: since },
  ]);
  const second = planFrozenRelaunch(LOOP, first.memory, since);
  assert.deepEqual(second.actions, [
    { kind: "needs_input", reason: "resume_failed" },
  ]);
  const nextPhase = planFrozenRelaunch(
    { ...LOOP, unitPhase: "2/4" },
    second.memory,
    since,
  );
  assert.deepEqual(nextPhase.actions, [
    { kind: "relaunch_frozen", frozenSince: since },
  ]);
});

void test("a frozen relaunch without a loop is keyed frozen:none", () => {
  const planned = planFrozenRelaunch(null, initialPlanMemory(), "t");
  assert.deepEqual(planned.memory.prompts, { "frozen:none": 1 });
});
