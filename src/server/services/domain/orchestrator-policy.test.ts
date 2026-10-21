import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetWarningStep,
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

void test("budgetWarningStep sets at the threshold, keeps a mark on a cost drop, refreshes a changed setting the cost still passes and clears by the re-arm rule", () => {
  const mark = {
    at: "2026-10-20T00:00:00.000Z",
    cost: 8.5,
    budget: 10,
    percent: 80,
  };
  const step = (
    budget: number | null,
    percent: number,
    cost: number,
    withMark: boolean,
  ) =>
    budgetWarningStep({
      budget,
      percent,
      cost,
      mark: withMark ? mark : undefined,
    });
  assert.equal(step(10, 80, 7.99, false), "keep");
  assert.equal(step(10, 80, 8, false), "set");
  assert.equal(step(10, 80, 9.5, true), "keep");
  assert.equal(step(null, 80, 9.5, true), "clear");
  assert.equal(step(null, 80, 9.5, false), "keep");
  assert.equal(step(20, 80, 9.5, true), "clear");
  assert.equal(step(20, 80, 17, true), "refresh");
  assert.equal(step(10, 70, 9, true), "refresh");
  assert.equal(step(10, 80, 5, true), "keep");
  assert.equal(step(10, 90, 8.5, true), "clear");
  assert.equal(step(0.5, 1, 0.01, false), "set");
});
