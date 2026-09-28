import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Column, Item } from "../../shared/types.js";
import { feedItems } from "./feed-items.js";
import { clampCount, rankToday, topPicks } from "./p0.js";

const NOW = new Date(2026, 8, 25, 10, 0, 0).getTime();
const TODAY = new Date(2026, 8, 25, 9, 0, 0).toISOString();
const THREE_DAYS_AGO = new Date(2026, 8, 22, 10, 0, 0).toISOString();
const TEN_DAYS_AGO = new Date(2026, 8, 15, 10, 0, 0).toISOString();

function card(
  id: string,
  column: Column,
  priority: number,
  updatedAt: string,
): Card {
  return {
    id,
    issueId: id,
    identifier: id,
    title: `Card ${id}`,
    description: null,
    priority,
    column,
    updatedAt,
  };
}

function item(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    source: "github",
    type: "pr_assigned",
    title: `Item ${id}`,
    snippet: "",
    createdAt: TODAY,
    priority: 50,
    state: "unread",
    meta: { repo: "acme/api", number: "12", author: "mchen" },
    ...over,
  };
}

const keys = (entries: { key: string }[]) => entries.map((e) => e.key);

test("a needs_input card from 3 days ago ranks before an urgent card updated today (U3-05)", () => {
  const cards = [
    card("URG", "todo", 1, TODAY),
    card("NI", "needs_input", 3, THREE_DAYS_AGO),
  ];
  assert.deepEqual(keys(topPicks(rankToday(cards, [], "today", NOW), 3)), [
    "NI",
    "URG",
  ]);
});

test("an urgent card from 3 days ago is outside today and inside this week (U3-05)", () => {
  const cards = [card("OLD", "todo", 1, THREE_DAYS_AGO)];
  assert.deepEqual(keys(rankToday(cards, [], "today", NOW)), []);
  assert.deepEqual(keys(rankToday(cards, [], "week", NOW)), ["OLD"]);
});

test("the week window drops entries older than 7 days", () => {
  const cards = [card("ANCIENT", "todo", 1, TEN_DAYS_AGO)];
  assert.deepEqual(keys(rankToday(cards, [], "week", NOW)), []);
});

test("counts 3, 5, 9 and 1 give 3, 5, 5 and 3 picks from 7 entries (U3-05)", () => {
  const items = Array.from({ length: 7 }, (_, i) => item(`i${i}`));
  assert.equal(topPicks(rankToday([], items, "today", NOW), 3).length, 3);
  assert.equal(topPicks(rankToday([], items, "today", NOW), 5).length, 5);
  assert.equal(topPicks(rankToday([], items, "today", NOW), 9).length, 5);
  assert.equal(topPicks(rankToday([], items, "today", NOW), 1).length, 3);
  assert.equal(clampCount(Number.NaN), 3);
});

test("tiers order needs input, urgent, review requests, mentions, then the rest", () => {
  const cards = [
    card("DONE-AGENT", "agent_done", 4, TODAY),
    card("URG", "in_progress", 1, TODAY),
    card("NI", "needs_input", 4, TODAY),
  ];
  const items = [
    item("other", { type: "pr_assigned", priority: 90 }),
    item("mention", { type: "pr_mention", priority: 10 }),
    item("review", { type: "pr_review", priority: 10 }),
  ];
  const pool = rankToday(cards, items, "today", NOW);
  assert.deepEqual(keys(pool), [
    "NI",
    "URG",
    "review",
    "mention",
    "other",
    "DONE-AGENT",
  ]);
  assert.deepEqual(
    pool.map((e) => e.tier),
    [1, 2, 3, 4, 5, 5],
  );
});

test("within a tier: priority, then newest time, then key", () => {
  const items = [
    item("b", { priority: 50, createdAt: TODAY }),
    item("a", { priority: 50, createdAt: TODAY }),
    item("older", { priority: 50, createdAt: THREE_DAYS_AGO }),
    item("high", { priority: 80, createdAt: THREE_DAYS_AGO }),
  ];
  assert.deepEqual(keys(rankToday([], items, "week", NOW)), [
    "high",
    "a",
    "b",
    "older",
  ]);
});

