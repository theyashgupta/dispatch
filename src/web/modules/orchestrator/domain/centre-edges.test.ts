import assert from "node:assert/strict";
import { test } from "node:test";
import { elbowPath } from "./centre-edges.js";

test("an elbow runs right to the middle, down to the tile row, then right into the tile", () => {
  assert.equal(
    elbowPath({ x: 240, y: 60 }, { x: 320, y: 200 }),
    "M240 60H280V200H320",
  );
});

test("an elbow to a tile on the same row is a straight line through the middle", () => {
  assert.equal(
    elbowPath({ x: 240, y: 60 }, { x: 320, y: 60 }),
    "M240 60H280V60H320",
  );
});

test("an elbow rounds fractional coordinates to whole pixels", () => {
  assert.equal(
    elbowPath({ x: 240.4, y: 60.6 }, { x: 320.2, y: 200.5 }),
    "M240 61H280V201H320",
  );
});
