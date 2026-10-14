import assert from "node:assert/strict";
import test from "node:test";
import {
  nextVersion,
  releaseCardText,
  releaseTitle,
} from "./release-version.js";

void test("nextVersion bumps patch, minor and major", () => {
  assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
  assert.equal(nextVersion("0.9.9", "minor"), "0.10.0");
  assert.equal(nextVersion("9.9.9", "patch"), "9.9.10");
});

void test("nextVersion answers null for anything that is not a plain x.y.z", () => {
  for (const bad of ["1.2", "v1.2.3", "1.2.3-beta", "", "1. 2.3", "01.2.3"]) {
    assert.equal(nextVersion(bad, "patch"), null, JSON.stringify(bad));
  }
});

void test("releaseTitle prefixes Release v", () => {
  assert.equal(releaseTitle("1.3.0"), "Release v1.3.0");
});

void test("releaseCardText holds every line, the pull requests and none for an empty list", () => {
  const input = {
    previous: "1.2.3",
    version: "1.3.0",
    bump: "minor" as const,
    repository: "/r/app",
    base: "main",
    features: ["First", "Second"],
    prs: [12, 15],
    shipRights: "merge",
  };
  const text = releaseCardText(input);
  for (const line of [
    "Previous version: 1.2.3",
    "Next version: 1.3.0",
    "Bump: minor",
    "Repository: /r/app",
    "Base: main",
    "Ship rights: merge",
    "Features:",
    "- First",
    "- Second",
    "Pull requests:",
    "#12, #15",
  ]) {
    assert.ok(text.split("\n").includes(line), line);
  }
  assert.ok(releaseCardText({ ...input, prs: [] }).endsWith("\nnone"));
});
