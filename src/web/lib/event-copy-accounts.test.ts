import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountActivityEvent } from "../../shared/types.js";
import { describeEvent } from "./event-copy.js";

const at = (
  type: AccountActivityEvent["type"],
  reason: string | null,
): AccountActivityEvent => ({
  id: 1,
  cardId: null,
  type,
  fromCol: null,
  toCol: null,
  reason,
  source: "accounts",
  ts: "2026-10-05T00:00:00.000Z",
});

test("each account activity kind has its own feed label", () => {
  assert.equal(
    describeEvent(at("account_moved", "default to work, switch")),
    "Claude account moved: default to work, switch",
  );
  assert.equal(
    describeEvent(at("account_moved", null)),
    "Claude account moved",
  );
  assert.equal(
    describeEvent(at("account_login_changed", null)),
    "home Claude login changed",
  );
  assert.equal(
    describeEvent(at("account_login_failed", "home-login")),
    "Claude login failed: home-login",
  );
  assert.equal(
    describeEvent(at("account_login_failed", null)),
    "Claude login failed",
  );
});
