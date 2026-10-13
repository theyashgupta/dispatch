import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "./types.js";
import { isListedError, isSentryIssueId } from "./feed-items.js";

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

test("only a Sentry item that is neither done nor snoozed is a listed error", () => {
  const base = item("sentry:s1", "sentry");
  assert.equal(isListedError(base), true);
  assert.equal(isListedError({ ...base, state: "read" }), true);
  assert.equal(isListedError({ ...base, state: "done" }), false);
  assert.equal(isListedError({ ...base, state: "snoozed" }), false);
  assert.equal(isListedError({ ...base, source: "github" }), false);
});

test("a Sentry issue id is digits only", () => {
  assert.equal(isSentryIssueId("99999"), true);
  for (const id of ["", "..", ".", "1/2", "1a", "-1"]) {
    assert.equal(isSentryIssueId(id), false);
  }
});
