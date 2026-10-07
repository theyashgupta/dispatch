import { DEFAULT_BOARD_KEY } from "./board-key.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Item, PrInfo } from "./types.js";
import { buildPrRows, groupPrRows, parsePrKey, parsePrUrl } from "./pr-rows.js";

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
    rows.map((r) => [r.key, r.category, r.unread, r.draft, r.author]),
    [
      ["github:acme/web#7", "mention", false, true, "mchen"],
      ["github:acme/api#12", "review", true, false, "octo"],
    ],
  );
});

test("a session PR matching an item merges into that row with Yours", () => {
  const rows = buildPrRows(
    [item(12)],
    [card("LOCAL-9", [pr("https://github.com/acme/api/pull/12")])],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.yours, true);
  assert.equal(rows[0]?.cardId, "LOCAL-9");
  assert.equal(rows[0]?.category, "review");
  assert.equal(rows[0]?.itemId, "github:acme/api#12");
});

test("an open session PR with no item becomes its own Yours row", () => {
  const [row] = buildPrRows(
    [],
    [card("LOCAL-9", [pr("https://github.com/acme/api/pull/30")])],
  );
  assert.deepEqual(
    [
      row?.key,
      row?.category,
      row?.yours,
      row?.cardId,
      row?.itemId,
      row?.number,
    ],
    ["github:acme/api#30", "yours", true, "LOCAL-9", undefined, 30],
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

test("grouping by repo, author and type keeps row order inside a group", () => {
  const rows = buildPrRows(
    [
      item(12),
      item(7, "acme/web", {}, { author: "mchen", category: "mention" }),
      item(15, "acme/api", {}, { category: "assigned" }),
    ],
    [
      card(
        "LOCAL-9",
        [pr("https://github.com/acme/api/pull/30")],
        "2026-09-25T09:30:00Z",
      ),
    ],
  );
  assert.deepEqual(
    groupPrRows(rows, "repo").map((g) => [
      g.label,
      g.rows.map((r) => r.number),
    ]),
    [
      ["acme/api", [30, 15, 12]],
      ["acme/web", [7]],
    ],
  );
  assert.deepEqual(
    groupPrRows(rows, "author").map((g) => g.label),
    ["You", "mchen", "octo"],
  );
  assert.deepEqual(
    groupPrRows(rows, "type").map((g) => g.label),
    ["Yours", "Mentioned", "Assigned", "Review requested"],
  );
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
