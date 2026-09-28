import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Item } from "../../../shared/types.js";
import { inboxWaitingCount, isInboxWaiting } from "./inbox-count.js";

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  issueId: id,
  identifier: id,
  title: id,
  description: null,
  priority: 0,
  column: "inbox",
  updatedAt: "2026-09-24T10:00:00.000Z",
  ...extra,
});

const item = (id: string): Item => ({
  id,
  source: "fake",
  type: "pr",
  title: id,
  snippet: "",
  createdAt: "2026-09-24T10:00:00.000Z",
  priority: 1,
  state: "unread",
  meta: {},
});

test("the Inbox count is waiting cards plus listed items, group members excluded", () => {
  const cards = [
    card("LIN-1"),
    card("LIN-2", { groupId: "GROUP-1" }),
    card("LIN-3", { column: "todo" }),
  ];
  assert.equal(isInboxWaiting(cards[1]), false);
  assert.equal(inboxWaitingCount(cards), 1);
  assert.equal(inboxWaitingCount(cards, [item("fake:a"), item("fake:b")]), 3);
});
