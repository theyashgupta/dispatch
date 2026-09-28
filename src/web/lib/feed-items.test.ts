import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../shared/types.js";
import { feedItems, isListedError } from "./feed-items.js";

function item(id: string, source: string): Item {
  return {
    id,
    source,
    type: "pr_review",
    title: id,
    snippet: "",
    createdAt: "2026-09-25T00:00:00Z",
    priority: 50,
    state: "unread",
    meta: {},
  };
}

test("off drops only sentry items, keeping github and other sources in order", () => {
  const items = [
    item("github:1", "github"),
    item("sentry:1", "sentry"),
    item("linear:1", "linear"),
    item("sentry:2", "sentry"),
  ];
  assert.deepEqual(
    feedItems(items, false).map((i) => i.id),
    ["github:1", "linear:1"],
  );
});

test("on keeps every item, sentry included", () => {
  const items = [item("github:1", "github"), item("sentry:1", "sentry")];
  assert.deepEqual(
    feedItems(items, true).map((i) => i.id),
    ["github:1", "sentry:1"],
  );
});

test("an empty list stays empty either way", () => {
  assert.deepEqual(feedItems([], false), []);
  assert.deepEqual(feedItems([], true), []);
});

test("the input array is not mutated", () => {
  const items = [item("github:1", "github"), item("sentry:1", "sentry")];
  const copy = [...items];
  feedItems(items, false);
  assert.deepEqual(items, copy);
});

test("only a Sentry item that is neither done nor snoozed is a listed error", () => {
  const base = item("sentry:s1", "sentry");
  assert.equal(isListedError(base), true);
  assert.equal(isListedError({ ...base, state: "read" }), true);
  assert.equal(isListedError({ ...base, state: "done" }), false);
  assert.equal(isListedError({ ...base, state: "snoozed" }), false);
  assert.equal(isListedError({ ...base, source: "github" }), false);
});
