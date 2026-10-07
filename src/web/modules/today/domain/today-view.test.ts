import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../../../shared/types.js";
import { clampCount, type TodayEntry } from "./p0.js";
import {
  agendaItems,
  agendaTime,
  buildTodayModel,
  entryTarget,
  greeting,
  joinLink,
  longDate,
  paginate,
  parseRange,
  visibleAgenda,
} from "./today-view.js";

const at = (h: number, m: number) => new Date(2026, 8, 25, h, m, 0);

test("the greeting switches at 12:00 and 18:00 local", () => {
  assert.equal(greeting(at(11, 59)), "Good morning");
  assert.equal(greeting(at(12, 0)), "Good afternoon");
  assert.equal(greeting(at(17, 59)), "Good afternoon");
  assert.equal(greeting(at(18, 0)), "Good evening");
});

test("the long date reads weekday, day and month", () => {
  assert.equal(longDate(at(10, 0)), "Friday 25 September");
});

test("paginate slices ten rows per page and clamps the page number", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);
  assert.deepEqual(paginate(rows, 1, 10), {
    rows: rows.slice(0, 10),
    page: 1,
    pages: 3,
  });
  assert.deepEqual(paginate(rows, 3, 10), {
    rows: rows.slice(20),
    page: 3,
    pages: 3,
  });
  assert.equal(paginate(rows, 9, 10).page, 3);
  assert.equal(paginate(rows, 0, 10).page, 1);
  assert.deepEqual(paginate([], 1, 10), { rows: [], page: 1, pages: 1 });
});

function event(id: string, start: string, over: Partial<Item> = {}): Item {
  return {
    id,
    source: "calendar",
    type: "event",
    title: id,
    snippet: "",
    createdAt: start,
    priority: 50,
    state: "unread",
    meta: { start, end: start, joinUrl: "https://meet.example/x" },
    ...over,
  };
}

test("agendaItems keeps calendar events starting today, earliest first", () => {
  const items = [
    event("late", at(15, 0).toISOString()),
    event("early", at(9, 30).toISOString()),
    event("tomorrow", new Date(2026, 8, 26, 9, 0).toISOString()),
    event("not-calendar", at(11, 0).toISOString(), { source: "github" }),
    event("not-event", at(11, 0).toISOString(), { type: "task" }),
    event("bad-start", "soon"),
  ];
  assert.deepEqual(
    agendaItems(items, at(10, 0)).map((i) => i.id),
    ["early", "late"],
  );
  assert.deepEqual(agendaItems([], at(10, 0)), []);
});

test("the agenda never renders without the calendar source", () => {
  const items = [event("standup", at(11, 0).toISOString())];
  assert.deepEqual(visibleAgenda(undefined, items, at(10, 0)), []);
  assert.deepEqual(visibleAgenda(["github", "sentry"], items, at(10, 0)), []);
  assert.deepEqual(
    visibleAgenda(["calendar"], items, at(10, 0)).map((i) => i.id),
    ["standup"],
  );
});

function entry(key: string, source: string): TodayEntry {
  return {
    key,
    kind: "item",
    tier: 5,
    source,
    title: key,
    time: "2026-09-25T09:00:00Z",
    priority: 50,
    chips: [],
    actionLabel: "Open",
  };
}

const POOL = [
  entry("g1", "github"),
  entry("s1", "sentry"),
  entry("g2", "github"),
  entry("l1", "linear"),
  entry("g3", "github"),
];

test("the chip filter never changes the P0 picks", () => {
  const all = buildTodayModel(POOL, 3, null, 1);
  const filtered = buildTodayModel(POOL, 3, "sentry", 1);
  assert.deepEqual(
    filtered.picks.map((e) => e.key),
    all.picks.map((e) => e.key),
  );
  assert.deepEqual(
    filtered.list.rows.map((e) => e.key),
    ["s1"],
  );
  assert.equal(filtered.filter, "sentry");
});

test("a filter whose source left the pool reads as no filter", () => {
  const view = buildTodayModel(POOL, 3, "calendar", 1);
  assert.equal(view.filter, null);
  assert.equal(view.list.rows.length, 5);
});

test("chips count each source, largest first, ties by source id", () => {
  assert.deepEqual(buildTodayModel(POOL, 3, null, 1).chips, [
    { source: "github", count: 3 },
    { source: "linear", count: 1 },
    { source: "sentry", count: 1 },
  ]);
  assert.deepEqual(buildTodayModel([], 3, null, 1).chips, []);
});

test("the list pages by ten and the picks clamp to 3 to 5", () => {
  const many = Array.from({ length: 23 }, (_, i) => entry(`k${i}`, "github"));
  const view = buildTodayModel(many, 9, null, 3);
  assert.equal(view.picks.length, 5);
  assert.deepEqual(
    [view.list.page, view.list.pages, view.list.rows.length],
    [3, 3, 3],
  );
});

test("agendaTime formats a local 24-hour HH:MM", () => {
  assert.equal(agendaTime(at(9, 5).toISOString()), "09:05");
  assert.equal(agendaTime(at(17, 30).toISOString()), "17:30");
});

test("joinLink keeps only http and https links", () => {
  const withUrl = (url: string) =>
    event("e", at(11, 0).toISOString(), {
      meta: { start: at(11, 0).toISOString(), joinUrl: url },
    });
  assert.equal(
    joinLink(withUrl("https://meet.example/x")),
    "https://meet.example/x",
  );
  assert.equal(
    joinLink(withUrl("http://meet.example/x")),
    "http://meet.example/x",
  );
  for (const bad of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,x",
    "/settings",
    "//evil.example",
    "",
  ]) {
    assert.equal(joinLink(withUrl(bad)), null, bad);
  }
  assert.equal(
    joinLink(
      event("none", at(11, 0).toISOString(), {
        meta: { start: at(11, 0).toISOString() },
      }),
    ),
    null,
  );
});

test("entryTarget sends cards to the panel and items to their source page", () => {
  const cardEntry = {
    ...entry("QA-1", "linear"),
    kind: "card" as const,
    card: { id: "QA-1" } as TodayEntry["card"],
  };
  assert.deepEqual(entryTarget(cardEntry), { kind: "card", cardId: "QA-1" });
  const withItem = (source: string, id: string) => ({
    ...entry(id, source),
    item: { id, source } as TodayEntry["item"],
  });
  assert.deepEqual(entryTarget(withItem("github", "github:acme/api#12")), {
    kind: "page",
    page: "pull-requests",
    id: "github:acme/api#12",
  });
  assert.deepEqual(entryTarget(withItem("sentry", "sentry:107")), {
    kind: "page",
    page: "errors",
    id: "sentry:107",
  });
  assert.deepEqual(entryTarget(withItem("slack", "slack:1")), {
    kind: "page",
    page: "inbox",
  });
});

test("stored window and count values fall back safely", () => {
  assert.equal(parseRange("week"), "week");
  for (const raw of [null, "", "today", "Week", "month", "1"])
    assert.equal(parseRange(raw), "today");
  for (const raw of [null, "", "abc", "0", "-7", "Infinity", "1e308"])
    assert.equal(
      clampCount(Number(raw)),
      raw === "Infinity" || raw === "1e308" ? 5 : 3,
    );
  assert.equal(clampCount(Number("4")), 4);
});
