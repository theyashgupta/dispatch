import test from "node:test";
import assert from "node:assert/strict";
import { isShipBranchName } from "./orchestrator-limits.js";

void test("isShipBranchName accepts the names git accepts as a branch", () => {
  const names = [
    "LOCAL-139",
    "feat/LOCAL-131-unit-1-dashboards-dropdown",
    "feat/LOCAL-132-unit-2-remove-sessions",
    "feat/LOCAL-134-unit-3-remove-workspace",
    "feat/LOCAL-130-unit-4-remove-activity",
    "test/g23-nav-cleanup-specs",
    "_wip",
    "a+b",
    "a!b",
    "café",
    "a.b",
    "x.lock.y",
    "a".repeat(255),
  ];
  for (const name of names) {
    assert.equal(isShipBranchName(name), true, name);
  }
});

void test("isShipBranchName refuses the names git refuses as a branch", () => {
  const names = [
    "",
    "has space",
    "a..b",
    "-x",
    "feat/",
    "/x",
    "x.lock",
    "a/b.lock/c",
    "a@{b",
    "a\u0007b",
    "a\u007fb",
    "a\u001fb",
    "a\tb",
    "a\nb",
    "@",
    "a//b",
    ".x",
    "a/.x",
    "x.",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "a".repeat(256),
  ];
  for (const name of names) {
    assert.equal(isShipBranchName(name), false, JSON.stringify(name));
  }
});
