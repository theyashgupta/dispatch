import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "./types.js";
import { capitalize, humanizeType, itemRow } from "./inbox-row.js";

test("capitalize upper-cases the first character only", () => {
  assert.equal(capitalize("review"), "Review");
  assert.equal(capitalize("a b"), "A b");
});

test("capitalize keeps an empty string empty", () => {
  assert.equal(capitalize(""), "");
});

test("humanizeType splits on underscore, space and hyphen", () => {
  assert.equal(humanizeType("review_request"), "Review request");
  assert.equal(humanizeType("review request"), "Review request");
  assert.equal(humanizeType("review-request"), "Review request");
});

test("humanizeType upper-cases known acronyms", () => {
  assert.equal(humanizeType("pr_review"), "PR review");
  assert.equal(humanizeType("ci_failure"), "CI failure");
  assert.equal(humanizeType("dm"), "DM");
});

test("humanizeType drops empty segments", () => {
  assert.equal(humanizeType("__mention__"), "Mention");
});

const item = {
  id: "i1",
  source: "slack",
  type: "pr_review",
  title: "Review PR 42",
  snippet: "please look",
  priority: 80,
  createdAt: "2026-09-24T10:00:00.000Z",
  state: "unread",
  url: "https://example.test/pr/42",
} as Item;

test("itemRow maps an unread item to an item row", () => {
  assert.deepEqual(itemRow(item), {
    kind: "item",
    id: "i1",
    source: "slack",
    title: "Review PR 42",
    snippet: "please look",
    priority: 80,
    time: "2026-09-24T10:00:00.000Z",
    unread: true,
    url: "https://example.test/pr/42",
    typeLabel: "PR review",
    item,
  });
});

test("itemRow marks a read item as not unread", () => {
  assert.equal(itemRow({ ...item, state: "read" }).unread, false);
});
