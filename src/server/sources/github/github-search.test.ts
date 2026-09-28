import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeSearchResults,
  SEARCH_CATEGORIES,
  type RawSearchItem,
  type SearchResult,
} from "./github.source.js";

const [REVIEW, MENTION, ASSIGNED] = SEARCH_CATEGORIES;

function pr(
  number: number,
  repo = "acme/api",
  extra: Partial<RawSearchItem> = {},
): RawSearchItem {
  return {
    number,
    title: `PR ${number}`,
    body: `Body of ${number}`,
    html_url: `https://github.com/${repo}/pull/${number}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    user: { login: "octo" },
    draft: false,
    updated_at: "2026-09-25T09:00:00Z",
    ...extra,
  };
}

function result(
  category: SearchResult["category"],
  items: RawSearchItem[],
  extra: Partial<SearchResult> = {},
): SearchResult {
  return {
    category,
    total: items.length,
    incomplete: false,
    ssoPartial: false,
    items,
    ...extra,
  };
}

test("a PR returned by two categories becomes one item of the first category", () => {
  const { items, partial } = mergeSearchResults([
    result(REVIEW, [pr(12)]),
    result(MENTION, [pr(12), pr(15)]),
    result(ASSIGNED, [pr(15), pr(7, "acme/web")]),
  ]);
  assert.equal(partial, false);
  assert.deepEqual(
    items.map((i) => [i.id, i.type, i.priority]),
    [
      ["github:acme/api#12", "pr_review", 75],
      ["github:acme/api#15", "pr_mention", 50],
      ["github:acme/web#7", "pr_assigned", 50],
    ],
  );
});

test("an item carries the R-05 fields and meta keys", () => {
  const [item] = mergeSearchResults([
    result(REVIEW, [pr(12, "acme/api", { draft: true })]),
  ]).items;
  assert.deepEqual(item, {
    id: "github:acme/api#12",
    source: "github",
    type: "pr_review",
    title: "PR 12",
    snippet: "Body of 12",
    url: "https://github.com/acme/api/pull/12",
    createdAt: "2026-09-25T09:00:00Z",
    priority: 75,
    state: "unread",
    meta: {
      repo: "acme/api",
      number: "12",
      author: "octo",
      draft: "true",
      category: "review",
    },
  });
});

test("the snippet is the trimmed body cut at 280 characters", () => {
  const long = `  ${"x".repeat(400)}  `;
  const [item] = mergeSearchResults([
    result(REVIEW, [pr(1, "acme/api", { body: long })]),
  ]).items;
  assert.equal(item?.snippet.length, 280);
  const [empty] = mergeSearchResults([
    result(REVIEW, [pr(2, "acme/api", { body: null })]),
  ]).items;
  assert.equal(empty?.snippet, "");
});

test("a total over one page marks the pull partial", () => {
  assert.equal(
    mergeSearchResults([result(REVIEW, [pr(1)], { total: 101 })]).partial,
    true,
  );
  assert.equal(
    mergeSearchResults([result(REVIEW, [pr(1)], { total: 100 })]).partial,
    false,
  );
});

test("incomplete results mark the pull partial", () => {
  assert.equal(
    mergeSearchResults([result(MENTION, [], { incomplete: true })]).partial,
    true,
  );
});

test("an SSO partial-results header marks the pull partial", () => {
  assert.equal(
    mergeSearchResults([result(ASSIGNED, [], { ssoPartial: true })]).partial,
    true,
  );
});

test("an item whose repository URL cannot be parsed is skipped", () => {
  const { items } = mergeSearchResults([
    result(REVIEW, [pr(1, "acme/api", { repository_url: "https://x/y" })]),
  ]);
  assert.deepEqual(items, []);
});
