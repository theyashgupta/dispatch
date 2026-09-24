import { test } from "node:test";
import assert from "node:assert/strict";
import { VAULT_NAME_RE } from "./vault-name.js";

test("accepts uppercase names with digits and underscores", () => {
  for (const name of ["API_KEY", "_PRIVATE", "K9", "A"]) {
    assert.equal(VAULT_NAME_RE.test(name), true, name);
  }
});

test("refuses lowercase, leading digits, spaces and empty names", () => {
  for (const name of ["api_key", "9KEY", "API KEY", "", "API-KEY"]) {
    assert.equal(VAULT_NAME_RE.test(name), false, name);
  }
});
