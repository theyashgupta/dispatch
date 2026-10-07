import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChainReason,
  describeChainMove,
  parseChainReason,
  type ChainReason,
} from "./account-chain.js";

test("a chain reason round trips with labels that contain ' to '", () => {
  const facts: ChainReason = {
    trigger: "usage",
    from: "go to work@x.com",
    to: "Default to b@x.com",
    sessions: 3,
  };
  assert.deepEqual(parseChainReason(buildChainReason(facts)), facts);
  assert.equal(
    describeChainMove("failover", facts),
    "Moved 3 sessions from go to work@x.com to Default to b@x.com at a usage limit",
  );
});

test("a row written before the JSON form still reads, with no session count", () => {
  assert.deepEqual(parseChainReason("Default to a@x.com"), {
    trigger: "usage",
    from: "Default",
    to: "a@x.com",
    sessions: null,
  });
  assert.equal(
    parseChainReason("Default to a@x.com, not moved")?.trigger,
    "held",
  );
  assert.equal(
    parseChainReason("Default to a@x.com, switched now")?.trigger,
    "switch-now",
  );
});

test("a reason that is not a chain reason reads as null", () => {
  assert.equal(parseChainReason(null), null);
  assert.equal(parseChainReason("no pair here"), null);
  assert.equal(parseChainReason("{not json"), null);
  assert.equal(
    parseChainReason('{"trigger":"other","from":"a","to":"b"}'),
    null,
  );
});

test("each trigger reads as its own sentence", () => {
  const base = { from: "a@x.com", to: "b@x.com", sessions: 1 };
  assert.equal(
    describeChainMove("failover", { ...base, trigger: "reset" }),
    "Moved 1 session from a@x.com to b@x.com after a reset",
  );
  assert.equal(
    describeChainMove("failover", { ...base, trigger: "switch-now" }),
    "Moved 1 session from a@x.com to b@x.com on Switch now",
  );
  assert.equal(
    describeChainMove("failover", { ...base, trigger: "held", sessions: 0 }),
    "a@x.com is at its usage limit; sessions can move to b@x.com",
  );
  assert.equal(
    describeChainMove("return", {
      trigger: "reset",
      from: "b@x.com",
      to: "a@x.com",
      sessions: 2,
    }),
    "Returned 2 sessions to a@x.com after its reset",
  );
});
