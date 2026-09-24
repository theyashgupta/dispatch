import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Item } from "../../../shared/types.js";
import {
  filterInboxRows,
  groupInboxRows,
  humanizeType,
  mergeInboxRows,
  priorityDotKey,
  rowSourceOptions,
  visibleUnreadIds,
} from "./inbox-rows.js";

const NOW = new Date(2026, 8, 24, 12, 0).getTime();

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function item(id: string, extra: Partial<Item> = {}): Item {
  return {
    id: `fake:${id}`,
    source: "fake",
    type: "pr_review",
    title: `Item ${id}`,
    snippet: `Snippet ${id}`,
    createdAt: ago(60_000),
    priority: 50,
    state: "unread",
    meta: {},
    ...extra,
  };
}

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    issueId: id,
    identifier: id,
    title: `Card ${id}`,
    description: null,
    priority: 3,
    column: "inbox",
    updatedAt: ago(120_000),
    ...extra,
  };
}

test("an item at 80 sorts above a priority-2 card and below a priority-1 card", () => {
  const rows = mergeInboxRows(
    [item("a", { priority: 80 })],
    [card("LIN-1", { priority: 2 }), card("LIN-2", { priority: 1 })],
    {},
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["LIN-2", "fake:a", "LIN-1"],
  );
  assert.deepEqual(
    rows.map((r) => r.priority),
    [100, 80, 75],
  );
});

test("equal priority orders by time descending and then by id", () => {
  const rows = mergeInboxRows(
    [
      item("old", { createdAt: ago(3_600_000) }),
      item("b", { createdAt: ago(1_000) }),
      item("a", { createdAt: ago(1_000) }),
    ],
    [card("LIN-1", { priority: 3, updatedAt: ago(1_000) })],
    {},
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["fake:a", "fake:b", "LIN-1", "fake:old"],
  );
});

test("a card is unread until lastOpened has it; an item is unread only in state unread", () => {
  const rows = mergeInboxRows(
    [item("r", { state: "read" }), item("u")],
    [card("LIN-1"), card("LIN-2")],
    { "LIN-2": "2026-09-24T00:00:00.000Z" },
  );
  const unread = Object.fromEntries(rows.map((r) => [r.id, r.unread]));
  assert.deepEqual(unread, {
    "LIN-1": true,
    "LIN-2": false,
    "fake:r": false,
    "fake:u": true,
  });
});

test("a card row carries the mapped priority, project, url and Ticket type; an item row humanizes its type", () => {
  const [c, i] = mergeInboxRows(
    [item("a", { url: "https://x/pr/1", priority: 10 })],
    [
      card("LIN-1", {
        priority: 4,
        url: "https://linear/LIN-1",
        project: { id: "p", name: "Web" },
        source: "linear",
      }),
    ],
    {},
  );
  assert.equal(c?.priority, 25);
  assert.equal(c?.project, "Web");
  assert.equal(c?.url, "https://linear/LIN-1");
  assert.equal(c?.typeLabel, "Ticket");
  assert.equal(c?.source, "linear");
  assert.equal(i?.typeLabel, "PR review");
  assert.equal(humanizeType("ci_failure"), "CI failure");
  assert.equal(humanizeType(""), "");
});

const base = {
  query: "",
  sources: [] as string[],
  range: "all" as const,
  unreadOnly: false,
  now: NOW,
};

function rows() {
  return mergeInboxRows(
    [
      item("today", { createdAt: ago(60 * 60_000) }),
      item("twodays", { createdAt: ago(2 * 86_400_000), state: "read" }),
      item("fivedays", {
        createdAt: ago(5 * 86_400_000),
        source: "other",
        title: "Deploy failed",
      }),
      item("old", { createdAt: ago(10 * 86_400_000) }),
    ],
    [card("LIN-9", { title: "Login bug", updatedAt: ago(60_000) })],
    {},
  );
}

test("query matches the title and the card identifier", () => {
  assert.deepEqual(
    filterInboxRows(rows(), { ...base, query: "lin-9" }).map((r) => r.id),
    ["LIN-9"],
  );
  assert.deepEqual(
    filterInboxRows(rows(), { ...base, query: "DEPLOY" }).map((r) => r.id),
    ["fake:fivedays"],
  );
});

