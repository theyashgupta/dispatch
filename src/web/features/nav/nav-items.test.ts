import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, parseRoute } from "../../../shared/route.js";
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

test("groups with no rows are omitted and order is Home, Work, Sources, System", () => {
  assert.deepEqual(
    navGroups(NAV_ITEMS).map((entry) => entry.group),
    ["Home", "Work", "Sources", "System"],
  );
  assert.deepEqual(
    navGroups(NAV_ITEMS.filter((item) => item.group !== "System")).map(
      (entry) => entry.group,
    ),
    ["Home", "Work", "Sources"],
  );
});

test("an empty item list yields no groups", () => {
  assert.deepEqual(navGroups([]), []);
});

test("the System group lists its pages in order, Workspaces after Archive, Flow last", () => {
  assert.deepEqual(
    NAV_ITEMS.filter((item) => item.group === "System").map(
      (item) => item.page,
    ),
    ["accounts", "playbooks", "vault", "archive", "workspaces", "flow"],
  );
});

test("the Work group lists Board, Sessions, Workspace and Activity in order", () => {
  assert.deepEqual(
    NAV_ITEMS.filter((item) => item.group === "Work").map((item) => item.page),
    ["board", "sessions", "workspace", "activity"],
  );
});

test("the Sources group holds Tickets, Pull Requests, Errors, Meetings, Calendar and Slack", () => {
  assert.deepEqual(
    NAV_ITEMS.filter((item) => item.group === "Sources").map(
      (item) => item.page,
    ),
    ["tickets", "pull-requests", "errors", "meetings", "calendar", "slack"],
  );
});

test("the Home group lists Today first, then Inbox, then Ask", () => {
  assert.deepEqual(
    NAV_ITEMS.filter((item) => item.group === "Home").map((item) => item.page),
    ["today", "inbox", "ask"],
  );
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
