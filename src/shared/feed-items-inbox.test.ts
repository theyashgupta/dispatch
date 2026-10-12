import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dismissedFeed,
  inboxFeed,
  isInboxItem,
  isOpenItem,
} from "./feed-items.js";
import type { Item } from "./types.js";

const item = (
  source: string,
  needsSession?: string,
  state: Item["state"] = "unread",
): Item => ({
  id: `${source}:${needsSession ?? "none"}:${state}`,
  source,
  type: "mention",
  title: source,
  snippet: "",
  createdAt: "2026-09-25T00:00:00Z",
  priority: 50,
  state,
  meta: needsSession === undefined ? {} : { needsSession },
});

const ids = (list: Item[]) => list.map((i) => i.id);

test("needsSession true keeps only a Slack item, not github, sentry, calendar or meeting", () => {
  const sources = ["github", "sentry", "calendar", "meeting", "slack"];
  const feed = inboxFeed(
    sources.map((source) => item(source, "true")),
    sources,
  );
  assert.deepEqual(ids(feed), ["slack:true:unread"]);
});

test("a Slack item with needsSession false or no needsSession is dropped", () => {
  assert.deepEqual(
    inboxFeed([item("slack", "false"), item("slack")], ["slack"]),
    [],
  );
});

test("a done or dismissed Slack item is dropped; unread, read and snoozed are kept (snoozed stays in the feed)", () => {
  const states: Item["state"][] = [
    "unread",
    "read",
    "snoozed",
    "done",
    "dismissed",
  ];
  const feed = inboxFeed(
    states.map((state) => item("slack", "true", state)),
    ["slack"],
  );
  assert.deepEqual(ids(feed), [
    "slack:true:unread",
    "slack:true:read",
    "slack:true:snoozed",
  ]);
});

test("Slack not in enabledSources drops the Slack item", () => {
  const items = [item("slack", "true")];
  assert.deepEqual(inboxFeed(items, ["github"]), []);
  assert.deepEqual(inboxFeed(items, []), []);
});

test("isInboxItem is true only for an open Slack item with needsSession true", () => {
  assert.equal(isInboxItem(item("slack", "true")), true);
  assert.equal(isInboxItem(item("slack", "true", "snoozed")), true);
  assert.equal(isInboxItem(item("slack", "false")), false);
  assert.equal(isInboxItem(item("slack")), false);
  assert.equal(isInboxItem(item("slack", "true", "done")), false);
  assert.equal(isInboxItem(item("slack", "true", "dismissed")), false);
  assert.equal(isInboxItem(item("linear", "true")), false);
  assert.equal(isInboxItem(item("github", "true")), false);
});

test("the input list is not mutated", () => {
  const items = [item("github", "true"), item("slack", "true")];
  inboxFeed(items, []);
  assert.equal(items.length, 2);
});

test("isOpenItem is false for done and dismissed and true for every other state", () => {
  const states: Item["state"][] = ["unread", "read", "snoozed"];
  for (const state of states) {
    assert.equal(isOpenItem(item("slack", "true", state)), true, state);
  }
  assert.equal(isOpenItem(item("slack", "true", "done")), false);
  assert.equal(isOpenItem(item("slack", "true", "dismissed")), false);
});

test("dismissedFeed keeps only dismissed items and hides Slack while Slack is off", () => {
  const items = [
    item("slack", "true", "dismissed"),
    item("github", undefined, "dismissed"),
    item("slack", "true", "unread"),
  ];
  assert.deepEqual(ids(dismissedFeed(items, ["slack", "github"])), [
    "slack:true:dismissed",
    "github:none:dismissed",
  ]);
  assert.deepEqual(ids(dismissedFeed(items, ["github"])), [
    "github:none:dismissed",
  ]);
});
