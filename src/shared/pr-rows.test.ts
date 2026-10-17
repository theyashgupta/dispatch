import { DEFAULT_BOARD_KEY } from "./board-key.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Item, PrInfo } from "./types.js";
import {
  buildPrRows,
  heldPrItems,
  filterPrRows,
  NO_PR_FILTERS,
  parsePrKey,
  parsePrUrl,
  prFilterOptions,
  prStateText,
  prUrl,
  reviewBranch,
} from "./pr-rows.js";

function item(
  number: number,
  repo = "acme/api",
  extra: Partial<Item> = {},
  meta: Record<string, string> = {},
): Item {
  return {
    id: `github:${repo}#${number}`,
    source: "github",
    type: "pr_review",
    title: `PR ${number}`,
    snippet: "",
    url: `https://github.com/${repo}/pull/${number}`,
    createdAt: `2026-09-25T0${number % 10}:00:00Z`,
    priority: 75,
    state: "unread",
    meta: {
      repo,
      number: String(number),
      author: "octo",
      draft: "false",
      category: "review",
      ...meta,
    },
    ...extra,
  };
}

function pr(url: string, state: PrInfo["state"] = "open"): PrInfo {
  return {
    number: 1,
    url,
    title: "Session PR",
    state,
    isDraft: false,
    ci: null,
    repo: "api",
  };
}

function card(
  id: string,
  prs: PrInfo[],
  updatedAt = "2026-09-25T05:30:00Z",
): Card {
  return {
    id,
    boardKey: DEFAULT_BOARD_KEY,
    issueId: id,
    identifier: id,
    title: id,
    description: null,
    priority: 0,
    column: "in_progress",
    updatedAt,
    prs,
  };
}

test("each non-done GitHub item becomes a row with its meta", () => {
  const rows = buildPrRows(
    [
      item(12),
      item(
        7,
        "acme/web",
        { state: "read" },
        { draft: "true", category: "mention", author: "mchen" },
      ),
      item(3, "acme/api", { state: "done" }),
      { ...item(4), source: "sentry", id: "sentry:4" },
    ],
    [],
  );
  assert.deepEqual(
    rows.map((r) => [r.key, r.state, r.unread, r.author]),
    [
      ["github:acme/web#7", "Draft", false, "mchen"],
      ["github:acme/api#12", "Review requested from me", true, "octo"],
    ],
  );
});

const AVATAR = "https://avatars.githubusercontent.com/u/1?v=4";

function rowWith(meta: Record<string, string>) {
  return buildPrRows([item(1, "acme/api", {}, meta)], [])[0];
}

test("the avatar guard keeps a URL on the GitHub avatars host", () => {
  assert.equal(rowWith({ authorAvatar: AVATAR })?.authorAvatar, AVATAR);
});

test("the avatar guard empties every other URL", () => {
  for (const bad of [
    "http://avatars.githubusercontent.com/u/1",
    "https://evil.example/a.png",
    "javascript:alert(1)",
    "https://avatars.githubusercontent.com.evil.example/x",
    "",
  ]) {
    assert.equal(rowWith({ authorAvatar: bad })?.authorAvatar, "", bad);
  }
  assert.equal(rowWith({})?.authorAvatar, "");
});

test("mergeable maps the GitHub value and falls back to unknown", () => {
  assert.equal(rowWith({ mergeable: "MERGEABLE" })?.mergeable, "mergeable");
  assert.equal(rowWith({ mergeable: "CONFLICTING" })?.mergeable, "conflicting");
  assert.equal(rowWith({ mergeable: "UNKNOWN" })?.mergeable, "unknown");
  assert.equal(rowWith({})?.mergeable, "unknown");
  assert.equal(rowWith({ mergeable: "weird" })?.mergeable, "unknown");
});

test("card-derived rows have no avatar and an unknown mergeable state", () => {
  const rows = buildPrRows(
    [],
    [card("LOCAL-9", [pr("https://github.com/acme/api/pull/5")])],
  );
  assert.equal(rows[0]?.authorAvatar, "");
  assert.equal(rows[0]?.mergeable, "unknown");
});

test("a session PR matching an item merges into that row with Yours", () => {
  const rows = buildPrRows(
    [item(12)],
    [card("LOCAL-9", [pr("https://github.com/acme/api/pull/12")])],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.cardId, "LOCAL-9");
  assert.equal(rows[0]?.itemId, "github:acme/api#12");
});

test("an open session PR with no item becomes its own Yours row", () => {
  const [row] = buildPrRows(
    [],
    [card("LOCAL-9", [pr("https://github.com/acme/api/pull/30")])],
  );
  assert.deepEqual(
    [row?.key, row?.cardId, row?.itemId, row?.number],
    ["github:acme/api#30", "LOCAL-9", undefined, 30],
  );
});

