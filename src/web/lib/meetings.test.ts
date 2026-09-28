import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../shared/types.js";
import {
  meetingGroups,
  meetingNotice,
  parseSiblings,
  snippetBodyLine,
} from "./meetings.js";

function item(overrides: Partial<Item> & { id: string }): Item {
  return {
    source: "meeting",
    type: "action_item",
    title: "Do the thing",
    snippet: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    priority: 76,
    state: "unread",
    meta: {},
    ...overrides,
  };
}

test("the meeting notice counts created and updated items", () => {
  assert.equal(
    meetingNotice({ created: 1, updated: 0 }),
    "Created 1 item in the Inbox.",
  );
  assert.equal(
    meetingNotice({ created: 3, updated: 0 }),
    "Created 3 items in the Inbox.",
  );
  assert.equal(
    meetingNotice({ created: 2, updated: 1 }),
    "Created 2 items in the Inbox. Updated 1.",
  );
  assert.equal(
    meetingNotice({ created: 0, updated: 1 }),
    "Updated 1 item in the Inbox.",
  );
  assert.equal(
    meetingNotice({ created: 0, updated: 4 }),
    "Updated 4 items in the Inbox.",
  );
  assert.equal(
    meetingNotice({ created: 2, updated: 0, notesSaved: false }),
    "Created 2 items in the Inbox. The notes weren't saved.",
  );
  assert.equal(
    meetingNotice({ created: 0, updated: 2, notesSaved: false }),
    "Updated 2 items in the Inbox. The notes weren't saved.",
  );
  assert.equal(
    meetingNotice({ created: 1, updated: 0, notesSaved: true }),
    "Created 1 item in the Inbox.",
  );
});

test("meetingGroups groups items by meetingId", () => {
  const items = [
    item({
      id: "meeting:paste:2026-01-01-sync:a",
      meta: {
        meetingId: "paste:2026-01-01-sync",
        meeting: "Sync",
        meetingDate: "2026-01-01",
      },
    }),
    item({
      id: "meeting:paste:2026-01-01-sync:b",
      meta: {
        meetingId: "paste:2026-01-01-sync",
        meeting: "Sync",
        meetingDate: "2026-01-01",
      },
    }),
  ];
  const groups = meetingGroups(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "paste:2026-01-01-sync");
  assert.equal(groups[0].items.length, 2);
});

test("an item without a meetingId forms its own group keyed by its item id", () => {
  const solo = item({ id: "meeting:paste:2026-01-01-x:a", title: "Solo item" });
  const groups = meetingGroups([solo]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "meeting:paste:2026-01-01-x:a");
  assert.equal(groups[0].meeting, "Solo item");
  assert.equal(groups[0].meetingDate, "");
});

test("groups sort by meetingDate descending, then meeting name ascending", () => {
  const groups = meetingGroups([
    item({
      id: "1",
      meta: { meetingId: "g1", meeting: "Zeta", meetingDate: "2026-01-01" },
    }),
    item({
      id: "2",
      meta: { meetingId: "g2", meeting: "Beta", meetingDate: "2026-01-03" },
    }),
    item({
      id: "3",
      meta: { meetingId: "g3", meeting: "Alpha", meetingDate: "2026-01-03" },
    }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.meeting),
    ["Alpha", "Beta", "Zeta"],
  );
});

test("items inside a group sort by createdAt ascending, then id", () => {
  const groups = meetingGroups([
    item({
      id: "b",
      createdAt: "2026-01-01T01:00:00.000Z",
      meta: { meetingId: "g1" },
    }),
    item({
      id: "a",
      createdAt: "2026-01-01T00:00:00.000Z",
      meta: { meetingId: "g1" },
    }),
    item({
      id: "c",
      createdAt: "2026-01-01T00:00:00.000Z",
      meta: { meetingId: "g1" },
    }),
  ]);
  assert.deepEqual(
    groups[0].items.map((i) => i.id),
    ["a", "c", "b"],
  );
});

test("feed maps granola to granola and everything else to paste", () => {
  const [granola] = meetingGroups([
    item({ id: "1", meta: { meetingId: "g1", feed: "granola" } }),
  ]);
  const [paste] = meetingGroups([
    item({ id: "2", meta: { meetingId: "g2", feed: "paste" } }),
  ]);
  const [missing] = meetingGroups([
    item({ id: "3", meta: { meetingId: "g3" } }),
  ]);
  assert.equal(granola.feed, "granola");
  assert.equal(paste.feed, "paste");
  assert.equal(missing.feed, "paste");
});

test("snippetBodyLine skips the header line and blank lines", () => {
  assert.equal(
    snippetBodyLine("From Sync on 2026-01-01.\n\n  > I will send it  \nmore"),
    "> I will send it",
  );
  assert.equal(snippetBodyLine("From Sync on 2026-01-01."), "");
  assert.equal(snippetBodyLine(""), "");
});

test("parseSiblings reads a valid JSON array of strings", () => {
  assert.deepEqual(parseSiblings('["a","b","c"]'), ["a", "b", "c"]);
});

test("parseSiblings returns [] for malformed JSON", () => {
  assert.deepEqual(parseSiblings("not json"), []);
});

test("parseSiblings returns [] for a non-array", () => {
  assert.deepEqual(parseSiblings('{"a":1}'), []);
});

test("parseSiblings drops non-string entries", () => {
  assert.deepEqual(parseSiblings('["a",1,null,"b",true]'), ["a", "b"]);
});

test("parseSiblings keeps at most 14 entries", () => {
  const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => `s${i}`));
  assert.equal(parseSiblings(many).length, 14);
});

test("parseSiblings returns [] for undefined", () => {
  assert.deepEqual(parseSiblings(undefined), []);
});
