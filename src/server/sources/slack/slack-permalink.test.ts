import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPermalink, slackItem } from "./slack-message.js";

test("the permalink drops the ts dot and adds a missing trailing slash", () => {
  assert.equal(
    buildPermalink("https://acme.slack.com/", "C0G6ENG", "1700000000.000100"),
    "https://acme.slack.com/archives/C0G6ENG/p1700000000000100",
  );
  assert.equal(
    buildPermalink("https://acme.slack.com", "C0G6ENG", "1700000000.000100"),
    "https://acme.slack.com/archives/C0G6ENG/p1700000000000100",
  );
});

test("an item carries the dedupe id, the permalink, the time and the meta Slack sent", () => {
  const item = slackItem({
    message: {
      ts: "1700000000.000100",
      user: "U0G6ANA",
      text: "<@U0G6USER> can you &amp; ben look",
      thread_ts: "1700000000.000100",
      reply_count: 3,
    },
    type: "mention",
    channelId: "C0G6ENG",
    channelName: "eng-platform",
    conversation: "channel",
    author: "ana",
    names: new Map([["U0G6USER", "g6-tester"]]),
    teamUrl: "https://acme.slack.com/",
  });
  assert.deepEqual(item, {
    id: "slack:C0G6ENG:1700000000.000100",
    source: "slack",
    type: "mention",
    title: "ana in #eng-platform: @g6-tester can you & ben look",
    snippet: "@g6-tester can you & ben look",
    url: "https://acme.slack.com/archives/C0G6ENG/p1700000000000100",
    createdAt: "2023-11-14T22:13:20.000Z",
    priority: 75,
    state: "unread",
    meta: {
      channel: "C0G6ENG",
      channelName: "eng-platform",
      author: "ana",
      authorId: "U0G6ANA",
      ts: "1700000000.000100",
      conversation: "channel",
      threadTs: "1700000000.000100",
      replyCount: "3",
    },
  });
});

test("a DM item has no thread meta and names its place DM; the snippet stops at 4000", () => {
  const item = slackItem({
    message: {
      ts: "1700000001.000200",
      user: "U0G6ANA",
      text: "y".repeat(4100),
    },
    type: "dm",
    channelId: "D0G6DM1",
    channelName: "",
    conversation: "im",
    author: "ana",
    names: new Map(),
    teamUrl: "https://acme.slack.com/",
  });
  assert.equal(item.meta.channelName, "DM");
  assert.equal(item.meta.threadTs, undefined);
  assert.equal(item.meta.replyCount, undefined);
  assert.equal(item.snippet.length, 4000);
  assert.ok(item.title.startsWith("ana in DM: "));
  const emoji = slackItem({
    message: {
      ts: "1700000001.000300",
      user: "U0G6ANA",
      text: `${"y".repeat(3999)}\u{1F600}tail`,
    },
    type: "dm",
    channelId: "D0G6DM1",
    channelName: "",
    conversation: "im",
    author: "ana",
    names: new Map(),
    teamUrl: "https://acme.slack.com/",
  });
  assert.ok(emoji.snippet.endsWith("\u{1F600}"));
});

test("a group DM item names its place group DM in the title and the meta", () => {
  const item = slackItem({
    message: { ts: "1700000002.000300", user: "U0G6BEN", text: "hi all" },
    type: "dm",
    channelId: "G0G6MP1",
    channelName: "mpdm-a-b-c-1",
    conversation: "mpim",
    author: "ben",
    names: new Map(),
    teamUrl: "https://acme.slack.com/",
  });
  assert.equal(item.title, "ben in group DM: hi all");
  assert.equal(item.meta.channelName, "group DM");
  assert.equal(item.meta.conversation, "mpim");
});
