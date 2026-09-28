import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStateMap, resolveTargetState } from "./linear-state-map.js";
import type { WorkflowState } from "./types.js";

const ENG: WorkflowState[] = [
  { id: "st-backlog", name: "Backlog", type: "backlog", position: 0 },
  { id: "st-todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "st-ready", name: "Ready", type: "unstarted", position: 2 },
  { id: "st-review", name: "In Review", type: "started", position: 4 },
  { id: "st-progress", name: "In Progress", type: "started", position: 3 },
  { id: "st-done", name: "Done", type: "completed", position: 5 },
  { id: "st-canceled", name: "Canceled", type: "canceled", position: 6 },
];

test("each column defaults to the lowest-position state of its type", () => {
  assert.equal(resolveTargetState(undefined, ENG, "todo"), "st-todo");
  assert.equal(
    resolveTargetState(undefined, ENG, "in_progress"),
    "st-progress",
  );
  assert.equal(
    resolveTargetState(undefined, ENG, "needs_input"),
    "st-progress",
  );
  assert.equal(resolveTargetState(undefined, ENG, "done"), "st-done");
});

test("in review, parked, inbox and agent done never push by default", () => {
  for (const column of [
    "in_review",
    "parked",
    "inbox",
    "agent_done",
  ] as const) {
    assert.equal(resolveTargetState({}, ENG, column), null);
  }
});

test("an explicit id wins, an explicit null is do not sync, a stale id falls back", () => {
  assert.equal(
    resolveTargetState({ in_review: "st-review" }, ENG, "in_review"),
    "st-review",
  );
  assert.equal(resolveTargetState({ done: null }, ENG, "done"), null);
  assert.equal(resolveTargetState({ todo: "st-gone" }, ENG, "todo"), "st-todo");
});

test("a team without a completed state resolves done to null", () => {
  const noDone = ENG.filter((s) => s.type !== "completed");
  assert.equal(resolveTargetState(undefined, noDone, "done"), null);
});

test("parseStateMap accepts an empty map and a valid map", () => {
  assert.deepEqual(parseStateMap({}), { ok: true, map: {} });
  const map = { "team-eng": { todo: "st-todo", done: null } };
  assert.deepEqual(parseStateMap(map), { ok: true, map });
});

test("parseStateMap refuses unknown columns, bad values and non-objects", () => {
  for (const raw of [
    { "team-eng": { backlog: "st-backlog" } },
    { "team-eng": { todo: 3 } },
    { "team-eng": { todo: "" } },
    { "team-eng": "st-todo" },
    [],
    null,
    "map",
    JSON.parse('{"__proto__":{"todo":"st-todo"}}') as unknown,
  ]) {
    assert.equal(parseStateMap(raw).ok, false, JSON.stringify(raw));
  }
});
