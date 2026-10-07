import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLUMN_WIDTH_MAX,
  COLUMN_WIDTH_MIN,
  COLUMN_WIDTH_STEP,
  clampColumnWidth,
  isWidthDrag,
  parseColumnWidths,
} from "./column-widths.js";

test("the bounds and step are 220, 480 and 20 pixels", () => {
  assert.equal(COLUMN_WIDTH_MIN, 220);
  assert.equal(COLUMN_WIDTH_MAX, 480);
  assert.equal(COLUMN_WIDTH_STEP, 20);
});

test("a width below 220 clamps to 220 and above 480 clamps to 480", () => {
  assert.equal(clampColumnWidth(100), 220);
  assert.equal(clampColumnWidth(-5), 220);
  assert.equal(clampColumnWidth(900), 480);
});

test("a width inside the range, including both edges, is kept", () => {
  assert.equal(clampColumnWidth(220), 220);
  assert.equal(clampColumnWidth(300.5), 300.5);
  assert.equal(clampColumnWidth(480), 480);
});

test("a pointer travel of 3 pixels or less is not a drag, from either direction", () => {
  assert.equal(isWidthDrag(3), false);
  assert.equal(isWidthDrag(-3), false);
  assert.equal(isWidthDrag(0), false);
  assert.equal(isWidthDrag(4), true);
  assert.equal(isWidthDrag(-4), true);
});

test("no stored value, an empty string or bad JSON gives an empty map", () => {
  assert.deepEqual(parseColumnWidths(null), {});
  assert.deepEqual(parseColumnWidths(""), {});
  assert.deepEqual(parseColumnWidths("{nope"), {});
});

test("a stored value that is not an object gives an empty map", () => {
  assert.deepEqual(parseColumnWidths("null"), {});
  assert.deepEqual(parseColumnWidths("42"), {});
  assert.deepEqual(parseColumnWidths('"wide"'), {});
});

test("an entry that is not a finite number is dropped and the rest are kept", () => {
  assert.deepEqual(
    parseColumnWidths('{"todo":300,"done":"wide","parked":null,"inbox":true}'),
    { todo: 300 },
  );
});

test("stored widths are kept as saved and clamped only where used", () => {
  assert.deepEqual(parseColumnWidths('{"todo":100,"done":900}'), {
    todo: 100,
    done: 900,
  });
  assert.equal(clampColumnWidth(100), 220);
});

test("a key that is not a column is kept as legacy kept it", () => {
  assert.deepEqual(parseColumnWidths('{"nope":300}'), { nope: 300 });
});

test("a valid map round trips through JSON", () => {
  const map = { todo: 240, in_progress: 480, done: 220 };
  assert.deepEqual(parseColumnWidths(JSON.stringify(map)), map);
});
