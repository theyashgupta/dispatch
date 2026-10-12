import { DEFAULT_BOARD_KEY } from "./board-key.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card, Item } from "./types.js";
import {
  inboxWaitingCount,
  isInboxDismissed,
  isInboxWaiting,
} from "./inbox-count.js";

const NOW_ISO = "2026-09-24T11:00:00.000Z";

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  boardKey: DEFAULT_BOARD_KEY,
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

test("a dismissed Inbox card is not waiting and is not counted", () => {
  const dismissed = card("LIN-4", { inboxDismissedAt: NOW_ISO });
  assert.equal(isInboxWaiting(dismissed), false);
  assert.equal(inboxWaitingCount([card("LIN-1"), dismissed]), 1);
});

test("isInboxDismissed needs the Inbox column, no group and a dismissal stamp", () => {
  assert.equal(
    isInboxDismissed(card("A", { inboxDismissedAt: NOW_ISO })),
    true,
  );
  assert.equal(isInboxDismissed(card("B")), false);
  assert.equal(
    isInboxDismissed(card("C", { column: "todo", inboxDismissedAt: NOW_ISO })),
    false,
  );
  assert.equal(
    isInboxDismissed(
      card("D", { groupId: "GROUP-1", inboxDismissedAt: NOW_ISO }),
    ),
    false,
  );
});
