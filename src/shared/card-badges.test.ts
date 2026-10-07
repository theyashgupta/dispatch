import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveShowDot, deriveShowGone } from "./card-badges.js";
import type { Card } from "./types.js";

function card(extra: Partial<Card> = {}): Card {
  return { id: "c1", column: "in_progress", ...extra } as Card;
}

test("deriveShowGone badges a card gone from Linear outside the first columns", () => {
  assert.equal(deriveShowGone(card({ goneFromLinear: true })), true);
  assert.equal(deriveShowGone(card({ goneFromLinear: false })), false);
  assert.equal(deriveShowGone(card()), false);
});

test("deriveShowGone exempts todo and inbox cards", () => {
  assert.equal(
    deriveShowGone(card({ goneFromLinear: true, column: "todo" })),
    false,
  );
  assert.equal(
    deriveShowGone(card({ goneFromLinear: true, column: "inbox" })),
    false,
  );
});

test("deriveShowDot shows the dot for unseen output on a live session", () => {
  const live = card({
    tmuxSession: "s1",
    outputChangedAt: "2026-10-06T10:00:00.000Z",
  });
  assert.equal(deriveShowDot(live, false, {}), true);
  assert.equal(
    deriveShowDot(live, false, { c1: "2026-10-06T09:00:00.000Z" }),
    true,
  );
  assert.equal(
    deriveShowDot(live, false, { c1: "2026-10-06T11:00:00.000Z" }),
    false,
  );
});

test("deriveShowDot hides the dot when selected, session lost or no session", () => {
  const live = card({
    tmuxSession: "s1",
    outputChangedAt: "2026-10-06T10:00:00.000Z",
  });
  assert.equal(deriveShowDot(live, true, {}), false);
  assert.equal(deriveShowDot({ ...live, sessionLost: true }, false, {}), false);
  assert.equal(
    deriveShowDot({ ...live, tmuxSession: undefined }, false, {}),
    false,
  );
});
