import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../shared/types.js";
import { issue } from "../test-support/fake-source.js";
import { reconcile } from "./mapping.js";

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    issueId: id,
    identifier: id.toUpperCase(),
    title: `Issue ${id}`,
    description: null,
    priority: 2,
    column: "inbox",
    updatedAt: "2026-09-24T09:00:00.000Z",
    source: "linear",
    ...extra,
  };
}

function current(...cards: Card[]): Map<string, Card> {
  return new Map(cards.map((c) => [c.issueId, c]));
}

test("a new issue becomes an Inbox card stamped with the source id", () => {
  const r = reconcile([issue("a")], current(), new Set(), "linear");
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0]?.column, "inbox");
  assert.equal(r.upserts[0]?.source, "linear");
  assert.equal(r.upserts[0]?.goneFromLinear, false);
  assert.deepEqual([r.removeIds, r.goneIds, r.reappearedIds], [[], [], []]);
});

test("existing todo and inbox cards refresh in place and clear the gone flag", () => {
  const todo = card("a", {
    column: "todo",
    goneFromLinear: true,
    title: "old",
  });
  const inbox = card("b", { column: "inbox", title: "old" });
  const r = reconcile(
    [issue("a", { title: "new a" }), issue("b", { title: "new b" })],
    current(todo, inbox),
  );
  assert.deepEqual(
    r.upserts.map((c) => [c.id, c.title, c.column, c.goneFromLinear]),
    [
      ["a", "new a", "todo", false],
      ["b", "new b", "inbox", false],
    ],
  );
});

test("a card past To Do is not refreshed", () => {
  const r = reconcile(
    [issue("a", { title: "new" })],
    current(card("a", { column: "in_progress", title: "old" })),
  );
  assert.deepEqual(r.upserts, []);
  assert.deepEqual(r.reappearedIds, []);
});

test("a gone card past To Do whose issue returns is reported as reappeared only", () => {
  const r = reconcile(
    [issue("a")],
    current(card("a", { column: "done", goneFromLinear: true })),
  );
  assert.deepEqual(r.upserts, []);
  assert.deepEqual(r.reappearedIds, ["a"]);
});

test("an absent issue removes a todo or inbox card and flags a card past To Do", () => {
  const r = reconcile(
    [],
    current(
      card("a", { column: "todo" }),
      card("b", { column: "inbox" }),
      card("c", { column: "in_review" }),
    ),
  );
  assert.deepEqual(r.removeIds.sort(), ["a", "b"]);
  assert.deepEqual(r.goneIds, ["c"]);
});

test("a todo card with a start in flight or provisioning state is flagged, never removed", () => {
  const r = reconcile(
    [],
    current(
      card("a", { column: "todo" }),
      card("b", { column: "todo", provisioningStep: "worktree" }),
    ),
    new Set(["a"]),
  );
  assert.deepEqual(r.removeIds, []);
  assert.deepEqual(r.goneIds.sort(), ["a", "b"]);
});

test("a group member refreshes even past To Do and is never removed", () => {
  const member = card("a", {
    column: "in_progress",
    groupId: "GROUP-1",
    title: "old",
  });
  const refreshed = reconcile([issue("a", { title: "new" })], current(member));
  assert.equal(refreshed.upserts[0]?.title, "new");
  const absent = reconcile([], current(member));
  assert.deepEqual(absent.removeIds, []);
  assert.deepEqual(absent.goneIds, ["a"]);
});
