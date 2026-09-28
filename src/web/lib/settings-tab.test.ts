import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_TABS, settingsTabFrom } from "./settings-tab.js";

test("the tab list is the nine tabs in rail order", () => {
  assert.deepEqual(SETTINGS_TABS, [
    "connections",
    "board",
    "appearance",
    "notifications",
    "remote",
    "workspaces",
    "about-you",
    "updates",
    "about",
  ]);
});

test("every known tab id resolves to itself", () => {
  for (const tab of SETTINGS_TABS) {
    assert.equal(settingsTabFrom(tab), tab);
  }
});

test("legacy ids resolve to the tab that now holds their controls", () => {
  const cases: [string, string][] = [
    ["filters", "connections"],
    ["playbooks", "connections"],
    ["vault", "connections"],
    ["accounts", "connections"],
    ["models", "board"],
    ["cleanup", "board"],
    ["terminal", "appearance"],
    ["remote", "remote"],
    ["notifications", "notifications"],
    ["workspaces", "workspaces"],
  ];
  for (const [id, expected] of cases) {
    assert.equal(settingsTabFrom(id), expected, id);
  }
});

test("an unknown or missing id falls back to connections", () => {
  for (const id of [
    undefined,
    "",
    "vault-x",
    "Filters",
    "constructor",
    "toString",
    "__proto__",
  ]) {
    assert.equal(settingsTabFrom(id), "connections", String(id));
  }
});
