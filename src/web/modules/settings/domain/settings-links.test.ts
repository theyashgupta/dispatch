import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTINGS_PAGE_LINKS } from "./settings-links.js";

void test("the Pages group lists the System pages in rail order", () => {
  assert.deepEqual(SETTINGS_PAGE_LINKS, [
    { page: "accounts", label: "Accounts and Usage" },
    { page: "playbooks", label: "Playbooks" },
    { page: "vault", label: "Vault" },
    { page: "archive", label: "Archive" },
    { page: "workspaces", label: "Workspaces" },
    { page: "flow", label: "Flow" },
  ]);
});

void test("every link names a distinct page", () => {
  const pages = SETTINGS_PAGE_LINKS.map((link) => link.page);
  assert.equal(new Set(pages).size, pages.length);
});
