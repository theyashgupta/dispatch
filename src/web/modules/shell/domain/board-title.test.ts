import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGES } from "../../../../shared/route.js";
import { BOARD_PAGES, boardPageTitle } from "./board-title.js";

test("a board page with two boards reads the title and the board name", () => {
  assert.equal(boardPageTitle("board", "Board", "Acme"), "Board · Acme");
  assert.equal(boardPageTitle("archive", "Archive", "Acme"), "Archive · Acme");
});

test("a board page with one board keeps the plain title", () => {
  assert.equal(boardPageTitle("board", "Board", null), "Board");
});

test("a global page keeps its title when a board name is given", () => {
  assert.equal(boardPageTitle("settings", "Settings", "Acme"), "Settings");
  assert.equal(boardPageTitle("vault", "Vault", "Acme"), "Vault");
});

test("BOARD_PAGES holds exactly the ten board pages", () => {
  assert.deepEqual([...BOARD_PAGES].sort(), [
    "activity",
    "archive",
    "board",
    "flow",
    "inbox",
    "sessions",
    "tickets",
    "today",
    "workspace",
    "workspaces",
  ]);
  for (const page of ["settings", "vault", "accounts", "connections"]) {
    assert.ok(!(BOARD_PAGES as readonly string[]).includes(page));
  }
  assert.ok(BOARD_PAGES.every((page) => PAGES.includes(page)));
});