test("an agent_done card ranks at least 75 on the item scale", () => {
  const pool = rankToday(
    [card("AD", "agent_done", 4, TODAY)],
    [item("i", { priority: 70 })],
    "today",
    NOW,
  );
  assert.deepEqual(keys(pool), ["AD", "i"]);
  assert.equal(pool[0].priority, 75);
});

test("snoozed and done items never enter the pool", () => {
  const items = [
    item("snoozed", { state: "snoozed", snoozedUntil: TEN_DAYS_AGO }),
    item("done", { state: "done" }),
    item("read", { state: "read" }),
  ];
  assert.deepEqual(keys(rankToday([], items, "week", NOW)), ["read"]);
});

test("non-urgent inbox, to do and in progress cards stay out; urgent done and parked cards too", () => {
  const cards = [
    card("INBOX", "inbox", 2, TODAY),
    card("TODO", "todo", 3, TODAY),
    card("WIP", "in_progress", 0, TODAY),
    card("REVIEW", "in_review", 2, TODAY),
    card("DONE", "done", 1, TODAY),
    card("PARKED", "parked", 1, TODAY),
  ];
  assert.deepEqual(keys(rankToday(cards, [], "week", NOW)), []);
});

test("sentry items join only through the feed filter", () => {
  const items = [
    item("sentry:1", {
      source: "sentry",
      type: "error",
      meta: { shortId: "API-1", project: "api" },
    }),
  ];
  assert.deepEqual(
    keys(rankToday([], feedItems(items, false), "today", NOW)),
    [],
  );
  assert.deepEqual(keys(rankToday([], feedItems(items, true), "today", NOW)), [
    "sentry:1",
  ]);
});

test("an unparsable time is outside every window, except for a needs_input card", () => {
  const cards = [
    card("NI", "needs_input", 3, "not a date"),
    card("URG", "todo", 1, "not a date"),
  ];
  const items = [item("bad", { createdAt: "" })];
  assert.deepEqual(keys(rankToday(cards, items, "today", NOW)), ["NI"]);
  assert.deepEqual(keys(rankToday(cards, items, "week", NOW)), ["NI"]);
});

test("chips and action labels follow the entry kind", () => {
  const cards = [
    card("NI-1", "needs_input", 3, TODAY),
    card("URG-1", "todo", 1, TODAY),
    card("URG-2", "in_review", 1, TODAY),
    card("AD-1", "agent_done", 2, TODAY),
  ];
  const items = [
    item("github:acme/api#12", { type: "pr_review" }),
    item("github:acme/web#7", {
      type: "pr_mention",
      meta: { repo: "acme/web", number: "7", author: "" },
    }),
    item("sentry:107", {
      source: "sentry",
      type: "error_assigned",
      meta: { shortId: "API-107", project: "api" },
    }),
    item("slack:1", { source: "slack", type: "dm", meta: { channel: "#ops" } }),
  ];
  const byKey = new Map(
    rankToday(cards, items, "today", NOW).map((e) => [e.key, e]),
  );
  const view = (k: string) => [byKey.get(k)?.actionLabel, byKey.get(k)?.chips];
  assert.deepEqual(view("NI-1"), ["Answer the agent", ["NI-1", "Needs Input"]]);
  assert.deepEqual(view("URG-1"), ["Start", ["URG-1", "To Do"]]);
  assert.deepEqual(view("URG-2"), ["Open", ["URG-2", "In Review"]]);
  assert.deepEqual(view("AD-1"), ["Review the result", ["AD-1", "Agent Done"]]);
  assert.deepEqual(view("github:acme/api#12"), [
    "Review",
    ["acme/api#12", "by mchen"],
  ]);
  assert.deepEqual(view("github:acme/web#7"), ["Reply", ["acme/web#7"]]);
  assert.deepEqual(view("sentry:107"), ["Fix with agent", ["API-107", "api"]]);
  assert.deepEqual(view("slack:1"), ["Open", ["#ops"]]);
  assert.equal(byKey.get("URG-1")?.source, "linear");
});

