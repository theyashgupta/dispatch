import assert from "node:assert/strict";
import { test } from "node:test";
import { FLIP_STALE_MS, cardMoveFlipDelta } from "./card-move-flip.js";

const prev = { left: 100, top: 40, at: 1000 };
const next = () => ({ left: 160, top: 70 });

test("a stored rect inside the window plays the inverse of the move", () => {
  assert.deepEqual(cardMoveFlipDelta(prev, undefined, 1050, next), {
    dx: -60,
    dy: -30,
  });
});

test("a rect exactly at the window edge still plays", () => {
  assert.notEqual(
    cardMoveFlipDelta(prev, undefined, 1000 + FLIP_STALE_MS, next),
    null,
  );
});

test("a fresh suppression mark skips the flip", () => {
  assert.equal(cardMoveFlipDelta(prev, 1040, 1050, next), null);
});

test("an expired suppression mark does not block a fresh rect", () => {
  assert.notEqual(
    cardMoveFlipDelta({ ...prev, at: 1500 }, 1000, 1550, next),
    null,
  );
});

test("an expired stored rect skips the flip", () => {
  assert.equal(
    cardMoveFlipDelta(prev, undefined, 1000 + FLIP_STALE_MS + 1, next),
    null,
  );
});

test("no stored rect skips the flip without reading the next rect", () => {
  let read = false;
  const lazy = () => {
    read = true;
    return { left: 0, top: 0 };
  };
  assert.equal(cardMoveFlipDelta(undefined, undefined, 1050, lazy), null);
  assert.equal(read, false);
});

test("a zero delta on both axes skips the flip", () => {
  assert.equal(
    cardMoveFlipDelta(prev, undefined, 1050, () => ({ left: 100, top: 40 })),
    null,
  );
});

test("a delta on one axis only still plays", () => {
  assert.deepEqual(
    cardMoveFlipDelta(prev, undefined, 1050, () => ({ left: 100, top: 10 })),
    { dx: 0, dy: 30 },
  );
});
