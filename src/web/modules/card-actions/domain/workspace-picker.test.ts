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

test("the folder equal to the preferred path is selected", () => {
  assert.equal(
    resolveFolder(["/w/api", "/w/sample"], "/w/api", null, "/w/sample"),
    "/w/sample",
  );
});

test("a registered parent of the preferred path is selected", () => {
  assert.equal(
    resolveFolder(["/x", "/w"], "/x", null, "/w/repos/sample"),
    "/w",
  );
});

test("the longest folder that holds the preferred path wins", () => {
  assert.equal(
    resolveFolder(["/w", "/w/repos", "/other"], null, null, "/w/repos/sample"),
    "/w/repos",
  );
});

test("a preferred path that no folder holds falls back to the remembered folder", () => {
  assert.equal(resolveFolder(["/x", "/y"], "/y", null, "/w/sample"), "/y");
  assert.equal(resolveFolder(["/w2"], null, null, "/w/sample"), "/w2");
});

test("the chosen folder still wins over the preferred path", () => {
  assert.equal(resolveFolder(["/x", "/w"], "/x", "/x", "/w/sample"), "/x");
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
