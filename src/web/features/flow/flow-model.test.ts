import test from "node:test";
import assert from "node:assert/strict";
import type { Card, Item } from "../../../shared/types.js";
import {
  diffArrivals,
  flowRows,
  latestRow,
  pollerTone,
  ridePath,
  sourceNodes,
  syncLine,
  trayCounts,
  trayOf,
  type FlowRow,
} from "./flow-model.js";

function item(
  id: string,
  source: string,
  priority: number,
  state: Item["state"] = "unread",
): Item {
  return {
    id,
    source,
    type: "issue",
    title: id,
    snippet: "",
    createdAt: "2026-09-25T00:00:00.000Z",
    priority,
    state,
    meta: {},
  };
}

function card(
  id: string,
  column: Card["column"],
  priority: number,
  source?: string,
): Card {
  return {
    id,
    issueId: id,
    identifier: id,
    title: id,
    description: null,
    priority,
    column,
    updatedAt: "2026-09-25T00:00:00.000Z",
    source,
  };
}

const seedItems = [
  item("fake-snapshot:1", "linear", 95),
  item("fake-snapshot:2", "linear", 72),
  item("fake-snapshot:3", "github", 45),
  item("fake-snapshot:4", "slack", 10),
];
const seedCards = [
  card("LOCAL-941", "inbox", 1, "local"),
  card("LOCAL-931", "in_progress", 2, "local"),
  card("LOCAL-932", "needs_input", 3, "local"),
];

void test("the seeded rows fill the trays as urgent 2, today 1, this week 1, fyi 1", () => {
  const rows = flowRows(seedItems, seedCards);
  assert.deepEqual(trayCounts(rows), { urgent: 2, today: 1, week: 1, fyi: 1 });
});

void test("every band edge lands in exactly one tray", () => {
  const expected: [number, string][] = [
    [100, "urgent"],
    [90, "urgent"],
    [89, "today"],
    [75, "today"],
    [70, "today"],
    [69, "week"],
    [50, "week"],
    [40, "week"],
    [39, "fyi"],
    [25, "fyi"],
    [0, "fyi"],
  ];
  for (const [score, tray] of expected) assert.equal(trayOf(score), tray);
});

void test("a done item and a card outside the Inbox are not rows", () => {
  const rows = flowRows(
    [item("a", "linear", 50), item("b", "linear", 50, "done")],
    [card("c", "inbox", 2), card("d", "todo", 1)],
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.score]),
    [
      ["a", 50],
      ["c", 75],
    ],
  );
});

void test("card priorities map onto the item scale", () => {
  const rows = flowRows(
    [],
    [0, 1, 2, 3, 4].map((p) => card(`c${p}`, "inbox", p)),
  );
  assert.deepEqual(
    rows.map((r) => r.score),
    [0, 100, 75, 50, 25],
  );
  assert.equal(rows[0].source, "linear");
});

void test("a source is lit only when enabled, and counts its rows", () => {
  const rows = flowRows(seedItems, seedCards);
  const off = sourceNodes([], rows);
  assert.ok(off.every((n) => !n.lit));
  const on = sourceNodes(["linear"], rows);
  assert.deepEqual(
    on.map((n) => [n.id, n.lit, n.count]),
    [
      ["github", false, 1],
      ["linear", true, 2],
      ["slack", false, 1],
      ["sentry", false, 0],
      ["meeting", false, 0],
      ["calendar", false, 0],
    ],
  );
});

void test("the first frame yields no arrivals, later frames report each new id once", () => {
  const r = (id: string): FlowRow => ({
    id,
    source: "linear",
    score: 50,
    createdAt: "2026-09-25T00:00:00.000Z",
  });
  assert.deepEqual(diffArrivals(null, [r("a"), r("b")]), []);
  const prev = new Set(["a", "b"]);
  assert.deepEqual(
    diffArrivals(prev, [r("a"), r("b"), r("c")]).map((x) => x.id),
    ["c"],
  );
  assert.deepEqual(
    diffArrivals(new Set(["a", "b", "c"]), [r("a"), r("c")]),
    [],
  );
});

void test("the poller tone is ok, stale past two intervals, down when unreachable", () => {
  const now = Date.parse("2026-09-25T00:10:00.000Z");
  const synced = "2026-09-25T00:09:00.000Z";
  assert.equal(pollerTone(synced, 60_000, false, now), "ok");
  assert.equal(pollerTone(synced, 30_000, false, now), "ok");
  assert.equal(pollerTone(synced, 29_999, false, now), "stale");
  assert.equal(pollerTone(synced, 60_000, true, now), "down");
  assert.equal(pollerTone(null, 60_000, false, now), "ok");
  assert.equal(pollerTone(synced, undefined, false, now), "ok");
});

void test("a ride starts at its source node and ends in its tray", () => {
  const d = ridePath({
    id: "fake-snapshot:1",
    source: "linear",
    score: 95,
    createdAt: "2026-09-25T00:00:00.000Z",
  });
  assert.equal(d.match(/M/g)?.length, 1);
  assert.equal(d.match(/C/g)?.length, 3);
  assert.ok(d.startsWith("M 240 148 C"));
  assert.ok(d.endsWith(", 820 80"));
});

void test("a row whose source has no node starts at the poller", () => {
  const d = ridePath({
    id: "LOCAL-1",
    source: "local",
    score: 0,
    createdAt: "2026-09-25T00:00:00.000Z",
  });
  assert.equal(d.match(/C/g)?.length, 2);
  assert.ok(d.startsWith("M 560 280 C"));
  assert.ok(d.endsWith(", 820 470"));
});

void test("the latest row is the newest by createdAt, none for an empty list", () => {
  const r = (id: string, createdAt: string): FlowRow => ({
    id,
    source: "linear",
    score: 50,
    createdAt,
  });
  assert.equal(latestRow([]), null);
  assert.equal(
    latestRow([r("bad", "not a date"), r("ok", "2026-09-24T00:00:00.000Z")])
      ?.id,
    "ok",
  );
  assert.equal(
    latestRow([
      r("old", "2026-09-24T00:00:00.000Z"),
      r("new", "2026-09-25T00:00:00.000Z"),
      r("mid", "2026-09-24T12:00:00.000Z"),
    ])?.id,
    "new",
  );
});

void test("snoozed and read items are rows, only done items are not", () => {
  const rows = flowRows(
    [
      item("s", "linear", 50, "snoozed"),
      item("r", "linear", 50, "read"),
      item("d", "linear", 50, "done"),
    ],
    [],
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["s", "r"],
  );
});

void test("the sync line reads the age, or never synced without a parseable time", () => {
  const now = Date.parse("2026-09-25T00:10:00.000Z");
  assert.equal(syncLine("2026-09-25T00:07:00.000Z", now), "Last sync 3m ago");
  assert.equal(syncLine(null, now), "Never synced");
  assert.equal(syncLine("not a date", now), "Never synced");
});

void test("an unparseable sync time is never stale", () => {
  assert.equal(pollerTone("not a date", 1000, false, Date.now()), "ok");
});

void test("no latest row when no date parses", () => {
  assert.equal(
    latestRow([
      { id: "a", source: "linear", score: 1, createdAt: "x" },
      { id: "b", source: "linear", score: 1, createdAt: "y" },
    ]),
    null,
  );
});
