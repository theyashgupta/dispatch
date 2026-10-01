import { test } from "node:test";
import assert from "node:assert/strict";
import { SHELL_IDS } from "./shell-ids.js";

test("the shell ids keep the values the legacy panel scripts select on", () => {
  assert.deepEqual(SHELL_IDS, {
    activityToggle: "activity-toggle",
    activityDrawer: "activity-drawer",
    navMenu: "nav-menu",
  });
});
