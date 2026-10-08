import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Column } from "../../../../shared/types.js";
import {
  buildWorkspaceGroups,
  mostRecentCardId,
  ORCA_SECTIONS,
} from "./orca-selectors.js";

function card(
  id: string,
  column: Column,
  extra: { folder?: string; title?: string; groupId?: string } = {},
): Card {
  return {
    id,
    identifier: id,
    title: extra.title ?? `Title ${id}`,
    column,
    groupId: extra.groupId,
    workspace: extra.folder ? { folder: extra.folder, repos: [] } : undefined,
  } as unknown as Card;
}

const cards = [
  card("P-10", "todo", { folder: "/w/beta", title: "Zed" }),
  card("P-2", "todo", { folder: "/w/alpha", title: "Alpha" }),
  card("P-3", "in_progress", { folder: "/w/alpha", title: "Mid" }),
  card("P-4", "inbox"),
];

function ids(list: Card[]): string[] {
  return list.map((c) => c.id);
}

test("group by status yields all 8 sections in order, empty ones included", () => {
  const groups = buildWorkspaceGroups(cards, "status", "none", "id");
  assert.equal(ORCA_SECTIONS.length, 8);
  assert.deepEqual(
    groups.map((g) => g.key),
    [...ORCA_SECTIONS],
  );
  assert.deepEqual(
    groups.map((g) => g.count),
    [1, 2, 1, 0, 0, 0, 0, 0],
  );
  assert.equal(groups[0]?.label, "INBOX");
  assert.equal(groups[1]?.accent, "var(--col-todo)");
  assert.deepEqual(groups[4]?.subgroups[0]?.cards, []);
});

test("group by workspace lists named folders by label then no workspace last", () => {
  const groups = buildWorkspaceGroups(cards, "workspace", "none", "id");
  assert.deepEqual(
    groups.map((g) => [g.key, g.label, g.count]),
    [
      ["/w/alpha", "alpha", 2],
      ["/w/beta", "beta", 1],
      ["", "No workspace", 1],
    ],
  );
  assert.equal(groups[0]?.accent, undefined);
});

test("subgroup none keeps one unlabelled bucket per group", () => {
  const [inbox] = buildWorkspaceGroups(cards, "status", "none", "id");
  assert.equal(inbox?.subgrouped, false);
  assert.deepEqual(
    inbox?.subgroups.map((s) => [s.key, s.label]),
    [["", ""]],
  );
});

test("subgroup by workspace nests only the buckets that hold cards", () => {
  const todo = buildWorkspaceGroups(cards, "status", "workspace", "id").find(
    (g) => g.key === "todo",
  );
  assert.equal(todo?.subgrouped, true);
  assert.deepEqual(
    todo?.subgroups.map((s) => [s.key, ids(s.cards)]),
    [
      ["/w/alpha", ["P-2"]],
      ["/w/beta", ["P-10"]],
    ],
  );
});

test("subgroup by status nests the columns in board order under a workspace group", () => {
  const alpha = buildWorkspaceGroups(cards, "workspace", "status", "id")[0];
  assert.deepEqual(
    alpha?.subgroups.map((s) => [s.key, s.label, s.accent]),
    [
      ["todo", "TO DO", "var(--col-todo)"],
      ["in_progress", "IN PROGRESS", "var(--col-in-progress)"],
    ],
  );
});

test("a subgroup equal to the group collapses to none", () => {
  const groups = buildWorkspaceGroups(cards, "status", "status", "id");
  assert.equal(groups[1]?.subgrouped, false);
  assert.equal(groups[1]?.subgroups.length, 1);
});

test("sort by id orders identifiers numerically", () => {
  const [, todo] = buildWorkspaceGroups(cards, "status", "none", "id");
  assert.deepEqual(ids(todo?.subgroups[0]?.cards ?? []), ["P-2", "P-10"]);
});

test("sort by title orders alphabetically", () => {
  const [, todo] = buildWorkspaceGroups(cards, "status", "none", "title");
  assert.deepEqual(ids(todo?.subgroups[0]?.cards ?? []), ["P-2", "P-10"]);
  const reversed = [
    card("P-1", "todo", { title: "Zed" }),
    card("P-9", "todo", { title: "Alpha" }),
  ];
  const byId = buildWorkspaceGroups(reversed, "status", "none", "id")[1];
  const byTitle = buildWorkspaceGroups(reversed, "status", "none", "title")[1];
  assert.deepEqual(ids(byId?.subgroups[0]?.cards ?? []), ["P-1", "P-9"]);
  assert.deepEqual(ids(byTitle?.subgroups[0]?.cards ?? []), ["P-9", "P-1"]);
});

test("group members are excluded from every group", () => {
  const withMember = [...cards, card("P-5", "todo", { groupId: "g1" })];
  const groups = buildWorkspaceGroups(withMember, "status", "none", "id");
  assert.equal(groups[1]?.count, 2);
});

test("mostRecentCardId picks the newest stamp for a card on the board", () => {
  const lastOpened = {
    "P-2": "2026-01-01T00:00:00Z",
    "P-3": "2026-03-01T00:00:00Z",
    "P-10": "2026-02-01T00:00:00Z",
  };
  assert.equal(mostRecentCardId(lastOpened, cards), "P-3");
});

test("mostRecentCardId skips the feed sentinel and cards that left the board", () => {
  const lastOpened = {
    __feed__: "2026-09-01T00:00:00Z",
    gone: "2026-08-01T00:00:00Z",
    "P-2": "2026-01-01T00:00:00Z",
  };
  assert.equal(mostRecentCardId(lastOpened, cards), "P-2");
  assert.equal(mostRecentCardId({}, cards), null);
  assert.equal(mostRecentCardId({ __feed__: "x" }, cards), null);
});
