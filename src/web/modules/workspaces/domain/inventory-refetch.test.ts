import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOARD_REFRESH_GAP_MS,
  inventoryRefetchDelay,
} from "./inventory-refetch.js";

test("the gap is 5 seconds", () => {
  assert.equal(BOARD_REFRESH_GAP_MS, 5_000);
});

test("a refetch right after the last one waits the whole gap", () => {
  assert.equal(inventoryRefetchDelay(0), 5_000);
});

test("a refetch inside the gap waits the remainder", () => {
  assert.equal(inventoryRefetchDelay(1_200), 3_800);
  assert.equal(inventoryRefetchDelay(4_999), 1);
});

test("a refetch at the gap runs at once", () => {
  assert.equal(inventoryRefetchDelay(5_000), 0);
});

test("a refetch after the gap runs at once", () => {
  assert.equal(inventoryRefetchDelay(60_000), 0);
});
