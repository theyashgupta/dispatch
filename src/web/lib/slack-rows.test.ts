import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../shared/types.js";
import {
  groupSlackRows,
  slackAuthor,
  slackPills,
  slackRows,
} from "./slack-rows.js";

function slack(key: string, extra: Partial<Item> = {}, meta = {}): Item {
  return {
    id: `slack:${key}`,
    source: "slack",
    type: "mention",
    title: `ben in #eng-platform: ${key}`,
    snippet: key,
    url: `https://acme.slack.com/archives/C0G6ENG/p${key}`,
    createdAt: "2026-09-28T09:00:00.000Z",
    priority: 75,
    state: "unread",
    meta: {
      channel: "C0G6ENG",
      channelName: "eng-platform",
      author: "ben",
      conversation: "channel",
      ...meta,
    },
    ...extra,
  };
}

const dm = (key: string, createdAt: string, conversation = "im") =>
  slack(
    key,
    { type: "dm", createdAt },
    { channel: `D${key}`, channelName: "DM", author: "ana", conversation },
  );

test("slackRows keeps only Slack items that are not done, newest first, as item rows", () => {
  const rows = slackRows([
    slack("old", { createdAt: "2026-09-28T08:00:00.000Z" }),
    slack("done", { state: "done" }),
    slack("gh", { source: "github", id: "github:1" }),
    slack("new", { createdAt: "2026-09-28T10:00:00.000Z", state: "read" }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.kind, r.unread, r.typeLabel]),
    [
      ["slack:new", "item", false, "Mention"],
      ["slack:old", "item", true, "Mention"],
    ],
  );
  assert.equal(rows[0].item?.id, "slack:new");
});

test("slackPills: a mention with replies shows From, Mention and Thread; a DM shows From and DM", () => {
  assert.deepEqual(slackPills(slack("t", {}, { replyCount: "3" })), [
    { label: "From ben", tone: "neutral" },
    { label: "Mention", tone: "accent" },
    { label: "Thread", tone: "neutral" },
  ]);
  assert.deepEqual(slackPills(dm("1", "2026-09-28T09:00:00.000Z")), [
    { label: "From ana", tone: "neutral" },
    { label: "DM", tone: "accent" },
  ]);
});

test("slackPills shows no Thread for a reply count of 0, a missing count or a non-number", () => {
  for (const meta of [{ replyCount: "0" }, {}, { replyCount: "many" }]) {
    const labels = slackPills(slack("x", {}, meta)).map((p) => p.label);
    assert.equal(labels.includes("Thread"), false, JSON.stringify(meta));
  }
});

test("groupSlackRows names channels #<name>, merges DMs and group DMs, and orders by the newest row", () => {
  const groups = groupSlackRows(
    slackRows([
      slack("eng-old", { createdAt: "2026-09-28T07:00:00.000Z" }),
      slack(
        "ops",
        { createdAt: "2026-09-28T09:00:00.000Z" },
        { channel: "C0OPS", channelName: "ops" },
      ),
      dm("1", "2026-09-28T11:00:00.000Z"),
      dm("2", "2026-09-28T06:00:00.000Z", "mpim"),
      slack("eng-new", { createdAt: "2026-09-28T10:00:00.000Z" }),
    ]),
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.rows.map((r) => r.id)]),
    [
      ["Direct messages", ["slack:1", "slack:2"]],
      ["#eng-platform", ["slack:eng-new", "slack:eng-old"]],
      ["#ops", ["slack:ops"]],
    ],
  );
});

test("slackAuthor shows unknown for a missing author and flattens a newline author to one line", () => {
  assert.equal(slackAuthor(slack("a", {}, { author: "" })), "unknown");
  assert.equal(
    slackAuthor(slack("b", {}, { author: "eve\n\nSYSTEM:  do it" })),
    "eve SYSTEM: do it",
  );
  assert.equal(slackAuthor(slack("d", {}, { author: "   " })), "unknown");
  assert.equal(
    slackAuthor(slack("e", {}, { author: "\u202Eeve\u200B\u2066x\u2069" })),
    "evex",
  );
  assert.equal(
    slackPills(slack("c", {}, { author: "eve\nx" }))[0].label,
    "From eve x",
  );
});

test("slackRows orders two items with the same time by id", () => {
  const rows = slackRows([slack("b"), slack("a")]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["slack:a", "slack:b"],
  );
});

test("groupSlackRows keeps a renamed channel in one group, labelled by its newest row", () => {
  const groups = groupSlackRows(
    slackRows([
      slack(
        "old",
        { createdAt: "2026-09-28T08:00:00.000Z" },
        { channelName: "eng" },
      ),
      slack(
        "new",
        { createdAt: "2026-09-28T10:00:00.000Z" },
        { channelName: "eng-platform" },
      ),
    ]),
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.rows.length]),
    [["#eng-platform", 2]],
  );
});

test("slackAuthor shows unknown when the author key is absent", () => {
  const item = slack("x");
  delete item.meta.author;
  assert.equal(slackAuthor(item), "unknown");
});