test("merged and closed session PRs and unparsable URLs are left out", () => {
  const rows = buildPrRows(
    [],
    [
      card("LOCAL-1", [
        pr("https://github.com/acme/api/pull/3", "merged"),
        pr("https://github.com/acme/api/pull/4", "closed"),
        pr("https://gitlab.com/acme/api/-/merge_requests/5"),
        pr("https://github.com/acme/api/issues/6"),
      ]),
    ],
  );
  assert.deepEqual(rows, []);
});

test("rows sort newest first with the key as the tiebreak", () => {
  const rows = buildPrRows([item(1), item(9), item(21)], []);
  assert.deepEqual(
    rows.map((r) => r.number),
    [9, 1, 21],
  );
});

test("each state text shows with its precedence", () => {
  const base = {
    draft: false,
    reviewRequestedFromMe: false,
    reviewDecision: "",
  };
  assert.equal(prStateText(base), "Open");
  assert.equal(
    prStateText({ ...base, reviewDecision: "APPROVED" }),
    "Approved",
  );
  assert.equal(
    prStateText({ ...base, reviewDecision: "CHANGES_REQUESTED" }),
    "Changes requested",
  );
  assert.equal(
    prStateText({
      ...base,
      reviewRequestedFromMe: true,
      reviewDecision: "CHANGES_REQUESTED",
    }),
    "Review requested from me",
  );
  assert.equal(
    prStateText({
      draft: true,
      reviewRequestedFromMe: true,
      reviewDecision: "APPROVED",
    }),
    "Draft",
  );
});

test("a row carries its state, checks, request flag and creation time from the item meta", () => {
  const [open, mine, draft] = buildPrRows(
    [
      item(
        1,
        "acme/api",
        {},
        {
          category: "open",
          reviewDecision: "APPROVED",
          checks: "pass",
          createdAt: "2026-09-01T00:00:00Z",
        },
      ),
      item(
        2,
        "acme/api",
        {},
        { category: "open", reviewRequestedFromMe: "true", checks: "fail" },
      ),
      item(3, "acme/api", {}, { category: "open", draft: "true", checks: "?" }),
    ].sort((a, b) => a.id.localeCompare(b.id)),
    [],
  ).sort((a, b) => a.number - b.number);
  assert.deepEqual(
    [open?.state, open?.checks, open?.createdAt, open?.reviewRequestedFromMe],
    ["Approved", "pass", "2026-09-01T00:00:00Z", false],
  );
  assert.deepEqual(
    [mine?.state, mine?.checks, mine?.reviewRequestedFromMe],
    ["Review requested from me", "fail", true],
  );
  assert.deepEqual([draft?.state, draft?.checks], ["Draft", ""]);
});

test("the age falls back to the item time when the meta has no creation time", () => {
  const [row] = buildPrRows([item(4)], []);
  assert.equal(row?.createdAt, "2026-09-25T04:00:00Z");
});

test("the @me review category counts as review requested from me", () => {
  const [row] = buildPrRows([item(5)], []);
  assert.equal(row?.reviewRequestedFromMe, true);
  assert.equal(row?.state, "Review requested from me");
});

test("a done item with a card stays with the card and one without is hidden", () => {
  const rows = buildPrRows(
    [
      item(6, "acme/api", { state: "done", cardId: "LOCAL-5" }),
      item(7, "acme/api", { state: "done" }),
    ],
    [card("LOCAL-5", [])],
  );
  assert.deepEqual(
    rows.map((r) => [r.number, r.cardId, r.unread]),
    [[6, "LOCAL-5", false]],
  );
});

test("an open item that a session PR also names is one row", () => {
  const rows = buildPrRows(
    [item(8, "acme/api", {}, { category: "open" })],
    [card("LOCAL-9", [pr("https://github.com/acme/api/pull/8")])],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.cardId, "LOCAL-9");
});

const filterRows = buildPrRows(
  [
    item(1, "acme/api", {}, { author: "yash", category: "open" }),
    item(2, "acme/api", {}, { author: "mchen", category: "review" }),
    item(
      3,
      "acme/web",
      {},
      { author: "yash", category: "open", reviewRequestedFromMe: "true" },
    ),
    item(4, "acme/web", {}, { author: "mchen", category: "open" }),
  ],
  [],
);

function numbers(filters: Partial<typeof NO_PR_FILTERS>, login = "Yash") {
  return filterPrRows(filterRows, { ...NO_PR_FILTERS, ...filters }, login)
    .map((r) => r.number)
    .sort();
}

test("no filter keeps every row", () => {
  assert.deepEqual(numbers({}), [1, 2, 3, 4]);
});

test("Mine keeps the rows whose author is the login, without case", () => {
  assert.deepEqual(numbers({ mine: true }), [1, 3]);
  assert.deepEqual(
    filterPrRows(filterRows, { ...NO_PR_FILTERS, mine: true }, null),
    [],
  );
});

test("Review requested keeps the meta flag and the review category", () => {
  assert.deepEqual(numbers({ reviewRequested: true }), [2, 3]);
});