test("a row outside the selected sources never survives the filter", () => {
  const ids = filterInboxRows(rows(), { ...base, sources: ["other"] }).map(
    (r) => r.id,
  );
  assert.deepEqual(ids, ["fake:fivedays"]);
});

test("today, 3 days and week boundaries hold against a fixed now", () => {
  const by = (range: "today" | "3d" | "week") =>
    filterInboxRows(rows(), { ...base, range })
      .map((r) => r.id)
      .sort();
  assert.deepEqual(by("today"), ["LIN-9", "fake:today"]);
  assert.deepEqual(by("3d"), ["LIN-9", "fake:today", "fake:twodays"]);
  assert.deepEqual(by("week"), [
    "LIN-9",
    "fake:fivedays",
    "fake:today",
    "fake:twodays",
  ]);
  assert.equal(
    filterInboxRows(rows(), { ...base, range: "week" }).some(
      (r) => r.id === "fake:old",
    ),
    false,
  );
});

test("unread only drops read rows and keeps unopened cards", () => {
  const ids = filterInboxRows(rows(), { ...base, unreadOnly: true }).map(
    (r) => r.id,
  );
  assert.equal(ids.includes("fake:twodays"), false);
  assert.ok(ids.includes("LIN-9"));
});

test("group by source and by type keep the inner order and label unknown types as Other", () => {
  const all = mergeInboxRows(
    [
      item("a", { priority: 90 }),
      item("b", { priority: 70, source: "other", type: "" }),
      item("c", { priority: 60 }),
    ],
    [card("LIN-1", { priority: 2 })],
    {},
  );
  const bySource = groupInboxRows(all, "source");
  assert.deepEqual(
    bySource.map((g) => [g.label, g.rows.map((r) => r.id)]),
    [
      ["Fake", ["fake:a", "fake:c"]],
      ["Linear", ["LIN-1"]],
      ["Other", ["fake:b"]],
    ],
  );
  const byType = groupInboxRows(all, "type");
  assert.deepEqual(
    byType.map((g) => [g.label, g.rows.length]),
    [
      ["PR review", 2],
      ["Ticket", 1],
      ["Other", 1],
    ],
  );
  assert.equal(
    byType.reduce((n, g) => n + g.rows.length, 0),
    all.length,
  );
  assert.deepEqual(groupInboxRows(all, "none")[0]?.rows, all);
});

test("visibleUnreadIds returns unread item ids only", () => {
  const all = mergeInboxRows(
    [item("u"), item("r", { state: "read" })],
    [card("LIN-1")],
    {},
  );
  assert.deepEqual(visibleUnreadIds(all), ["fake:u"]);
});

test("priorityDotKey buckets the merged scale and rowSourceOptions lists sources once, sorted", () => {
  assert.deepEqual([100, 80, 75, 60, 50, 30, 25, 10, 0].map(priorityDotKey), [
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    undefined,
    undefined,
  ]);
  const all = mergeInboxRows(
    [item("a"), item("b", { source: "other" })],
    [card("LIN-1")],
    {},
  );
  assert.deepEqual(rowSourceOptions(all), [
    { id: "fake", label: "Fake" },
    { id: "linear", label: "Linear" },
    { id: "other", label: "Other" },
  ]);
});

test("a row with an unparseable time survives the all range and sorts last among equals", () => {
  const all = mergeInboxRows(
    [item("bad", { createdAt: "not a date" }), item("ok")],
    [],
    {},
  );
  assert.deepEqual(
    all.map((r) => r.id),
    ["fake:ok", "fake:bad"],
  );
  assert.equal(filterInboxRows(all, base).length, 2);
  assert.equal(filterInboxRows(all, { ...base, range: "week" }).length, 1);
  const mixed = mergeInboxRows(
    [
      item("z", { createdAt: "2026-09-24T10:00:00.000Z" }),
      item("plus", { createdAt: "2026-09-24T12:30:00.000+02:00" }),
    ],
    [],
    {},
  );
  assert.deepEqual(
    mixed.map((r) => r.id),
    ["fake:plus", "fake:z"],
  );
});
