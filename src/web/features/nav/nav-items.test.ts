import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, parseRoute } from "../../lib/route.js";
import { NAV_ITEMS, navGroups } from "./nav-items.js";

test("every route page except settings has exactly one nav row", () => {
  for (const page of PAGES) {
    const rows = NAV_ITEMS.filter((item) => item.page === page).length;
    assert.equal(rows, page === "settings" ? 0 : 1, page);
  }
});

test("every nav row's page parses back to itself", () => {
  for (const item of NAV_ITEMS) {
    assert.equal(parseRoute(`#/${item.page}`).page, item.page);
  }
});

test("groups with no rows are omitted and order is Home, Work, System", () => {
  assert.deepEqual(
    navGroups(NAV_ITEMS).map((entry) => entry.group),
    ["Home", "Work", "System"],
  );
  assert.deepEqual(
    navGroups(NAV_ITEMS.filter((item) => item.group !== "System")).map(
      (entry) => entry.group,
    ),
    ["Home", "Work"],
  );
});

test("an empty item list yields no groups", () => {
  assert.deepEqual(navGroups([]), []);
});

test("the System group lists the four moved pages in order", () => {
  assert.deepEqual(
    NAV_ITEMS.filter((item) => item.group === "System").map(
      (item) => item.page,
    ),
    ["accounts", "playbooks", "vault", "archive"],
  );
});

test("the Work group lists Board, Sessions, Workspace and Activity in order", () => {
  assert.deepEqual(
    NAV_ITEMS.filter((item) => item.group === "Work").map((item) => item.page),
    ["board", "sessions", "workspace", "activity"],
  );
});
