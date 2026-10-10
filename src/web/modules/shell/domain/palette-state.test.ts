import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_PALETTE, paletteReducer, rowAt } from "./palette-state.js";

test("a query change resets the highlight to the first row", () => {
  const moved = { ...INITIAL_PALETTE, query: "in", highlight: 3 };
  assert.deepEqual(paletteReducer(moved, { type: "query", query: "inb" }), {
    query: "inb",
    highlight: 0,
    promptId: null,
  });
});

const PROMPT = "create-board";
const prompting = paletteReducer(
  { ...INITIAL_PALETTE, query: "cre", highlight: 2 },
  { type: "enter-prompt", commandId: PROMPT },
);

test("entering a prompt clears the query and the highlight and keeps the prompt id", () => {
  assert.deepEqual(prompting, { query: "", highlight: 0, promptId: PROMPT });
});

test("typing in prompt mode keeps the prompt id", () => {
  assert.deepEqual(
    paletteReducer(prompting, { type: "query", query: "Payments" }),
    { query: "Payments", highlight: 0, promptId: PROMPT },
  );
});

test("leaving a prompt returns to an empty command list", () => {
  const typed = paletteReducer(prompting, { type: "query", query: "Pay" });
  assert.deepEqual(
    paletteReducer(typed, { type: "leave-prompt" }),
    INITIAL_PALETTE,
  );
  assert.deepEqual(
    paletteReducer(INITIAL_PALETTE, { type: "leave-prompt" }),
    INITIAL_PALETTE,
  );
});

test("a move in prompt mode keeps the prompt and the query", () => {
  const typed = paletteReducer(prompting, { type: "query", query: "Pay" });
  assert.deepEqual(
    paletteReducer(typed, { type: "move", delta: 1, count: 1 }),
    typed,
  );
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
