import assert from "node:assert/strict";
import { test } from "node:test";
import type { LinearWorkflow } from "../../../../shared/types.js";
import {
  choiceFromSelectValue,
  chooseState,
  NO_SYNC_VALUE,
  resolvedMap,
  selectValueFor,
  stateMapDraft,
} from "./linear-state-map.js";

const workflow: LinearWorkflow = {
  viewerId: "u1",
  teams: [
    {
      id: "t1",
      key: "ENG",
      name: "Engineering",
      states: [
        { id: "s1", name: "Todo", type: "unstarted", position: 1 },
        { id: "s2", name: "Doing", type: "started", position: 2 },
        { id: "s3", name: "Done", type: "completed", position: 3 },
      ],
    },
  ],
};

test("defaults resolve to the lowest state of the column type", () => {
  assert.deepEqual(resolvedMap(workflow, {}).t1, {
    todo: "s1",
    in_progress: "s2",
    needs_input: "s2",
    in_review: null,
    parked: null,
    done: "s3",
  });
});

test("a saved choice wins over the default", () => {
  assert.equal(resolvedMap(workflow, { t1: { todo: "s2" } }).t1?.todo, "s2");
  assert.equal(resolvedMap(workflow, { t1: { todo: null } }).t1?.todo, null);
});

test("edits sit on top of the resolved map", () => {
  const edits = chooseState({}, "t1", "done", "s2");
  assert.equal(stateMapDraft(workflow, {}, edits).t1?.done, "s2");
  assert.equal(stateMapDraft(workflow, {}, edits).t1?.todo, "s1");
});

test("an empty choice means do not sync", () => {
  assert.deepEqual(chooseState({}, "t1", "todo", ""), { t1: { todo: null } });
});

test("choosing keeps the other edits", () => {
  const first = chooseState({}, "t1", "todo", "s1");
  assert.deepEqual(chooseState(first, "t1", "done", "s3"), {
    t1: { todo: "s1", done: "s3" },
  });
});

test("a missing or null choice shows as do not sync", () => {
  assert.equal(selectValueFor(null), NO_SYNC_VALUE);
  assert.equal(selectValueFor(undefined), NO_SYNC_VALUE);
  assert.equal(selectValueFor("s1"), "s1");
});

test("the do not sync value becomes the empty choice", () => {
  assert.equal(choiceFromSelectValue(NO_SYNC_VALUE), "");
  assert.equal(choiceFromSelectValue("s1"), "s1");
});