test("an agent_done card ignores the window like a needs_input card (U3-04 change)", () => {
  const cards = [
    card("AD-OLD", "agent_done", 3, TEN_DAYS_AGO),
    card("AD-BAD", "agent_done", 3, "not a date"),
    card("TODO-OLD", "todo", 1, TEN_DAYS_AGO),
  ];
  assert.deepEqual(keys(rankToday(cards, [], "today", NOW)), [
    "AD-OLD",
    "AD-BAD",
  ]);
  assert.deepEqual(keys(rankToday(cards, [], "week", NOW)), [
    "AD-OLD",
    "AD-BAD",
  ]);
});

test("an urgent card in agent_done ranks as urgent but reads Review the result", () => {
  const [entry] = rankToday(
    [card("AD-URG", "agent_done", 1, TODAY)],
    [],
    "today",
    NOW,
  );
  assert.equal(entry.tier, 2);
  assert.equal(entry.actionLabel, "Review the result");
  assert.equal(entry.priority, 100);
});

test("group members never enter the pool; the group card stands for them", () => {
  const cards = [
    card("GRP", "needs_input", 3, TODAY),
    { ...card("MEM-1", "needs_input", 3, TODAY), groupId: "GRP" },
    { ...card("MEM-2", "needs_input", 3, TODAY), groupId: "GRP" },
  ];
  assert.deepEqual(keys(topPicks(rankToday(cards, [], "today", NOW), 3)), [
    "GRP",
  ]);
});

test("the week window keeps an entry exactly 7 days old and drops one a millisecond older", () => {
  const edge = new Date(NOW - 604_800_000).toISOString();
  const older = new Date(NOW - 604_800_001).toISOString();
  const items = [
    item("edge", { createdAt: edge }),
    item("older", { createdAt: older }),
  ];
  assert.deepEqual(keys(rankToday([], items, "week", NOW)), ["edge"]);
});

test("a blank GitHub author yields no author chip", () => {
  const [entry] = rankToday(
    [],
    [
      item("github:acme/api#9", {
        meta: { repo: "acme/api", number: "9", author: "  " },
      }),
    ],
    "today",
    NOW,
  );
  assert.deepEqual(entry.chips, ["acme/api#9"]);
});

test("the author chip shows the trimmed name", () => {
  const [entry] = rankToday(
    [],
    [
      item("github:acme/api#9", {
        meta: { repo: "acme/api", number: "9", author: "  mchen " },
      }),
    ],
    "today",
    NOW,
  );
  assert.deepEqual(entry.chips, ["acme/api#9", "by mchen"]);
});

test("a Sentry item with an empty shortId or project drops that chip", () => {
  const sentry = (id: string, meta: Record<string, string>) =>
    item(id, { source: "sentry", type: "error", meta });
  const byKey = new Map(
    rankToday(
      [],
      [
        sentry("sentry:1", { shortId: "", project: "api" }),
        sentry("sentry:2", { shortId: "API-2", project: "" }),
      ],
      "today",
      NOW,
    ).map((e) => [e.key, e.chips]),
  );
  assert.deepEqual(byKey.get("sentry:1"), ["api"]);
  assert.deepEqual(byKey.get("sentry:2"), ["API-2"]);
});

test("two entries with unparsable times in one tier order by key", () => {
  const cards = [
    card("NI-B", "needs_input", 3, "bad"),
    card("NI-A", "needs_input", 3, "also bad"),
  ];
  assert.deepEqual(keys(rankToday(cards, [], "today", NOW)), ["NI-A", "NI-B"]);
});

test("an urgent card in the inbox column enters as urgent with Open", () => {
  const [entry] = rankToday([card("INB", "inbox", 1, TODAY)], [], "today", NOW);
  assert.equal(entry.tier, 2);
  assert.equal(entry.actionLabel, "Open");
});

test("clampCount keeps 4 and lifts 0 to 3", () => {
  assert.equal(clampCount(4), 4);
  assert.equal(clampCount(0), 3);
});

test("an entry exactly at local midnight is inside today; one a millisecond earlier is not", () => {
  const midnight = new Date(2026, 8, 25, 0, 0, 0).getTime();
  const items = [
    item("mid", { createdAt: new Date(midnight).toISOString() }),
    item("before", { createdAt: new Date(midnight - 1).toISOString() }),
  ];
  assert.deepEqual(keys(rankToday([], items, "today", NOW)), ["mid"]);
});
