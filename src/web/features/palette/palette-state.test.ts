import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_PALETTE, paletteReducer, rowAt } from "./palette-state.js";

test("a query change resets the highlight to the first row", () => {
  const moved = { query: "in", highlight: 3 };
  assert.deepEqual(paletteReducer(moved, { type: "query", query: "inb" }), {
    query: "inb",
    highlight: 0,
  });
});

test("moves clamp to the rendered rows at both ends", () => {
  const down = paletteReducer(INITIAL_PALETTE, {
    type: "move",
    delta: 5,
    count: 3,
  });
  assert.equal(down.highlight, 2);
  const up = paletteReducer(down, { type: "move", delta: -9, count: 3 });
  assert.equal(up.highlight, 0);
  assert.equal(
    paletteReducer(INITIAL_PALETTE, { type: "move", delta: 1, count: 0 })
      .highlight,
    0,
  );
});

test("results follow the commands in one index space", () => {
  const commands = ["go", "new"];
  const results = ["LOCAL-1", "LOCAL-2"];
  assert.deepEqual(rowAt(commands, results, 1), {
    kind: "command",
    command: "new",
  });
  assert.deepEqual(rowAt(commands, results, 2), {
    kind: "card",
    result: "LOCAL-1",
  });
  assert.equal(rowAt(commands, results, 4), null);
});
