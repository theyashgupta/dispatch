import test from "node:test";
import assert from "node:assert/strict";
import { shownComments } from "./shown-comments.js";

const listA = [{ id: "a1" }];
const listB = [{ id: "b1" }];

test("fresh data shows as it is", () => {
  assert.equal(
    shownComments("B", listB, { cardId: "A", comments: listA }),
    listB,
  );
});

test("a failed refetch keeps the last list of the same card", () => {
  assert.equal(
    shownComments("A", undefined, { cardId: "A", comments: listA }),
    listA,
  );
});

test("a failed fetch never shows the list of another card", () => {
  assert.deepEqual(
    shownComments("B", undefined, { cardId: "A", comments: listA }),
    [],
  );
});

test("no data and nothing loaded shows an empty list", () => {
  assert.deepEqual(shownComments("A", undefined, null), []);
});
