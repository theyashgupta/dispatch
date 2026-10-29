import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../../../shared/types.js";
import {
  blockedByErrorCopy,
  blockerOptions,
  blockerRows,
} from "./blocked-by-field.js";

function card(extra: Partial<Card>): Card {
  return {
    id: "c",
    identifier: "LOCAL-0",
    title: "t",
    column: "todo",
    ...extra,
  } as Card;
}

const self = card({ id: "s", identifier: "LOCAL-1", blockedBy: ["a", "gone"] });
const a = card({ id: "a", identifier: "LOCAL-2", title: "Alpha" });
const done = card({ id: "d", identifier: "LOCAL-3", column: "done" });
const b = card({ id: "b", identifier: "LOCAL-4", title: "Beta" });
const member = card({ id: "m", groupId: "g" });
const group = card({ id: "g", source: "group" });
const hidden = card({ id: "h", source: "orchestrator" });
const all = [self, a, done, b, member, group, hidden];

test("blockerRows resolves identifiers and flags open or missing blockers", () => {
  assert.deepEqual(blockerRows(self, all), [
    { id: "a", identifier: "LOCAL-2", title: "Alpha", open: true },
    { id: "gone", identifier: "gone", title: "Not on this board", open: true },
  ]);
  assert.deepEqual(
    blockerRows(card({ blockedBy: ["d"] }), all)[0]?.open,
    false,
  );
  assert.deepEqual(blockerRows(card({}), all), []);
});

test("blockerOptions drops self, current blockers, members and hidden cards, and keeps a group card", () => {
  assert.deepEqual(
    blockerOptions(self, all).map((o) => o.id),
    ["d", "b", "g"],
  );
});

test("blockedByErrorCopy shows code and reason, code alone, or the offline copy", () => {
  assert.equal(
    blockedByErrorCopy({
      status: 400,
      error: "blocked-by-cycle",
      reason: "A -> B -> A",
    }),
    "blocked-by-cycle: A -> B -> A",
  );
  assert.equal(
    blockedByErrorCopy({ status: 409, error: "grouped", reason: null }),
    "grouped",
  );
  assert.equal(
    blockedByErrorCopy({ status: 0, error: null, reason: null }),
    "Could not reach the server",
  );
});
