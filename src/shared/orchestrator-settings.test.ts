import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CENTRE_VIEWS,
  isCentreView,
  legacyPanelRedirect,
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
  for (const tab of ["terminal", "decisions", "bogus", 3, undefined]) {
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

test("the settings hash opens the centre of the board on the tab", () => {
  assert.equal(
    settingsHash("CEN", "policy"),
    "#/boards/CEN/orchestrator?settings=policy",
  );
});

test("the centre views are bands and tree", () => {
  assert.deepEqual([...CENTRE_VIEWS], ["bands", "tree"]);
});

test("only a known centre view is a centre view", () => {
  assert.equal(isCentreView("tree"), true);
  assert.equal(isCentreView("bogus"), false);
  assert.equal(isCentreView(undefined), false);
});
