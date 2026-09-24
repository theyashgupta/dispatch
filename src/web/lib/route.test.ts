import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, parseRoute, routeHash } from "./route.js";

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

test("the route table holds exactly the ten shell pages", () => {
  assert.deepEqual([...PAGES].sort(), [
    "accounts",
    "activity",
    "archive",
    "board",
    "inbox",
    "playbooks",
    "sessions",
    "settings",
    "vault",
    "workspace",
  ]);
  assert.deepEqual(parseRoute("#/accounts/whatever"), {
    page: "accounts",
    id: "whatever",
  });
});

test("a hash without the slash still parses", () => {
  assert.deepEqual(parseRoute("#inbox"), { page: "inbox" });
});

test("routeHash round-trips every valid hash", () => {
  for (const hash of [
    "#/board",
    "#/inbox",
    "#/workspace",
    "#/settings",
    "#/settings/vault",
    "#/activity",
    "#/accounts",
    "#/playbooks",
    "#/vault",
    "#/archive",
  ]) {
    assert.equal(routeHash(parseRoute(hash)), hash);
  }
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
