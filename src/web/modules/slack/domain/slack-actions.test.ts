import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../../../shared/types.js";
import { slackActions } from "./slack-actions.js";
import type { SlackRow } from "./slack-rows.js";

function row(url: string | undefined): SlackRow {
  const item = {
    id: "slack:1",
    source: "slack",
    type: "mention",
    title: "t",
    snippet: "s",
    createdAt: "2026-09-28T09:00:00.000Z",
    priority: 75,
    state: "unread",
    meta: {},
    url,
  } satisfies Item;
  return {
    id: item.id,
    title: item.title,
    snippet: item.snippet,
    time: item.createdAt,
    unread: true,
    url,
    item,
  };
}

test("slackActions lists the five actions in button order for a web url", () => {
  assert.deepEqual(
    slackActions(row("https://acme.slack.com/archives/C1/p1")).map(
      (a) => a.label,
    ),
    ["Draft reply", "Promote to ticket", "Snooze", "Done", "Copy link"],
  );
});

test("slackActions drops Copy link for a missing url and for a non-web url", () => {
  for (const url of [undefined, "javascript:alert(1)", "not a url"]) {
    assert.deepEqual(
      slackActions(row(url)).map((a) => a.id),
      ["draftReply", "promote", "snooze", "done"],
      String(url),
    );
  }
});
