import assert from "node:assert/strict";
import { test } from "node:test";
import { membersOf } from "./group-members.js";
import type { Card } from "./types.js";

const c = (id: string, groupId?: string) =>
  ({ id, ...(groupId ? { groupId } : {}) }) as unknown as Card;

test("membersOf returns the cards linked to the group by groupId", () => {
  const group = c("g1");
  const all = [group, c("a", "g1"), c("b", "g2"), c("d", "g1"), c("e")];
  assert.deepEqual(
    membersOf(group, all).map((m) => m.id),
    ["a", "d"],
  );
});

test("membersOf is empty when no card links to the group", () => {
  assert.deepEqual(membersOf(c("g1"), [c("a"), c("b", "g2")]), []);
});
