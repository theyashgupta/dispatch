import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxFeed } from "./feed-items.js";
import type { Item } from "./types.js";

const item = (id: string, source: string): Item => ({
  id,
  source,
  type: "pr_review",
  title: id,
  snippet: "",
  createdAt: "2026-09-25T00:00:00Z",
  priority: 50,
  state: "unread",
  meta: {},
});

const items = [
  item("github:1", "github"),
  item("sentry:1", "sentry"),
  item("slack:1", "slack"),
];
const ids = (list: Item[]) => list.map((i) => i.id);

test("errors on and slack enabled keeps every item", () => {
  assert.deepEqual(ids(inboxFeed(items, true, ["slack"])), [
    "github:1",
    "sentry:1",
    "slack:1",
  ]);
});

test("errors off drops sentry only", () => {
  assert.deepEqual(ids(inboxFeed(items, false, ["slack"])), [
    "github:1",
    "slack:1",
  ]);
});

test("slack not enabled drops slack only", () => {
  assert.deepEqual(ids(inboxFeed(items, true, ["github"])), [
    "github:1",
    "sentry:1",
  ]);
  assert.deepEqual(ids(inboxFeed(items, true, [])), ["github:1", "sentry:1"]);
});

test("errors off and slack not enabled drops both", () => {
  assert.deepEqual(ids(inboxFeed(items, false, [])), ["github:1"]);
});

test("the input list is not mutated", () => {
  inboxFeed(items, false, []);
  assert.equal(items.length, 3);
});
