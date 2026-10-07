import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChainReason } from "./account-chain.js";
import type { AccountActivityEvent } from "./types.js";
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
  ts: "2026-10-06T00:00:00.000Z",
});

test("a legacy failover row names both accounts", () => {
  assert.equal(
    describeEvent(at("account_failover", "Work to Personal")),
    "Moved sessions from Work to Personal at a usage limit",
  );
});

test("a failover that autoMove held back reads as an offer", () => {
  assert.equal(
    describeEvent(at("account_failover", "Work to Personal, not moved")),
    "Work is at its usage limit; sessions can move to Personal",
  );
});

test("a return names the account sessions came back to", () => {
  assert.equal(
    describeEvent(at("account_return", "Personal to Work")),
    "Returned sessions to Work after its reset",
  );
  assert.equal(
    describeEvent(at("account_return", "Personal to Work, not moved")),
    "Work has reset; sessions can move back to it",
  );
});

test("a chain event without a readable reason keeps a plain label", () => {
  assert.equal(
    describeEvent(at("account_failover", null)),
    "Claude account at its usage limit",
  );
  assert.equal(
    describeEvent(at("account_return", null)),
    "Claude account reset",
  );
});

test("an exhausted chain names the earliest reset or says it is unknown", () => {
  const reset = "2026-10-06T14:30:00.000Z";
  assert.equal(
    describeEvent(at("account_chain_exhausted", reset)),
    `Every account is at its limit; the earliest reset is ${new Date(reset).toLocaleString()}`,
  );
  assert.equal(
    describeEvent(at("account_chain_exhausted", "")),
    "Every account is at its limit; the earliest reset is unknown",
  );
});

test("a Switch now failover reads as a manual switch", () => {
  assert.equal(
    describeEvent(at("account_failover", "Work to Personal, switched now")),
    "Moved sessions from Work to Personal on Switch now",
  );
});

test("a failover after a reset names the reset and the session count", () => {
  assert.equal(
    describeEvent(
      at(
        "account_failover",
        buildChainReason({
          trigger: "reset",
          from: "Default",
          to: "b@x.com",
          sessions: 3,
        }),
      ),
    ),
    "Moved 3 sessions from Default to b@x.com after a reset",
  );
});

test("a return and a held offer read from the encoded reason", () => {
  assert.equal(
    describeEvent(
      at(
        "account_return",
        buildChainReason({
          trigger: "reset",
          from: "b@x.com",
          to: "a@x.com",
          sessions: 2,
        }),
      ),
    ),
    "Returned 2 sessions to a@x.com after its reset",
  );
  assert.equal(
    describeEvent(
      at(
        "account_failover",
        buildChainReason({
          trigger: "held",
          from: "a@x.com",
          to: "b@x.com",
          sessions: 0,
        }),
      ),
    ),
    "a@x.com is at its usage limit; sessions can move to b@x.com",
  );
});
