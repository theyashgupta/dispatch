import assert from "node:assert/strict";
import { test } from "node:test";
import { cardBoardSwitch } from "../../shared/board-select.js";
import { DONE_PAGE_SIZE } from "../../shared/done-limit.js";
import type { CardSearchResult } from "../../shared/search.js";
import type { BoardKey, Card } from "../../shared/types.js";
import { createAppStore } from "./app-store.js";

const ACME = "ACME" as BoardKey;

const hit: CardSearchResult = {
  id: "ACME-7",
  identifier: "ACME-7",
  title: "Old acme ticket",
  column: "done",
};

void test("setBoard sets the board and a same-value setBoard notifies no listener", () => {
  const store = createAppStore();
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });
  store.setBoard(ACME);
  assert.equal(store.getState().board, ACME);
  assert.equal(calls, 1);
  store.setBoard(ACME);
  assert.equal(calls, 1);
});

void test("a board change resets the done limit and the same board keeps it", () => {
  const store = createAppStore();
  store.loadMoreDone();
  store.loadMoreDone();
  assert.equal(store.getState().doneLimit, DONE_PAGE_SIZE * 3);
  store.setBoard(ACME);
  assert.equal(store.getState().doneLimit, DONE_PAGE_SIZE);
  store.loadMoreDone();
  store.setBoard(ACME);
  assert.equal(store.getState().doneLimit, DONE_PAGE_SIZE * 2);
});

void test("a search stub opened outside the window carries the selected board, so it causes no board switch", () => {
  const store = createAppStore();
  store.setBoard(ACME);
  store.openSearchResult(hit, false);
  const pinned = store.getState().pinned;
  assert.equal(pinned?.kind, "stub");
  assert.equal(pinned?.card.boardKey, ACME);
  assert.equal(cardBoardSwitch(pinned?.card.boardKey, ACME), null);
});

void test("openPushCard for a card of another board selects it and hydrates it by id without moving the board", () => {
  const store = createAppStore();
  store.openPushCard("ACME-7");
  const state = store.getState();
  assert.equal(state.selectedCardId, "ACME-7");
  assert.equal(state.pinnedHydrating, true);
  assert.deepEqual(state.pinFetch, { id: "ACME-7", gen: 1 });
  assert.equal(state.pinned, null);
  assert.equal(state.board, "LOCAL");
  const card = { id: "ACME-7", boardKey: ACME } as unknown as Card;
  store.pinFetched(1, { card, members: [] });
  const pinned = store.getState().pinned;
  assert.equal(pinned?.kind, "hydrated");
  assert.equal(
    cardBoardSwitch(pinned?.card.boardKey, "LOCAL" as BoardKey),
    ACME,
  );
});
