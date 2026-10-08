import test from "node:test";
import assert from "node:assert/strict";
import {
  checkBudget,
  checkCap,
  checkShipRights,
} from "./orchestrator-policy.js";

void test("checkCap allows below the cap and refuses at, above and with a cap of 0", () => {
  assert.deepEqual(
    checkCap({ policy: { concurrencyCap: 2 }, runningLoops: 1 }),
    { ok: true },
  );
  assert.deepEqual(
    checkCap({ policy: { concurrencyCap: 1 }, runningLoops: 1 }),
    { ok: false, reason: "concurrency cap reached: 1 of 1 loops running" },
  );
  assert.deepEqual(
    checkCap({ policy: { concurrencyCap: 2 }, runningLoops: 3 }),
    { ok: false, reason: "concurrency cap reached: 3 of 2 loops running" },
  );
  assert.deepEqual(
    checkCap({ policy: { concurrencyCap: 0 }, runningLoops: 0 }),
    { ok: false, reason: "concurrency cap reached: 0 of 0 loops running" },
  );
});

void test("checkBudget allows a null budget and a cost below it, and refuses at and above it", () => {
  assert.deepEqual(
    checkBudget({ policy: { budgetPerGroup: null }, cost: 1e9 }),
    { ok: true },
  );
  assert.deepEqual(checkBudget({ policy: { budgetPerGroup: 5 }, cost: 4.5 }), {
    ok: true,
  });
  assert.deepEqual(checkBudget({ policy: { budgetPerGroup: 5 }, cost: 5 }), {
    ok: false,
    reason: "budget reached: cost 5 of 5",
  });
  assert.deepEqual(checkBudget({ policy: { budgetPerGroup: 5 }, cost: 7.25 }), {
    ok: false,
    reason: "budget reached: cost 7.25 of 5",
  });
});

void test("checkShipRights refuses none and allows open_prs and merge", () => {
  assert.deepEqual(checkShipRights({ shipRights: "none" }), {
    ok: false,
    reason: "ship rights are none",
  });
  assert.deepEqual(checkShipRights({ shipRights: "open_prs" }), { ok: true });
  assert.deepEqual(checkShipRights({ shipRights: "merge" }), { ok: true });
});
