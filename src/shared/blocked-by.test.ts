import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockerChip,
  blockerIdentifiers,
  canBeBlocked,
  isBlockerDone,
  openBlockers,
} from "./blocked-by.js";
import type { Card, PrInfo } from "./types.js";

function card(extra: Partial<Card> = {}): Card {
  return { id: "c1", identifier: "LOCAL-1", column: "todo", ...extra } as Card;
}

function pr(state: PrInfo["state"]): PrInfo {
  return { state } as PrInfo;
}

function byId(...cards: Card[]): Map<string, Card> {
  return new Map(cards.map((c) => [c.id, c]));
}

test("isBlockerDone is true for a card in the done column", () => {
  assert.equal(isBlockerDone(card({ column: "done" })), true);
  assert.equal(
    isBlockerDone(card({ column: "done", prs: [pr("open")] })),
    true,
  );
});

test("isBlockerDone is true when every PR is merged", () => {
  assert.equal(isBlockerDone(card({ prs: [pr("merged")] })), true);
  assert.equal(
    isBlockerDone(card({ prs: [pr("merged"), pr("merged")] })),
    true,
  );
});

test("isBlockerDone is false for mixed, open, closed or absent PRs", () => {
  assert.equal(isBlockerDone(card({ prs: [pr("merged"), pr("open")] })), false);
  assert.equal(isBlockerDone(card({ prs: [pr("open")] })), false);
  assert.equal(isBlockerDone(card({ prs: [pr("closed")] })), false);
  assert.equal(isBlockerDone(card({ prs: [] })), false);
  assert.equal(isBlockerDone(card()), false);
});

test("isBlockerDone is false for a missing card", () => {
  assert.equal(isBlockerDone(undefined), false);
});

const done = card({ id: "d", identifier: "LOCAL-9", column: "done" });
const a = card({ id: "a", identifier: "LOCAL-3" });
const b = card({ id: "b", identifier: "LOCAL-4" });

const isDone = (map: Map<string, Card>) => (id: string) =>
  isBlockerDone(map.get(id));

test("openBlockers keeps stored order and drops done and absent-list cases", () => {
  const open = isDone(byId(done, a, b));
  assert.deepEqual(openBlockers(card({ blockedBy: ["b", "d", "a"] }), open), [
    "b",
    "a",
  ]);
  assert.deepEqual(openBlockers(card(), open), []);
  assert.deepEqual(openBlockers(card({ blockedBy: ["d"] }), open), []);
});

test("openBlockers treats a missing blocker as open", () => {
  assert.deepEqual(
    openBlockers(card({ blockedBy: ["gone"] }), isDone(byId())),
    ["gone"],
  );
});

test("blockerIdentifiers names each card and falls back to the id", () => {
  const map = byId(a, b);
  assert.deepEqual(
    blockerIdentifiers(["b", "gone", "a"], (id) => map.get(id)),
    ["LOCAL-4", "gone", "LOCAL-3"],
  );
});

test("blockerChip is null when no blocker is open", () => {
  assert.equal(blockerChip(card(), byId(done)), null);
  assert.equal(blockerChip(card({ blockedBy: ["d"] }), byId(done)), null);
});

test("blockerChip names the first open blocker, counts the rest and lists all in the title", () => {
  const map = byId(done, a, b);
  assert.deepEqual(blockerChip(card({ blockedBy: ["a"] }), map), {
    label: "LOCAL-3",
    title: "Blocked by LOCAL-3",
  });
  assert.deepEqual(blockerChip(card({ blockedBy: ["d", "a", "b"] }), map), {
    label: "LOCAL-3 +1",
    title: "Blocked by LOCAL-3, LOCAL-4",
  });
});

test("blockerChip is null outside To Do and Inbox", () => {
  const map = byId(a);
  for (const column of ["in_progress", "parked", "done"] as const) {
    assert.equal(blockerChip(card({ blockedBy: ["a"], column }), map), null);
  }
  assert.ok(blockerChip(card({ blockedBy: ["a"], column: "inbox" }), map));
});

test("blockerChip falls back to the id for a missing blocker", () => {
  assert.deepEqual(blockerChip(card({ blockedBy: ["gone", "a"] }), byId(a)), {
    label: "gone +1",
    title: "Blocked by gone, LOCAL-3",
  });
});

test("canBeBlocked rejects groups, members and orchestrator cards", () => {
  assert.equal(canBeBlocked(card()), true);
  assert.equal(canBeBlocked(card({ source: "linear" })), true);
  assert.equal(canBeBlocked(card({ source: "group" })), false);
  assert.equal(canBeBlocked(card({ groupId: "g1" })), false);
  assert.equal(canBeBlocked(card({ source: "orchestrator" })), false);
});
