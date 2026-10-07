import assert from "node:assert/strict";
import { test } from "node:test";
import { startTarget } from "./start-request.js";
import type { Card } from "./types.js";

const a = { id: "a" } as unknown as Card;
const b = { id: "b" } as unknown as Card;

test("a string id finds the board card", () => {
  assert.equal(startTarget("b", [a, b]), b);
});

test("a request object finds the card by its cardId", () => {
  assert.equal(startTarget({ cardId: "a", newSession: true }, [a, b]), a);
});

test("an id outside the window returns undefined", () => {
  assert.equal(startTarget("missing", [a, b]), undefined);
  assert.equal(startTarget({ cardId: "missing" }, [a]), undefined);
});

test("no board returns undefined", () => {
  assert.equal(startTarget("a", undefined), undefined);
  assert.equal(startTarget("a", []), undefined);
});
