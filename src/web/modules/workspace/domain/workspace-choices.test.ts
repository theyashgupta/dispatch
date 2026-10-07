import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_CHOICE,
  readChoice,
  SORT_CHOICE,
  SUBGROUP_CHOICE,
} from "./workspace-choices.js";

test("the storage keys stay the legacy keys", () => {
  assert.deepEqual(
    [GROUP_CHOICE.key, SUBGROUP_CHOICE.key, SORT_CHOICE.key],
    ["dsp.workspaceGroup", "dsp.workspaceSubgroup", "dsp.workspaceSort"],
  );
});

test("a stored legacy value reads back as that choice", () => {
  assert.equal(readChoice(GROUP_CHOICE, "workspace"), "workspace");
  assert.equal(readChoice(SUBGROUP_CHOICE, "status"), "status");
  assert.equal(readChoice(SUBGROUP_CHOICE, "workspace"), "workspace");
  assert.equal(readChoice(SORT_CHOICE, "title"), "title");
});

test("a missing or unknown value reads as the legacy default", () => {
  assert.equal(readChoice(GROUP_CHOICE, null), "status");
  assert.equal(readChoice(GROUP_CHOICE, "folder"), "status");
  assert.equal(readChoice(SUBGROUP_CHOICE, null), "none");
  assert.equal(readChoice(SORT_CHOICE, "name"), "id");
});

test("a stored default value reads as that default", () => {
  assert.equal(readChoice(GROUP_CHOICE, "status"), "status");
  assert.equal(readChoice(SUBGROUP_CHOICE, "none"), "none");
  assert.equal(readChoice(SORT_CHOICE, "id"), "id");
});
