import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../../../shared/types.js";
import {
  dragSelectionIds,
  isForceDimmed,
  isMultiSelectable,
  pruneSelection,
} from "./drag-selection.js";

test("a grabbed card inside a selection of two or more drags the whole selection", () => {
  assert.deepEqual(dragSelectionIds("a", new Set(["a", "b", "c"])), [
    "a",
    "b",
    "c",
  ]);
});

test("a grabbed card outside the selection drags alone", () => {
  assert.equal(dragSelectionIds("z", new Set(["a", "b"])), null);
});

test("a selection of one drags alone", () => {
  assert.equal(dragSelectionIds("a", new Set(["a"])), null);
});

test("a selected resting card dims while another selected card is dragged", () => {
  const selected = new Set(["a", "b"]);
  assert.equal(isForceDimmed("b", "a", selected), true);
});

test("the dragged card itself, an unselected card and an idle board do not force dim", () => {
  const selected = new Set(["a", "b"]);
  assert.equal(isForceDimmed("a", "a", selected), false);
  assert.equal(isForceDimmed("c", "a", selected), false);
  assert.equal(isForceDimmed("b", null, selected), false);
  assert.equal(isForceDimmed("b", "z", selected), false);
});

function card(over: Partial<Card> & { id: string }): Card {
  return { column: "todo", source: "linear", ...over } as Card;
}

test("only an ungrouped non-group To Do card is multi-selectable", () => {
  assert.equal(isMultiSelectable(card({ id: "a" })), true);
  assert.equal(isMultiSelectable(card({ id: "a", groupId: "g" })), false);
  assert.equal(isMultiSelectable(card({ id: "a", source: "group" })), false);
  assert.equal(
    isMultiSelectable(card({ id: "a", column: "in_progress" })),
    false,
  );
});

test("pruneSelection keeps To Do ids and drops grouped, group, moved and missing cards", () => {
  const cards = [
    card({ id: "todo" }),
    card({ id: "grouped", groupId: "g" }),
    card({ id: "group", source: "group" }),
    card({ id: "moved", column: "done" }),
  ];
  const pruned = pruneSelection(
    new Set(["todo", "grouped", "group", "moved", "gone"]),
    cards,
  );
  assert.deepEqual([...pruned], ["todo"]);
});

test("pruneSelection keeps a selected card whose move is still in flight", () => {
  const cards = [card({ id: "a", column: "needs_input" }), card({ id: "b" })];
  const selected = new Set(["a", "b"]);
  assert.equal(pruneSelection(selected, cards, new Set(["a"])), selected);
  assert.deepEqual([...pruneSelection(selected, cards)], ["b"]);
});

test("pruneSelection returns the same set when nothing was removed", () => {
  const selected = new Set(["a", "b"]);
  assert.equal(
    pruneSelection(selected, [card({ id: "a" }), card({ id: "b" })]),
    selected,
  );
});
