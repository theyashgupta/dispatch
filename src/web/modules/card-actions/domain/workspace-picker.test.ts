import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chosenRepos,
  isRepoChecked,
  resolveFolder,
} from "./workspace-picker.js";

const repos = [
  { path: "/w/a", name: "a", base: "main" },
  { path: "/w/b", name: "b", base: "develop" },
];

test("the chosen folder wins while it is registered", () => {
  assert.equal(resolveFolder(["/x", "/y"], "/x", "/y"), "/y");
});

test("the remembered folder is the fallback for a folder that was removed", () => {
  assert.equal(resolveFolder(["/x", "/y"], "/y", "/gone"), "/y");
});

test("the first folder is the fallback without a remembered one", () => {
  assert.equal(resolveFolder(["/x", "/y"], "/gone", null), "/x");
});

test("no folder is selected without registered folders", () => {
  assert.equal(resolveFolder([], "/x", "/y"), null);
});

test("every repo is ticked until the user unticks it", () => {
  assert.equal(isRepoChecked({}, "/w/a"), true);
  assert.equal(isRepoChecked({ "/w/a": false }, "/w/a"), false);
});

test("the chosen repos skip unticked ones and take the base override", () => {
  assert.deepEqual(
    chosenRepos(repos, { "/w/b": false }, { "/w/a": "release" }),
    [{ path: "/w/a", base: "release" }],
  );
});

test("the chosen repos of an undiscovered folder are empty", () => {
  assert.deepEqual(chosenRepos(null, {}, {}), []);
});
