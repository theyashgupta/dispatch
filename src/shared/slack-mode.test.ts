import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSlackMode } from "./slack-mode.js";

test("a configured mcp or token wins whatever the Vault holds", () => {
  for (const hasVaultToken of [true, false]) {
    assert.equal(resolveSlackMode("mcp", hasVaultToken), "mcp");
    assert.equal(resolveSlackMode("token", hasVaultToken), "token");
  }
});

test("an absent or garbage value follows the Vault: token with one, mcp without", () => {
  for (const configured of [undefined, null, "", "MCP", "both", 1, {}]) {
    assert.equal(resolveSlackMode(configured, true), "token");
    assert.equal(resolveSlackMode(configured, false), "mcp");
  }
});
