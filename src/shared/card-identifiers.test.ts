import assert from "node:assert/strict";
import { test } from "node:test";
import { cardIdentifiers } from "./card-identifiers.js";
import type { Card } from "./types.js";

const card = (id: string, identifier: string) =>
  ({ id, identifier }) as unknown as Card;

test("an empty list maps to an empty record", () => {
  assert.deepEqual(cardIdentifiers([]), {});
});

test("each card id maps to its identifier", () => {
  assert.deepEqual(
    cardIdentifiers([card("a", "LOCAL-1"), card("b", "LOCAL-2")]),
    { a: "LOCAL-1", b: "LOCAL-2" },
  );
});

test("a repeated id keeps the later identifier", () => {
  assert.deepEqual(
    cardIdentifiers([card("a", "LOCAL-1"), card("a", "LOCAL-9")]),
    { a: "LOCAL-9" },
  );
});
