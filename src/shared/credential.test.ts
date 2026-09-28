import assert from "node:assert/strict";
import { test } from "node:test";
import { isProviderCode, TOKEN_SHAPE } from "./credential.js";

test("isProviderCode accepts only plain lowercase codes", () => {
  assert.equal(isProviderCode("token_revoked"), true);
  for (const bad of [
    "",
    "<script>",
    "Token_Revoked",
    "a b",
    "a1",
    undefined,
    7,
  ]) {
    assert.equal(isProviderCode(bad), false);
  }
});

test("TOKEN_SHAPE refuses spaces, control and non-ASCII characters", () => {
  assert.equal(TOKEN_SHAPE.test("xoxp-1-a_B"), true);
  for (const bad of ["", "xoxp 1", "xoxp\u00001", "xoxp-é"]) {
    assert.equal(TOKEN_SHAPE.test(bad), false);
  }
});
