import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_ACCENT } from "./source-accent.js";
import { sourceName } from "./source-name.js";

void test("each known source has its display name", () => {
  const names: Record<string, string> = {
    github: "GitHub",
    linear: "Linear",
    slack: "Slack",
    sentry: "Sentry",
    meeting: "Meeting",
    calendar: "Calendar",
    agent: "Agent",
    local: "Local",
    group: "Group",
  };
  assert.deepEqual(
    Object.keys(names).sort(),
    Object.keys(SOURCE_ACCENT).sort(),
  );
  for (const [id, name] of Object.entries(names)) {
    assert.equal(sourceName(id), name);
  }
});

void test("an unknown id returns the id with a capital first letter", () => {
  assert.equal(sourceName("zzz"), "Zzz");
  assert.equal(sourceName("jira"), "Jira");
});

void test("an empty or blank id returns a safe name", () => {
  assert.equal(sourceName(""), "Source");
  assert.equal(sourceName(" "), "Source");
  assert.equal(sourceName("\n"), "Source");
});

void test("a prototype key returns a string and never a function", () => {
  assert.equal(sourceName("constructor"), "Constructor");
  assert.equal(sourceName("__proto__"), "__proto__");
  assert.equal(sourceName("toString"), "ToString");
});
