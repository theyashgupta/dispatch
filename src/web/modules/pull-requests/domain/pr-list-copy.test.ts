import assert from "node:assert/strict";
import { test } from "node:test";
import { prEmptyState } from "./pr-list-copy.js";

test("a board with a GitHub remote and no pull request reads as no rows", () => {
  assert.deepEqual(prEmptyState({ repos: ["acme/api"], hasRows: false }), {
    kind: "no-rows",
    title: "No open pull requests",
    description: "Open pull requests in the board repositories show up here.",
  });
});

test("a board with no GitHub remote says so", () => {
  assert.deepEqual(prEmptyState({ repos: [], hasRows: false }), {
    kind: "no-remote",
    title: "No GitHub repositories",
    description: "No board repository has a GitHub remote.",
  });
});

test("an unknown repository list with no rows reads as no rows", () => {
  assert.deepEqual(prEmptyState({ repos: null, hasRows: false }), {
    kind: "no-rows",
    title: "No open pull requests",
    description: "Open pull requests in the board repositories show up here.",
  });
});

test("filters that hide every row get the filtered case", () => {
  const expected = {
    kind: "filtered",
    title: "No pull requests match",
    description: "Try other filters, or clear them to see every pull request.",
  };
  assert.deepEqual(
    prEmptyState({ repos: ["acme/api"], hasRows: true }),
    expected,
  );
  assert.deepEqual(prEmptyState({ repos: [], hasRows: true }), expected);
  assert.deepEqual(prEmptyState({ repos: null, hasRows: true }), expected);
});
