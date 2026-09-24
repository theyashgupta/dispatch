import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_TABS, settingsTabFrom } from "./settings-tab.js";

test("every known tab id resolves to itself", () => {
  for (const tab of SETTINGS_TABS) {
    assert.equal(settingsTabFrom(tab), tab);
  }
});

test("an unknown or missing id falls back to the first tab", () => {
  assert.equal(settingsTabFrom(undefined), "filters");
  assert.equal(settingsTabFrom(""), "filters");
  assert.equal(settingsTabFrom("vault-x"), "filters");
  assert.equal(settingsTabFrom("Filters"), "filters");
});

test("the retired page tabs fall back to the first tab", () => {
  for (const id of ["playbooks", "vault", "accounts"]) {
    assert.equal(settingsTabFrom(id), "filters");
  }
  assert.equal(SETTINGS_TABS.length, 7);
});
