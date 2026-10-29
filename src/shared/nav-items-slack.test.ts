import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS, navGroups, visibleNavItems } from "./nav-items.js";

const pages = (enabled: string[]) =>
  visibleNavItems(NAV_ITEMS, enabled).map((item) => item.page);

test("the Slack row shows only while Slack is enabled, as the last Sources row", () => {
  assert.ok(pages(["slack"]).includes("slack"));
  assert.equal(pages([]).includes("slack"), false);
  assert.equal(pages(["github"]).includes("slack"), false);
  const sources = navGroups(visibleNavItems(NAV_ITEMS, ["slack"])).find(
    (entry) => entry.group === "Sources",
  );
  assert.deepEqual(
    sources?.items.map((item) => item.label),
    ["Tickets", "Pull Requests", "Errors", "Meetings", "Calendar", "Slack"],
  );
});

test("rows without a source never drop, whatever is enabled", () => {
  const unsourced = NAV_ITEMS.filter((item) => item.source === undefined).map(
    (item) => item.page,
  );
  assert.deepEqual(pages([]), unsourced);
  assert.deepEqual(
    pages(["slack"]).filter((page) => page !== "slack"),
    unsourced,
  );
});
