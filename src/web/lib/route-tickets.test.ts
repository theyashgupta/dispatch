import assert from "node:assert/strict";
import { test } from "node:test";
// eslint-disable-next-line boundaries/dependencies
import { NAV_ITEMS, navGroups } from "../features/nav/nav-items.js";
import { parseRoute, routeHash } from "./route.js";

test("#/tickets parses to the tickets page and round trips", () => {
  assert.deepEqual(parseRoute("#/tickets"), { page: "tickets" });
  assert.equal(routeHash({ page: "tickets" }), "#/tickets");
});

test("NAV_ITEMS has exactly one Tickets row, in the Sources group", () => {
  const rows = NAV_ITEMS.filter((item) => item.page === "tickets");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.group, "Sources");
});

test("navGroups orders Home, Work, Sources, System", () => {
  const groups = navGroups(NAV_ITEMS).map((entry) => entry.group);
  assert.deepEqual(groups, ["Home", "Work", "Sources", "System"]);
});
