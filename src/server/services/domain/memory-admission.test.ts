import test from "node:test";
import assert from "node:assert/strict";
import type { MemorySample, SystemMemory } from "../../../shared/types.js";
import { admitStart } from "./memory-admission.js";

const POLICY = { memoryFloorMb: 1024, swapCeilingMb: 4096 };

function reading(
  freeMb: number,
  swapUsedMb: number,
  stale = false,
): SystemMemory {
  const sample: MemorySample = {
    at: "2026-10-13T10:00:00.000Z",
    freeMb,
    compressorMb: 2000,
    swapUsedMb,
    swapTotalMb: 8192,
    load1: 3,
  };
  return { supported: true, sample, stale };
}

test("free memory below the floor is refused with the free-memory reason", () => {
  assert.deepEqual(admitStart(reading(812, 1000), POLICY), {
    ok: false,
    reason: "free memory 812 MB is below the 1024 MB floor",
  });
});

test("free memory at the floor is admitted", () => {
  assert.deepEqual(admitStart(reading(1024, 1000), POLICY), { ok: true });
});

test("free memory above the floor and swap under the ceiling is admitted", () => {
  assert.deepEqual(admitStart(reading(2000, 3000), POLICY), { ok: true });
});

test("a floor of 0 turns the free-memory check off", () => {
  assert.deepEqual(
    admitStart(reading(0, 1000), { ...POLICY, memoryFloorMb: 0 }),
    { ok: true },
  );
});

test("swap used at the ceiling is admitted", () => {
  assert.deepEqual(admitStart(reading(2000, 4096), POLICY), { ok: true });
});

test("swap used above the ceiling is refused with the swap reason", () => {
  assert.deepEqual(admitStart(reading(2000, 4300), POLICY), {
    ok: false,
    reason: "swap used 4300 MB is above the 4096 MB ceiling",
  });
});

test("when both checks fail the free-memory reason is given", () => {
  assert.deepEqual(admitStart(reading(500, 5000), POLICY), {
    ok: false,
    reason: "free memory 500 MB is below the 1024 MB floor",
  });
});

test("no reading is admitted", () => {
  assert.deepEqual(admitStart({ supported: false }, POLICY), { ok: true });
});

test("a stale reading is admitted even past both thresholds", () => {
  assert.deepEqual(admitStart(reading(100, 9000, true), POLICY), {
    ok: true,
  });
});
