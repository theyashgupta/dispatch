import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES } from "../../../../shared/route.js";
import { SOURCE_MARK } from "../../../components/badges/source-mark.js";
import { NAV_ITEMS } from "../../../../shared/nav-items.js";
import { NAV_ICON } from "./NavIcon.js";

test("every route page has an icon, including settings", () => {
  for (const page of PAGES) {
    assert.ok(NAV_ICON[page] != null, page);
  }
  for (const item of NAV_ITEMS) {
    assert.ok(NAV_ICON[item.page] != null, item.page);
  }
});

test("every Sources row shows the mark of its brand, and no other row has a brand", () => {
  for (const item of NAV_ITEMS) {
    if (item.group !== "Sources") {
      assert.equal(item.brand, undefined, item.page);
      continue;
    }
    assert.ok(item.brand !== undefined, item.page);
    assert.equal(NAV_ICON[item.page], SOURCE_MARK[item.brand], item.page);
  }
  assert.deepEqual(
    NAV_ITEMS.filter((item) => item.group === "Sources").map((item) => [
      item.page,
      item.brand,
    ]),
    [
      ["tickets", "linear"],
      ["pull-requests", "github"],
      ["errors", "sentry"],
      ["meetings", "meeting"],
      ["calendar", "calendar"],
      ["slack", "slack"],
    ],
  );
});
