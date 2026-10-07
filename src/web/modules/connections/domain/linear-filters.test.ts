import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterOptions,
  MULTI_COPY,
  previewStateFrom,
  previewText,
  selectionLabel,
  toggleId,
} from "./linear-filters.js";

const draft = {
  assignees: [],
  projects: [],
  teams: [],
  currentCycle: false,
  includeActive: false,
};

test("the preview text covers every state", () => {
  assert.equal(previewText({ status: "counting" }), "counting…");
  assert.equal(previewText({ status: "unavailable" }), "preview unavailable");
  assert.equal(
    previewText({ status: "ready", count: 250, more: true }),
    "Matches 250+ tickets",
  );
  assert.equal(
    previewText({ status: "ready", count: 1, more: false }),
    "Matches 1 ticket",
  );
  assert.equal(
    previewText({ status: "ready", count: 0, more: false }),
    "Matches 0 tickets",
  );
});

test("the preview counts while the draft is new, fetching or unread", () => {
  assert.deepEqual(previewStateFrom(null, null, false, undefined), {
    status: "counting",
  });
  assert.deepEqual(previewStateFrom(draft, null, false, undefined), {
    status: "counting",
  });
  assert.deepEqual(
    previewStateFrom(draft, draft, true, { count: 1, more: false }),
    {
      status: "counting",
    },
  );
  assert.deepEqual(previewStateFrom(draft, draft, false, undefined), {
    status: "counting",
  });
});

test("a settled read is ready, and a null read is unavailable", () => {
  assert.deepEqual(
    previewStateFrom(draft, draft, false, { count: 3, more: false }),
    { status: "ready", count: 3, more: false },
  );
  assert.deepEqual(previewStateFrom(draft, draft, false, null), {
    status: "unavailable",
  });
});

test("the multi-select copy keeps the legacy strings", () => {
  assert.equal(MULTI_COPY.assignees.placeholder, "Any assignee");
  assert.equal(MULTI_COPY.projects.emptyText, "No projects found");
  assert.equal(MULTI_COPY.teams.label, "Teams");
});

test("the selection label shows the count or the placeholder", () => {
  assert.equal(selectionLabel(0, "Any team"), "Any team");
  assert.equal(selectionLabel(2, "Any team"), "2 selected");
});

test("toggleId adds a missing id and removes a present one", () => {
  assert.deepEqual(toggleId(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleId(["a", "b"], "a"), ["b"]);
});

test("filterOptions matches the label ignoring case", () => {
  const options = [
    { id: "1", label: "Ada Lovelace" },
    { id: "2", label: "Grace Hopper" },
  ];
  assert.deepEqual(filterOptions(options, "ADA"), [options[0]]);
  assert.deepEqual(filterOptions(options, ""), options);
});
