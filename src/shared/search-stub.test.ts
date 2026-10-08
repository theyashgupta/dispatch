import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOARD_KEY } from "./board-key.js";
import type { CardSearchResult } from "./search.js";
import { stubToCard } from "./search-stub.js";
import type { BoardKey } from "./types.js";

test("stubToCard keeps the four search fields and fills the rest with placeholders", () => {
  assert.deepEqual(
    stubToCard(
      {
        id: "c1",
        identifier: "LOCAL-1",
        title: "Found",
        column: "parked",
      },
      DEFAULT_BOARD_KEY,
    ),
    {
      id: "c1",
      identifier: "LOCAL-1",
      title: "Found",
      column: "parked",
      boardKey: DEFAULT_BOARD_KEY,
      issueId: "",
      description: null,
      priority: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
    },
  );
});

const stub: CardSearchResult = {
  id: "ACME-7",
  identifier: "ACME-7",
  title: "Old acme ticket",
  column: "done",
};

void test("stubToCard carries the board and the identity fields of the hit", () => {
  const card = stubToCard(stub, "ACME" as BoardKey);
  assert.equal(card.boardKey, "ACME");
  assert.equal(card.id, "ACME-7");
  assert.equal(card.identifier, "ACME-7");
  assert.equal(card.title, "Old acme ticket");
  assert.equal(card.column, "done");
});
