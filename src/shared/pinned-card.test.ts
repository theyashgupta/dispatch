import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionablePinnedCard,
  actionablePinnedMembers,
  type PinnedCard,
} from "./pinned-card.js";
import type { Card } from "./types.js";

const real = { id: "c1" } as unknown as Card;
const pin = (kind: PinnedCard["kind"]): PinnedCard => ({
  card: real,
  kind,
  members: [],
});

test("a hydrated pinned card with the matching id is actionable", () => {
  assert.equal(actionablePinnedCard("c1", pin("hydrated")), real);
  assert.equal(actionablePinnedMembers("c1", pin("hydrated")), true);
});

test("a stub is never actionable", () => {
  assert.equal(actionablePinnedCard("c1", pin("stub")), null);
  assert.equal(actionablePinnedMembers("c1", pin("stub")), false);
});

test("a hydrated card with another id is not actionable", () => {
  assert.equal(actionablePinnedCard("c2", pin("hydrated")), null);
  assert.equal(actionablePinnedMembers("c2", pin("hydrated")), false);
});

test("no pinned card, or no id, is not actionable", () => {
  assert.equal(actionablePinnedCard("c1", null), null);
  assert.equal(actionablePinnedMembers("c1", null), false);
  assert.equal(actionablePinnedCard(null, pin("hydrated")), null);
  assert.equal(actionablePinnedMembers(undefined, pin("hydrated")), false);
});