test("the author and repository filters narrow by exact value", () => {
  assert.deepEqual(numbers({ author: "mchen" }), [2, 4]);
  assert.deepEqual(numbers({ repo: "acme/web" }), [3, 4]);
});

test("filters combine with and", () => {
  assert.deepEqual(numbers({ mine: true, repo: "acme/web" }), [3]);
  assert.deepEqual(numbers({ reviewRequested: true, author: "mchen" }), [2]);
  assert.deepEqual(numbers({ mine: true, author: "mchen" }), []);
});

test("the filter options are the sorted distinct values", () => {
  assert.deepEqual(prFilterOptions(filterRows, "author"), ["mchen", "yash"]);
  assert.deepEqual(prFilterOptions(filterRows, "repo"), [
    "acme/api",
    "acme/web",
  ]);
});

test("parsePrUrl reads github.com pull URLs only", () => {
  assert.deepEqual(parsePrUrl("https://github.com/acme/api/pull/12"), {
    owner: "acme",
    name: "api",
    number: 12,
  });
  assert.equal(parsePrUrl("https://github.com/acme/api/pull/12/files"), null);
  assert.equal(parsePrUrl("http://github.com/acme/api/pull/12"), null);
});

test("parsePrUrl refuses dot segments as owner or name", () => {
  assert.equal(parsePrUrl("https://github.com/../api/pull/12"), null);
  assert.equal(parsePrUrl("https://github.com/acme/../pull/12"), null);
  assert.equal(parsePrUrl("https://github.com/./././pull/12"), null);
  assert.equal(parsePrUrl("https://github.com/./api/pull/12"), null);
});

test("parsePrKey reads a row key and refuses dot segments", () => {
  assert.deepEqual(parsePrKey("github:acme/api#7"), {
    owner: "acme",
    name: "api",
    number: 7,
  });
  assert.equal(parsePrKey("github:../api#7"), null);
  assert.equal(parsePrKey("github:acme/..#7"), null);
  assert.equal(parsePrKey("github:./.#7"), null);
  assert.equal(parsePrKey("acme/api#7"), null);
});

test("a review card whose item left the snapshot keeps a row with its card", () => {
  const reviewPr = {
    repo: "acme/api",
    number: 9,
    url: "https://github.com/acme/api/pull/9",
    head: "feature",
    base: "main",
  };
  const live = { ...card("LOCAL-9", []), title: "Fix the API", reviewPr };
  const [row] = buildPrRows([], [live]);
  assert.equal(row.key, "github:acme/api#9");
  assert.equal(row.cardId, "LOCAL-9");
  assert.equal(row.title, "Fix the API");
  assert.equal(row.state, "Open");
  const finished = { ...live, column: "done" as const };
  assert.deepEqual(buildPrRows([], [finished]), []);
  const withItem = buildPrRows(
    [item(9, "acme/api", { cardId: "LOCAL-9" })],
    [live],
  );
  assert.equal(withItem.length, 1);
});

test("a done item shows with its card while that card is not done", () => {
  const held = item(4, "acme/api", { state: "done", cardId: "LOCAL-4" });
  const live = card("LOCAL-4", []);
  assert.equal(buildPrRows([held], [live])[0]?.cardId, "LOCAL-4");
  assert.deepEqual(buildPrRows([held], [{ ...live, column: "done" }]), []);
});

test("a done item held by a card that is not in cards shows its live state", () => {
  const held = item(
    4,
    "acme/api",
    { state: "done", cardId: "GAMMA-1" },
    { reviewDecision: "APPROVED", checks: "pass" },
  );
  const [row] = buildPrRows([held], [card("LOCAL-4", [])]);
  assert.equal(row?.cardId, "GAMMA-1");
  assert.equal(row?.checks, "pass");
  assert.equal(buildPrRows([held], []).length, 1);
});

test("a done item with no cardId is hidden", () => {
  assert.deepEqual(
    buildPrRows(
      [item(4, "acme/api", { state: "done" })],
      [card("LOCAL-4", [])],
    ),
    [],
  );
});

test("heldPrItems keeps only done GitHub items that a card holds", () => {
  const held = item(1, "acme/api", { state: "done", cardId: "LOCAL-1" });
  const loose = item(2, "acme/api", { state: "done" });
  const open = item(3, "acme/api", { cardId: "LOCAL-3" });
  const slack = { ...held, id: "slack:x", source: "slack" };
  assert.deepEqual(heldPrItems([held, loose, open, slack]), [held]);
});

test("prUrl and reviewBranch build the URL and the local branch of a pull request", () => {
  assert.equal(prUrl("acme", "api", 12), "https://github.com/acme/api/pull/12");
  assert.deepEqual(parsePrUrl(prUrl("acme", "api", 12)), {
    owner: "acme",
    name: "api",
    number: 12,
  });
  assert.equal(reviewBranch(12), "review/pr-12");
});
