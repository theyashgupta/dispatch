import test from "node:test";
import assert from "node:assert/strict";
import {
  admitToken,
  anchorSides,
  chainPath,
  edgePath,
  TOKEN_CAP,
} from "./flow-geometry.js";

const a = { x: 0, y: 0, w: 100, h: 40 };

void test("a node to the right is joined right side to left side", () => {
  const b = { x: 300, y: 10, w: 100, h: 40 };
  assert.deepEqual(anchorSides(a, b), { from: "right", to: "left" });
  assert.ok(edgePath(a, b).startsWith("M 100 20 C"));
  assert.ok(edgePath(a, b).endsWith(", 300 30"));
});

void test("a node to the left is joined left side to right side", () => {
  const b = { x: -300, y: 0, w: 100, h: 40 };
  assert.deepEqual(anchorSides(a, b), { from: "left", to: "right" });
  assert.equal(edgePath(a, b), "M 0 20 C -100 20, -100 20, -200 20");
});

void test("a node stacked below is joined bottom to top", () => {
  const b = { x: 0, y: 200, w: 100, h: 40 };
  assert.deepEqual(anchorSides(a, b), { from: "bottom", to: "top" });
  assert.equal(edgePath(a, b), "M 50 40 C 50 120, 50 120, 50 200");
  assert.deepEqual(anchorSides(b, a), { from: "top", to: "bottom" });
});

void test("equal center distances pick the horizontal sides", () => {
  const b = { x: 100, y: 100, w: 100, h: 40 };
  assert.deepEqual(anchorSides(a, b), { from: "right", to: "left" });
  assert.deepEqual(anchorSides(a, { ...b, y: 101 }), {
    from: "bottom",
    to: "top",
  });
});

void test("a node offset diagonally but farther across joins side to side", () => {
  const triage = { x: 610, y: 252, w: 150, h: 56 };
  const urgent = { x: 820, y: 40, w: 150, h: 80 };
  assert.deepEqual(anchorSides(triage, urgent), { from: "right", to: "left" });
});

void test("a chain of three rects is one path with a single move", () => {
  const d = chainPath([
    a,
    { x: 300, y: 0, w: 100, h: 40 },
    { x: 600, y: 0, w: 100, h: 40 },
  ]);
  assert.equal(d.match(/M/g)?.length, 1);
  assert.equal(d.match(/C/g)?.length, 2);
  assert.ok(d.startsWith("M 100 20 C"));
  assert.ok(d.endsWith(", 600 20"));
});

void test("a token is admitted below the cap and refused at it", () => {
  assert.equal(TOKEN_CAP, 40);
  assert.equal(admitToken(0), true);
  assert.equal(admitToken(39), true);
  assert.equal(admitToken(40), false);
  assert.equal(admitToken(41), false);
});
