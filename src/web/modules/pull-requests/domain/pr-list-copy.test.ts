import assert from "node:assert/strict";
import { test } from "node:test";
import { prEmptyText, STATE_TONE } from "./pr-list-copy.js";

test("each state text has a tone", () => {
  assert.equal(STATE_TONE.Draft, "neutral");
  assert.equal(STATE_TONE["Review requested from me"], "accent");
  assert.equal(STATE_TONE["Changes requested"], "warning");
  assert.equal(STATE_TONE.Approved, "success");
  assert.equal(STATE_TONE.Open, "neutral");
});

test("a board with a GitHub remote and no pull request reads as empty", () => {
  assert.equal(
    prEmptyText({ repos: ["acme/api"], hasRows: false }),
    "No open pull requests in the board repositories.",
  );
});

test("a board with no GitHub remote says so", () => {
  assert.equal(
    prEmptyText({ repos: [], hasRows: false }),
    "No board repository has a GitHub remote.",
  );
});

test("an unknown repository list reads as an empty table", () => {
  assert.equal(
    prEmptyText({ repos: null, hasRows: false }),
    "No open pull requests in the board repositories.",
  );
});

test("filters that hide every row get their own line", () => {
  assert.equal(
    prEmptyText({ repos: [], hasRows: true }),
    "No pull requests match the filters.",
  );
});
