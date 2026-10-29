import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isKeyedPage,
  KEYED_PAGES,
  PAGES,
  pageLocation,
  parseRoute,
  rememberedHash,
  routeHash,
  switchBoardLocation,
  type Route,
} from "./route.js";

test("every page parses to itself", () => {
  for (const page of PAGES) {
    assert.deepEqual(parseRoute(`#/${page}`), { page });
  }
});

test("a settings hash keeps its tab as the id", () => {
  assert.deepEqual(parseRoute("#/settings/playbooks"), {
    page: "settings",
    id: "playbooks",
  });
});

test("empty, bare and unknown hashes map to the board with no id", () => {
  for (const hash of ["", "#", "#/", "#/nope", "#nope", "#/nope/123"]) {
    assert.deepEqual(parseRoute(hash), { page: "board" });
  }
});

test("the route table holds exactly the shell and source pages", () => {
  assert.deepEqual([...PAGES].sort(), [
    "accounts",
    "activity",
    "archive",
    "ask",
    "board",
    "board-settings",
    "boards",
    "calendar",
    "dashboard",
    "errors",
    "flow",
    "inbox",
    "meetings",
    "orchestrator",
    "playbooks",
    "pull-requests",
    "settings",
    "slack",
    "tickets",
    "today",
    "vault",
    "workspaces",
  ]);
  assert.equal(parseRoute("#/workspaces").page, "workspaces");
  assert.deepEqual(parseRoute("#/flow"), { page: "flow" });
  assert.deepEqual(parseRoute("#/accounts/whatever"), {
    page: "accounts",
    id: "whatever",
  });
});

test("the removed workspace page parses to the board", () => {
  assert.deepEqual(parseRoute("#/workspace"), { page: "board" });
  assert.deepEqual(parseRoute("#/workspace/X"), { page: "board" });
});

test("a hash without the slash still parses", () => {
  assert.deepEqual(parseRoute("#inbox"), { page: "inbox" });
});

test("routeHash round-trips every valid hash", () => {
  for (const hash of [
    "#/board",
    "#/inbox",
    "#/settings",
    "#/settings/vault",
    "#/activity",
    "#/accounts",
    "#/playbooks",
    "#/vault",
    "#/archive",
    "#/meetings",
  ]) {
    assert.equal(routeHash(parseRoute(hash)), hash);
  }
});

test("a meetings id with colons round-trips through routeHash and parseRoute", () => {
  const route = parseRoute(
    routeHash({ page: "meetings", id: "meeting:paste:2026-01-01-sync:key" }),
  );
  assert.deepEqual(route, {
    page: "meetings",
    id: "meeting:paste:2026-01-01-sync:key",
  });
});

test("a malformed percent sequence in the id never throws", () => {
  assert.deepEqual(parseRoute("#/settings/%E0%A4%A"), {
    page: "settings",
    id: "%E0%A4%A",
  });
});

test("a trailing slash and an empty id both mean no id", () => {
  assert.deepEqual(parseRoute("#/settings/"), { page: "settings" });
  assert.equal(routeHash({ page: "settings", id: "" }), "#/settings");
});

test("routeHash encodes an id with reserved characters", () => {
  const route = parseRoute(routeHash({ page: "settings", id: "a b/c" }));
  assert.deepEqual(route, { page: "settings", id: "a b/c" });
});

test("routeHash encodes a boards id whole like other pages", () => {
  assert.equal(
    routeHash({ page: "boards", id: "ACME/settings" }),
    "#/boards/ACME%2Fsettings",
  );
});

test("the keyed pages are exactly the board-scoped ones", () => {
  assert.deepEqual(
    [...KEYED_PAGES],
    ["board", "dashboard", "orchestrator", "inbox", "board-settings"],
  );
  assert.equal(isKeyedPage("inbox"), true);
  assert.equal(isKeyedPage("tickets"), false);
  assert.equal(isKeyedPage("boards"), false);
  assert.equal(isKeyedPage("settings"), false);
});

test("a boards list hash has no id and no board", () => {
  assert.deepEqual(parseRoute("#/boards"), { page: "boards" });
  assert.deepEqual(parseRoute("#/boards/"), { page: "boards" });
});

test("a keyed board hash carries the board key", () => {
  assert.deepEqual(parseRoute("#/boards/NIMBUS"), {
    page: "board",
    board: "NIMBUS",
  });
});

test("a keyed settings hash is the board settings page", () => {
  assert.deepEqual(parseRoute("#/boards/NIMBUS/settings"), {
    page: "board-settings",
    board: "NIMBUS",
  });
});

test("a keyed inbox hash keeps its id and board", () => {
  assert.deepEqual(parseRoute("#/boards/NIMBUS/inbox/abc"), {
    page: "inbox",
    id: "abc",
    board: "NIMBUS",
  });
});

test("a keyed dashboard and inbox hash without an id carry no id", () => {
  assert.deepEqual(parseRoute("#/boards/NIMBUS/dashboard"), {
    page: "dashboard",
    board: "NIMBUS",
  });
  assert.deepEqual(parseRoute("#/boards/NIMBUS/inbox/"), {
    page: "inbox",
    board: "NIMBUS",
  });
});

test("the removed Sessions page opens the boards list", () => {
  assert.deepEqual(parseRoute("#/sessions"), { page: "boards" });
  assert.deepEqual(parseRoute("#/sessions/abc"), { page: "boards" });
  assert.equal((PAGES as readonly string[]).includes("sessions"), false);
});

test("a board Sessions child opens the board", () => {
  assert.deepEqual(parseRoute("#/boards/NIMBUS/sessions"), {
    page: "board",
    board: "NIMBUS",
  });
  assert.deepEqual(parseRoute("#/boards/NIMBUS/sessions/s1"), {
    page: "board",
    board: "NIMBUS",
  });
});

