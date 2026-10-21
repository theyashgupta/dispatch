import { test } from "node:test";
import assert from "node:assert/strict";
import { BOTTOM_BAR_SLOTS, nextBarState } from "./bottom-bar.js";

test("the slots read Today, Inbox, New ticket, Board, Orchestrator in order", () => {
  assert.deepEqual(
    BOTTOM_BAR_SLOTS.map((slot) => slot.label),
    ["Today", "Inbox", "New ticket", "Board", "Orchestrator"],
  );
});

test("near the top the bar shows", () => {
  assert.deepEqual(nextBarState({ visible: false, anchor: 300 }, 40, false), {
    visible: true,
    anchor: 40,
  });
});

test("a move under the threshold keeps the same state object", () => {
  const state = { visible: true, anchor: 200 };
  assert.equal(nextBarState(state, 205, false), state);
});

test("scrolling down hides the bar", () => {
  assert.deepEqual(nextBarState({ visible: true, anchor: 200 }, 260, false), {
    visible: false,
    anchor: 260,
  });
});

test("scrolling up shows the bar", () => {
  assert.deepEqual(nextBarState({ visible: false, anchor: 400 }, 300, false), {
    visible: true,
    anchor: 300,
  });
});

test("an upward clamp at the bottom edge keeps a hidden bar hidden", () => {
  assert.deepEqual(nextBarState({ visible: false, anchor: 900 }, 836, true), {
    visible: false,
    anchor: 836,
  });
});

test("a clamp inside the top zone on a short page keeps a hidden bar hidden", () => {
  assert.deepEqual(nextBarState({ visible: false, anchor: 100 }, 36, true), {
    visible: false,
    anchor: 36,
  });
});

test("scrolling up at the bottom edge keeps a visible bar visible", () => {
  assert.deepEqual(nextBarState({ visible: true, anchor: 900 }, 836, true), {
    visible: true,
    anchor: 836,
  });
});
