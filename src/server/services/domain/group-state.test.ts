import test from "node:test";
import assert from "node:assert/strict";
import type { EventType, SupervisorState } from "../../../shared/types.js";
import {
  groupStateOfActivity,
  groupStateOfSupervisor,
  lastGroupStateOf,
} from "./group-state.js";

void test("the two activity types map to their group states", () => {
  assert.equal(groupStateOfActivity("status_agent_done"), "agent_done");
  assert.equal(groupStateOfActivity("status_needs_input"), "needs_input");
});

void test("any other activity type gives no group state", () => {
  const others: EventType[] = ["status_done", "session_lost", "move_manual"];
  for (const type of others) assert.equal(groupStateOfActivity(type), null);
});

void test("supervisor states map to loop_error and usage_limit, every other gives none", () => {
  const loopError: SupervisorState[] = [
    "api_error",
    "stale",
    "lost",
    "shell_prompt",
  ];
  const limit: SupervisorState[] = ["usage_limit_dialog", "usage_limit_wait"];
  const none: SupervisorState[] = [
    "working",
    "idle",
    "needs_input",
    "permission_prompt",
    "handoff_ready",
    "roadmap_complete",
  ];
  for (const s of loopError)
    assert.equal(groupStateOfSupervisor(s), "loop_error");
  for (const s of limit) assert.equal(groupStateOfSupervisor(s), "usage_limit");
  for (const s of none) assert.equal(groupStateOfSupervisor(s), null);
});

const row = (
  kind: "group_state" | "supervisor_state",
  data: Record<string, unknown>,
  cardId = "c1",
) => ({ cardId, kind, data });

void test("the last state is the newest group_state row of the card, null when there is none", () => {
  assert.equal(lastGroupStateOf([], "c1"), null);
  const newestFirst = [
    row("group_state", { state: "needs_input" }),
    row("group_state", { state: "agent_done" }),
  ];
  assert.equal(lastGroupStateOf(newestFirst, "c1"), "needs_input");
  assert.equal(lastGroupStateOf(newestFirst, "c2"), null);
});

void test("a working transition of the card after its last state clears it", () => {
  const events = [
    row("supervisor_state", { to: "working" }),
    row("group_state", { state: "agent_done" }),
  ];
  assert.equal(lastGroupStateOf(events, "c1"), null);
});

void test("a working transition before the last state, or of another card, or to another state, does not clear it", () => {
  const settled = [
    row("group_state", { state: "agent_done" }),
    row("supervisor_state", { to: "working" }),
  ];
  assert.equal(lastGroupStateOf(settled, "c1"), "agent_done");
  const other = [
    row("supervisor_state", { to: "working" }, "c2"),
    row("supervisor_state", { to: "idle" }),
    row("group_state", { state: "agent_done" }),
  ];
  assert.equal(lastGroupStateOf(other, "c1"), "agent_done");
});
