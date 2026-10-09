import test from "node:test";
import assert from "node:assert/strict";
import type { SupervisorState } from "../../../shared/types.js";
import {
  enqueueReason,
  eventReason,
  mayWake,
  timerDue,
  timerReason,
  wakeLine,
  wakeTargetOf,
  withoutEvents,
  type WakeFacts,
} from "./orchestrator-wake.js";

const IDLE: WakeFacts = {
  inFlight: false,
  sessionState: "idle",
  lastLineAt: null,
  now: 100_000,
  paneReady: true,
  paneBusy: false,
  turn: "idle",
};

void test("a ready pane that is not busy sends, with the turn state idle or unknown", () => {
  assert.equal(mayWake(IDLE), true);
  assert.equal(mayWake({ ...IDLE, turn: "unknown" }), true);
});

void test("each blocker alone stops the send", () => {
  const blocked: Partial<WakeFacts>[] = [
    { paneReady: false },
    { paneBusy: true },
    { turn: "busy" },
    { inFlight: true },
    { lastLineAt: 100_000 - 19_999 },
  ];
  for (const patch of blocked)
    assert.equal(mayWake({ ...IDLE, ...patch }), false, JSON.stringify(patch));
});

void test("20 seconds after the last line the send is allowed again", () => {
  assert.equal(mayWake({ ...IDLE, lastLineAt: 100_000 - 20_000 }), true);
});

void test("the send rule holds for every session state, and only the typing-wrong states block", () => {
  const blocked: SupervisorState[] = [
    "needs_input",
    "permission_prompt",
    "usage_limit_dialog",
    "usage_limit_wait",
    "api_error",
    "lost",
    "stale",
    "shell_prompt",
  ];
  const open: (SupervisorState | null)[] = [
    null,
    "working",
    "idle",
    "handoff_ready",
    "roadmap_complete",
  ];
  for (const sessionState of blocked)
    assert.equal(mayWake({ ...IDLE, sessionState }), false, sessionState);
  for (const sessionState of open)
    assert.equal(
      mayWake({ ...IDLE, sessionState }),
      true,
      String(sessionState),
    );
});

void test("enqueueReason keeps an equal key once, withoutEvents drops exactly the named events", () => {
  const a = eventReason(
    { id: 5, kind: "decision_answered", data: { decisionId: "d1" } },
    "x",
  );
  const b = eventReason(
    { id: 9, kind: "group_state", data: { state: "agent_done" } },
    "RUN-4",
  );
  assert.ok(a && b);
  const both = enqueueReason(enqueueReason([], a), b);
  assert.deepEqual(both, [a, b]);
  assert.deepEqual(enqueueReason(both, b), both);
  assert.deepEqual(withoutEvents(both, [5]), [b]);
  assert.deepEqual(withoutEvents(both, [9, 5]), []);
  assert.deepEqual(
    withoutEvents(both, [6, 7, 8]),
    both,
    "a later id drops nothing",
  );
});

void test("the timer reason has no event id, so a delivered event never drops it", () => {
  const timer = timerReason(15);
  assert.equal(timer.text, "timer 15 min");
  assert.deepEqual(withoutEvents([timer], [0, 1, 1_000_000]), [timer]);
});

void test("event reasons read decision <id> answered and <group> <state>", () => {
  assert.equal(
    eventReason(
      { id: 1, kind: "decision_answered", data: { decisionId: "dec-7" } },
      "x",
    )?.text,
    "decision dec-7 answered",
  );
  assert.equal(
    eventReason(
      { id: 2, kind: "group_state", data: { state: "agent_done" } },
      "RUN-4",
    )?.text,
    "RUN-4 agent_done",
  );
  assert.equal(eventReason({ id: 3, kind: "tool_call", data: {} }, "x"), null);
});

void test("the line lists up to five reasons, then and <n> more", () => {
  const tail = ". Read the board state with the dispatch tools and continue.";
  assert.equal(
    wakeLine(["decision d1 answered"]),
    `Dispatch wake: decision d1 answered${tail}`,
  );
  assert.equal(
    wakeLine(["a", "b", "c", "d", "e"]),
    `Dispatch wake: a, b, c, d, e${tail}`,
  );
  assert.equal(
    wakeLine(["a", "b", "c", "d", "e", "f", "g"]),
    `Dispatch wake: a, b, c, d, e, and 2 more${tail}`,
  );
});

void test("the line stays under 500 characters for long reasons", () => {
  const long = Array.from(
    { length: 40 },
    (_, i) => `${"G".repeat(90)}-${i} agent_done`,
  );
  assert.ok(wakeLine(long).length < 500);
});

void test("the timer is due after wakeMinutes of quiet, not before, and never at 0", () => {
  const base = { lastActivityAt: 0, wakeMinutes: 15 };
  assert.equal(timerDue({ ...base, now: 15 * 60_000 - 1 }), false);
  assert.equal(timerDue({ ...base, now: 15 * 60_000 }), true);
  assert.equal(timerDue({ ...base, wakeMinutes: 0, now: 10 ** 12 }), false);
});

void test("a decision answer targets the orchestrator it names, a group event its owner", () => {
  assert.equal(
    wakeTargetOf(
      { kind: "decision_answered", data: { orchestratorId: "extra-1" } },
      "main",
    ),
    "extra-1",
  );
  assert.equal(
    wakeTargetOf({ kind: "decision_answered", data: {} }, "main"),
    null,
  );
  assert.equal(
    wakeTargetOf({ kind: "group_state", data: {} }, "extra-1"),
    "extra-1",
  );
  assert.equal(wakeTargetOf({ kind: "group_state", data: {} }, null), null);
  assert.equal(wakeTargetOf({ kind: "tool_call", data: {} }, "main"), null);
});
