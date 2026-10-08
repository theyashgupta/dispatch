import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey, BoardSnapshot } from "../../../../shared/types.js";
import { needsSeed } from "./transition-seed.js";

const snap = (boardKey?: string): BoardSnapshot => ({
  cards: [],
  syncedAt: null,
  boardKey: boardKey as BoardKey,
});

void test("needsSeed seeds the first snapshot and the first snapshot of another board only", () => {
  assert.equal(needsSeed(null, snap()), true);
  assert.equal(needsSeed(null, snap("ACME")), true);
  assert.equal(needsSeed("LOCAL", snap()), false);
  assert.equal(needsSeed("LOCAL", snap("LOCAL")), false);
  assert.equal(needsSeed("LOCAL", snap("ACME")), true);
  assert.equal(needsSeed("ACME", snap("ACME")), false);
});
