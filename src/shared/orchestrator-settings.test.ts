import assert from "node:assert/strict";
import { test } from "node:test";
import {
  legacyPanelRedirect,
  parseSettingsTab,
  settingsHash,
} from "./orchestrator-settings.js";

test("an old panel link maps to the settings tab it named, or to the sheet alone", () => {
  assert.deepEqual(
    legacyPanelRedirect({ panel: "orchestrator", tab: "policy" }),
    {
      settings: "policy",
    },
  );
  assert.deepEqual(
    legacyPanelRedirect({ panel: "orchestrator", tab: "orchestrators" }),
    { settings: "orchestrators" },
  );
  for (const tab of ["terminal", "decisions", undefined]) {
    assert.deepEqual(legacyPanelRedirect({ panel: "orchestrator", tab }), {
      settings: undefined,
    });
  }
});

test("a link without the orchestrator panel does not redirect", () => {
  assert.equal(legacyPanelRedirect({}), null);
  assert.equal(legacyPanelRedirect({ tab: "policy" }), null);
  assert.equal(legacyPanelRedirect({ panel: "other", tab: "policy" }), null);
});

test("only the two settings tab names parse", () => {
  assert.equal(parseSettingsTab("policy"), "policy");
  assert.equal(parseSettingsTab("orchestrators"), "orchestrators");
  assert.equal(parseSettingsTab("bogus"), undefined);
  assert.equal(parseSettingsTab(3), undefined);
  assert.equal(parseSettingsTab(undefined), undefined);
});

test("the settings hash opens the centre of the board on the tab", () => {
  assert.equal(
    settingsHash("CEN", "policy"),
    "#/boards/CEN/orchestrator?settings=policy",
  );
});
