import assert from "node:assert/strict";
import { test } from "node:test";
import { NAV_ITEMS } from "./nav-items.js";

test("the System rows list the Settings Pages links in rail order", () => {
  const links = NAV_ITEMS.filter((item) => item.group === "System").map(
    ({ page, label }) => ({ page, label }),
  );
  assert.deepEqual(links, [
    { page: "accounts", label: "Accounts and Usage" },
    { page: "playbooks", label: "Playbooks" },
    { page: "vault", label: "Vault" },
    { page: "archive", label: "Archive" },
    { page: "workspaces", label: "Workspaces" },
    { page: "flow", label: "Flow" },
  ]);
});
