import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countLabel,
  repositoryCountLabel,
  repositoryNames,
} from "./board-counts.js";

test("countLabel returns null for zero", () => {
  assert.equal(countLabel("running", 0), null);
  assert.equal(countLabel("openGroups", 0), null);
  assert.equal(countLabel("attention", 0), null);
});

test("countLabel words each kind", () => {
  assert.equal(countLabel("running", 1), "1 running");
  assert.equal(countLabel("running", 3), "3 running");
  assert.equal(countLabel("openGroups", 1), "1 open group");
  assert.equal(countLabel("openGroups", 2), "2 open groups");
  assert.equal(countLabel("attention", 1), "1 needs attention");
  assert.equal(countLabel("attention", 2), "2 need attention");
});

test("repositoryCountLabel is singular for one", () => {
  assert.equal(repositoryCountLabel(0), "0 repositories");
  assert.equal(repositoryCountLabel(1), "1 repository");
  assert.equal(repositoryCountLabel(2), "2 repositories");
});

test("repositoryNames joins the last path segments", () => {
  assert.equal(
    repositoryNames([{ path: "/a/dispatch" }, { path: "/b/vyro-platform/" }]),
    "dispatch, vyro-platform",
  );
  assert.equal(repositoryNames([]), "");
});
