import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pinFromBoard,
  selectedCardOf,
  type PinnedCard,
} from "./pinned-card.js";
import type { Card } from "./types.js";

const card = (id: string, groupId?: string) =>
  ({ id, groupId }) as unknown as Card;

const parent = card("g1");
const member = card("m1", "g1");
const solo = card("s1");
const cards = [parent, member, solo];

test("pinFromBoard returns null for a null id", () => {
  assert.equal(pinFromBoard(null, cards), null);
});

test("pinFromBoard returns null when the card is not in the window", () => {
  assert.equal(pinFromBoard("missing", cards), null);
  assert.equal(pinFromBoard("s1", []), null);
});

test("pinFromBoard pins a live card as hydrated with no members", () => {
  assert.deepEqual(pinFromBoard("s1", cards), {
    card: solo,
    kind: "hydrated",
    members: [],
  });
});

test("pinFromBoard pins a group parent with its members from the board", () => {
  const pin = pinFromBoard("g1", cards);
  assert.equal(pin?.card, parent);
  assert.equal(pin?.kind, "hydrated");
  assert.deepEqual(pin?.members, [member]);
});

const pinned = (c: Card): PinnedCard => ({
  card: c,
  kind: "hydrated",
  members: [],
});

test("selectedCardOf prefers the live board card over the pinned card", () => {
  const stale = card("s1");
  assert.equal(selectedCardOf(cards, "s1", pinned(stale)), solo);
});

test("selectedCardOf falls back to the pinned card when the board misses", () => {
  const off = card("off");
  assert.equal(selectedCardOf(cards, "off", pinned(off)), off);
  assert.equal(selectedCardOf(undefined, "off", pinned(off)), off);
});

test("selectedCardOf ignores a pinned card for another id", () => {
  assert.equal(selectedCardOf(cards, "off", pinned(card("other"))), null);
});

test("selectedCardOf returns null with no match and no pin", () => {
  assert.equal(selectedCardOf(cards, "off", null), null);
  assert.equal(selectedCardOf(undefined, "off", null), null);
});

test("selectedCardOf returns null for a null selection with no card to match", () => {
  assert.equal(selectedCardOf(cards, null, null), null);
  assert.equal(selectedCardOf(cards, null, pinned(solo)), null);
});
