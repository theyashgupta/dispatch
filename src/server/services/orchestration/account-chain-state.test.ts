import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import type { ChainStateFile } from "../../../shared/types.js";

isolateEnv();
const paths = await import("../infra/paths.js");
const chain = await import("./account-chain-state.js");

const ID = "11111111-1111-4111-8111-111111111111";

function move(n: number) {
  return {
    at: `2026-10-01T00:00:${String(n).padStart(2, "0")}.000Z`,
    from: "default",
    to: ID,
    reason: `m${n}`,
  };
}

void test("the chain state file sits beside accounts.json", () => {
  assert.equal(
    path.dirname(chain.CHAIN_STATE_PATH),
    path.dirname(paths.CLAUDE_ACCOUNTS_REGISTRY_PATH),
  );
});

void test("a missing chain state reads as empty", async () => {
  assert.deepEqual(await chain.readChainState(), chain.emptyChainState());
});

void test("chain state round trips every field", async () => {
  const state: ChainStateFile = {
    accounts: {
      default: {
        state: "near-limit",
        buckets: [
          {
            kind: "five_hour",
            percent: 91,
            resetsAt: "2026-10-01T05:00:00.000Z",
          },
        ],
        limitedUntil: null,
      },
      [ID]: {
        state: "limited",
        buckets: [],
        limitedUntil: "2026-10-02T00:00:00.000Z",
      },
    },
    inUseSince: "2026-10-01T00:00:00.000Z",
    exhausted: {
      since: "2026-10-01T01:00:00.000Z",
      earliestResetAt: "2026-10-02T00:00:00.000Z",
    },
    moves: [move(1)],
    loginExpiryNotified: { [ID]: "2026-10-04T00:00:00.000Z" },
    decisions: { [`needs-login:${ID}`]: "decision-1" },
  };
  await chain.writeChainState(state);
  assert.deepEqual(await chain.readChainState(), state);
  assert.equal(fs.statSync(chain.CHAIN_STATE_PATH).mode & 0o777, 0o600);
});

void test("an entry keeps its fetchedAt through a write and a read, and an entry without it still reads", async () => {
  const state: ChainStateFile = {
    ...chain.emptyChainState(),
    accounts: {
      default: {
        state: "available",
        buckets: [],
        limitedUntil: null,
        fetchedAt: "2026-10-01T00:00:00.000Z",
      },
      [ID]: {
        state: "unknown",
        buckets: [],
        limitedUntil: null,
        fetchedAt: null,
      },
    },
  };
  await chain.writeChainState(state);
  assert.deepEqual(await chain.readChainState(), state);

  const old = { state: "limited", buckets: [], limitedUntil: null };
  fs.writeFileSync(
    chain.CHAIN_STATE_PATH,
    JSON.stringify({ accounts: { default: old } }),
  );
  assert.deepEqual((await chain.readChainState()).accounts, { default: old });
});

void test("corrupt or wrong-shaped chain state reads as empty and does not throw", async () => {
  for (const body of ["{not json", "[]", "null", '{"accounts":[]}', ""]) {
    fs.writeFileSync(chain.CHAIN_STATE_PATH, body);
    assert.deepEqual(await chain.readChainState(), chain.emptyChainState());
  }
});

void test("the moves list keeps only the last 50 on write and on read", async () => {
  const moves = Array.from({ length: 60 }, (_, i) => move(i));
  await chain.writeChainState({ ...chain.emptyChainState(), moves });
  const onDisk = JSON.parse(
    fs.readFileSync(chain.CHAIN_STATE_PATH, "utf8"),
  ) as ChainStateFile;
  assert.equal(onDisk.moves.length, 50);
  assert.equal(onDisk.moves[0]?.reason, "m10");
  assert.equal(onDisk.moves[49]?.reason, "m59");

  fs.writeFileSync(
    chain.CHAIN_STATE_PATH,
    JSON.stringify({ ...chain.emptyChainState(), moves }),
  );
  const read = await chain.readChainState();
  assert.equal(read.moves.length, 50);
  assert.equal(read.moves[0]?.reason, "m10");
});

void test("entries with an unknown state, a bad limitedUntil or a bad shape are dropped, and a bad exhausted record reads as null (F11, C-15)", async () => {
  const good = { state: "limited", buckets: [], limitedUntil: null };
  fs.writeFileSync(
    chain.CHAIN_STATE_PATH,
    JSON.stringify({
      accounts: {
        default: good,
        a: null,
        b: { state: "gone", buckets: [], limitedUntil: null },
        c: { state: "limited", buckets: [], limitedUntil: 5 },
        d: { state: "available", limitedUntil: null },
      },
      inUseSince: null,
      exhausted: { since: "2026-10-01T00:00:00.000Z" },
      moves: [],
    }),
  );
  assert.deepEqual(await chain.readChainState(), {
    ...chain.emptyChainState(),
    accounts: { default: good },
  });
});

void test("a file without loginExpiryNotified reads it as empty, and a non-string entry is dropped", async () => {
  const base = { accounts: {}, inUseSince: null, exhausted: null, moves: [] };
  fs.writeFileSync(chain.CHAIN_STATE_PATH, JSON.stringify(base));
  assert.deepEqual((await chain.readChainState()).loginExpiryNotified, {});

  for (const bad of [null, [], "x", 5]) {
    fs.writeFileSync(
      chain.CHAIN_STATE_PATH,
      JSON.stringify({ ...base, loginExpiryNotified: bad }),
    );
    assert.deepEqual((await chain.readChainState()).loginExpiryNotified, {});
  }

  fs.writeFileSync(
    chain.CHAIN_STATE_PATH,
    JSON.stringify({
      ...base,
      loginExpiryNotified: { a: "2026-10-04T00:00:00.000Z", b: 5, c: null },
    }),
  );
  assert.deepEqual((await chain.readChainState()).loginExpiryNotified, {
    a: "2026-10-04T00:00:00.000Z",
  });
});

void test("decisions and rejectedReads round trip, and a needs-login entry survives the reader", async () => {
  const state: ChainStateFile = {
    ...chain.emptyChainState(),
    accounts: {
      [ID]: {
        state: "needs-login",
        buckets: [],
        limitedUntil: null,
        rejectedReads: 2,
      },
    },
    decisions: { [`needs-login:${ID}`]: "decision-1" },
  };
  await chain.writeChainState(state);
  assert.deepEqual(await chain.readChainState(), state);
});

void test("a file without decisions reads an empty record, and a non-string decision id is dropped", async () => {
  fs.writeFileSync(
    chain.CHAIN_STATE_PATH,
    JSON.stringify({ accounts: {}, loginExpiryNotified: {} }),
  );
  assert.deepEqual((await chain.readChainState()).decisions, {});
  fs.writeFileSync(
    chain.CHAIN_STATE_PATH,
    JSON.stringify({ accounts: {}, decisions: { a: "x", b: 3, c: null } }),
  );
  assert.deepEqual((await chain.readChainState()).decisions, { a: "x" });
});
