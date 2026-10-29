import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrRow } from "../../../../shared/pr-rows.js";
import {
  groupPrRows,
  initialsOf,
  parsePrGroupBy,
  PR_GROUP_BY_KEY,
  PR_GROUP_BY_LABELS,
  prChips,
} from "./pr-list-rows.js";

function row(over: Partial<PrRow> = {}): PrRow {
  const repo = over.repo ?? "acme/api";
  return {
    key: `github:${repo}#${over.number ?? 1}`,
    owner: "acme",
    name: "api",
    repo,
    number: 1,
    title: "Title",
    author: "octo",
    authorAvatar: "",
    state: "Open",
    checks: "",
    mergeable: "unknown",
    createdAt: "2026-09-25T09:00:00Z",
    reviewRequestedFromMe: false,
    time: "2026-09-25T09:00:00Z",
    unread: false,
    url: "https://github.com/acme/api/pull/1",
    ...over,
  };
}

test("the checks chip has the PRD label and tone for every value", () => {
  const chip = (checks: PrRow["checks"]) => prChips(row({ checks }))[0];
  assert.deepEqual(chip("pass"), { label: "Checks pass", tone: "success" });
  assert.deepEqual(chip("fail"), { label: "Checks fail", tone: "danger" });
  assert.deepEqual(chip("pending"), {
    label: "Checks pending",
    tone: "warning",
  });
  assert.deepEqual(chip(""), { label: "No checks", tone: "neutral" });
});

test("the review chip has the PRD label and tone for every state", () => {
  const chip = (state: PrRow["state"]) => prChips(row({ state }))[1];
  assert.deepEqual(chip("Review requested from me"), {
    label: "Review requested",
    tone: "accent",
  });
  assert.deepEqual(chip("Changes requested"), {
    label: "Changes requested",
    tone: "warning",
  });
  assert.deepEqual(chip("Approved"), { label: "Approved", tone: "success" });
  assert.deepEqual(chip("Draft"), { label: "Draft", tone: "neutral" });
  assert.deepEqual(chip("Open"), {
    label: "Awaiting review",
    tone: "neutral",
  });
});

test("the mergeable chip has the PRD label and tone for every value", () => {
  const chip = (mergeable: PrRow["mergeable"]) =>
    prChips(row({ mergeable }))[2];
  assert.deepEqual(chip("mergeable"), { label: "Mergeable", tone: "success" });
  assert.deepEqual(chip("conflicting"), { label: "Conflicts", tone: "danger" });
  assert.deepEqual(chip("unknown"), {
    label: "Merge unknown",
    tone: "neutral",
  });
});

test("the chips come in checks, review, mergeable order", () => {
  assert.deepEqual(
    prChips(row({ checks: "pass", state: "Approved", mergeable: "mergeable" })),
    [
      { label: "Checks pass", tone: "success" },
      { label: "Approved", tone: "success" },
      { label: "Mergeable", tone: "success" },
    ],
  );
});

test("repository groups sort by name and keep the input order inside", () => {
  const groups = groupPrRows(
    [
      row({ number: 1, repo: "acme/web" }),
      row({ number: 2, repo: "acme/api" }),
      row({ number: 3, repo: "acme/web" }),
    ],
    "repo",
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.label, g.rows.map((r) => r.number)]),
    [
      ["acme/api", "acme/api", [2]],
      ["acme/web", "acme/web", [1, 3]],
    ],
  );
});

test("state groups follow the PRD order and drop empty groups", () => {
  const all = groupPrRows(
    [
      row({ number: 1, state: "Draft" }),
      row({ number: 2, state: "Approved" }),
      row({ number: 3, state: "Open" }),
      row({ number: 4, state: "Changes requested" }),
      row({ number: 5, state: "Review requested from me" }),
    ],
    "state",
  );
  assert.deepEqual(
    all.map((g) => g.label),
    [
      "Review requested",
      "Changes requested",
      "Awaiting review",
      "Approved",
      "Draft",
    ],
  );
  const some = groupPrRows(
    [row({ number: 1, state: "Draft" }), row({ number: 2, state: "Open" })],
    "state",
  );
  assert.deepEqual(
    some.map((g) => g.label),
    ["Awaiting review", "Draft"],
  );
});

test("none returns one group of every row keyed all", () => {
  const rows = [row({ number: 1 }), row({ number: 2, repo: "acme/web" })];
  const groups = groupPrRows(rows, "none");
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.key, "all");
  assert.deepEqual(groups[0]?.rows, rows);
});

test("no rows give no group for repo and state", () => {
  assert.deepEqual(groupPrRows([], "repo"), []);
  assert.deepEqual(groupPrRows([], "state"), []);
});

test("the group-by parser keeps the three values and falls back to repo", () => {
  assert.equal(parsePrGroupBy("repo"), "repo");
  assert.equal(parsePrGroupBy("state"), "state");
  assert.equal(parsePrGroupBy("none"), "none");
  assert.equal(parsePrGroupBy("bogus"), "repo");
  assert.equal(parsePrGroupBy(null), "repo");
  assert.equal(PR_GROUP_BY_KEY, "dsp.prs.groupBy");
  assert.deepEqual(Object.values(PR_GROUP_BY_LABELS), [
    "Group by repository",
    "Group by state",
    "No grouping",
  ]);
});

test("initials are the first two characters uppercased, or a question mark", () => {
  assert.equal(initialsOf("mchen"), "MC");
  assert.equal(initialsOf("a"), "A");
  assert.equal(initialsOf(""), "?");
});