test("a keyed orchestrator hash carries the board and an optional orchestrator id", () => {
  assert.deepEqual(parseRoute("#/boards/NIMBUS/orchestrator"), {
    page: "orchestrator",
    board: "NIMBUS",
  });
  assert.deepEqual(parseRoute("#/boards/NIMBUS/orchestrator/o1"), {
    page: "orchestrator",
    board: "NIMBUS",
    id: "o1",
  });
});

test("a flat orchestrator hash carries no board", () => {
  assert.deepEqual(parseRoute("#/orchestrator"), { page: "orchestrator" });
  assert.deepEqual(parseRoute("#/orchestrator/o1"), {
    page: "orchestrator",
    id: "o1",
  });
});

test("an unknown child under a board maps to that board", () => {
  assert.deepEqual(parseRoute("#/boards/NIMBUS/xyz"), {
    page: "board",
    board: "NIMBUS",
  });
});

test("an encoded slash in a keyed id decodes to a slash", () => {
  assert.deepEqual(parseRoute("#/boards/NIMBUS/inbox/a%2Fb"), {
    page: "inbox",
    id: "a/b",
    board: "NIMBUS",
  });
});

test("a malformed escape in a board key never throws", () => {
  assert.deepEqual(parseRoute("#/boards/%E0%A4%A"), {
    page: "board",
    board: "%E0%A4%A",
  });
});

test("an unknown first segment still maps to the board", () => {
  assert.deepEqual(parseRoute("#/nope/NIMBUS/inbox"), { page: "board" });
});

test("routeHash round-trips every keyed page with a board", () => {
  const routes: Route[] = [
    { page: "board", board: "NIMBUS" },
    { page: "board-settings", board: "NIMBUS" },
    { page: "dashboard", board: "NIMBUS" },
    { page: "dashboard", board: "NIMBUS", id: "d1" },
    { page: "orchestrator", board: "NIMBUS" },
    { page: "orchestrator", board: "NIMBUS", id: "o1" },
    { page: "inbox", board: "NIMBUS" },
    { page: "inbox", board: "NIMBUS", id: "a/b c" },
  ];
  for (const route of routes) {
    assert.deepEqual(parseRoute(routeHash(route)), route);
  }
});

test("routeHash writes the keyed hash for each keyed page", () => {
  assert.equal(
    routeHash({ page: "board", board: "NIMBUS" }),
    "#/boards/NIMBUS",
  );
  assert.equal(
    routeHash({ page: "board-settings", board: "NIMBUS" }),
    "#/boards/NIMBUS/settings",
  );
  assert.equal(
    routeHash({ page: "inbox", board: "NIMBUS", id: "a/b" }),
    "#/boards/NIMBUS/inbox/a%2Fb",
  );
  assert.equal(
    routeHash({ page: "orchestrator", board: "NIMBUS" }),
    "#/boards/NIMBUS/orchestrator",
  );
});

test("a keyed page without a board keeps its legacy hash", () => {
  assert.equal(routeHash({ page: "inbox" }), "#/inbox");
  assert.equal(routeHash({ page: "dashboard", id: "d1" }), "#/dashboard/d1");
  assert.equal(routeHash({ page: "orchestrator" }), "#/orchestrator");
  assert.equal(routeHash({ page: "board" }), "#/board");
});

test("board settings without a board serializes to the boards list", () => {
  assert.equal(routeHash({ page: "board-settings" }), "#/boards");
});

test("a non-keyed page ignores a board on the route", () => {
  assert.equal(routeHash({ page: "tickets", board: "NIMBUS" }), "#/tickets");
});

test("pageLocation puts the board in the path of a keyed page", () => {
  assert.equal(
    pageLocation({ page: "inbox" }, "NIMBUS"),
    "/boards/NIMBUS/inbox",
  );
  assert.equal(pageLocation({ page: "board" }, "LOCAL"), "/boards/LOCAL");
});

test("pageLocation puts the board in a search parameter of any other page", () => {
  assert.equal(
    pageLocation({ page: "tickets" }, "NIMBUS"),
    "/tickets?board=NIMBUS",
  );
  assert.equal(pageLocation({ page: "tickets" }, "LOCAL"), "/tickets");
  assert.equal(
    pageLocation({ page: "errors", id: "e1" }, "NIMBUS"),
    "/errors/e1?board=NIMBUS",
  );
});

test("switchBoardLocation moves a keyed page to the target board without its id", () => {
  assert.equal(
    switchBoardLocation({ page: "dashboard", board: "NIMBUS" }, "GARNET"),
    "/boards/GARNET/dashboard",
  );
  assert.equal(
    switchBoardLocation({ page: "inbox", board: "NIMBUS", id: "x" }, "GARNET"),
    "/boards/GARNET/inbox",
  );
});

test("switchBoardLocation leaves a non-keyed page to the caller", () => {
  assert.equal(switchBoardLocation({ page: "tickets" }, "GARNET"), null);
  assert.equal(switchBoardLocation({ page: "boards" }, "GARNET"), null);
});

test("an Ask route is remembered without its prefilled question", () => {
  assert.equal(
    rememberedHash(routeHash({ page: "ask", id: "Tell me about LOCAL-1" })),
    "#/ask",
  );
  assert.equal(rememberedHash("#/ask"), "#/ask");
});

test("other routes are remembered with their id", () => {
  assert.equal(
    rememberedHash("#/settings/workspaces"),
    "#/settings/workspaces",
  );
  assert.equal(rememberedHash("#/board"), "#/board");
});
