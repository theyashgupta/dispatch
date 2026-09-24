import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_ACCENT, sourceAccent } from "./source-accent.js";

const SOURCES = [
  "github",
  "linear",
  "slack",
  "sentry",
  "meeting",
  "calendar",
  "agent",
];

test("each plan source maps to its own --src-* token", () => {
  for (const id of SOURCES) {
    assert.equal(sourceAccent(id), `var(--src-${id})`);
  }
});

test("local and group are neutral entries", () => {
  assert.equal(sourceAccent("local"), "var(--text-muted)");
  assert.equal(sourceAccent("group"), "var(--text-muted)");
});

test("an unknown id resolves to the neutral entry", () => {
  assert.equal(sourceAccent("nope"), "var(--text-muted)");
  assert.equal(sourceAccent(""), "var(--text-muted)");
  assert.equal(sourceAccent("constructor"), "var(--text-muted)");
  assert.equal(sourceAccent("__proto__"), "var(--text-muted)");
});

test("the map holds exactly nine keys", () => {
  assert.equal(Object.keys(SOURCE_ACCENT).length, 9);
});
