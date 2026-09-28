import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card, Item } from "../../shared/types.js";
import {
  actionsFor,
  INBOX_ACTIONS,
  runAction,
  type ActionContext,
  type InboxRowModel,
} from "./actions.js";
import { askAboutQuestion } from "./ask.js";

const ask = INBOX_ACTIONS.find((a) => a.id === "ask");

function context(asked: string[]): ActionContext {
  const unused = () => Promise.reject(new Error("unused"));
  return {
    api: {
      promoteItem: unused,
      setItemState: unused,
      snoozeItem: unused,
      moveCard: unused,
    },
    showUndo: () => {},
    notice: () => {},
    openSnooze: () => {},
    openUrl: () => {},
    copyText: () => Promise.resolve(),
    askAbout: (question) => asked.push(question),
  };
}

const itemRow: InboxRowModel = {
  kind: "item",
  id: "fake-snapshot:1",
  source: "linear",
  title: "Review the importer",
  snippet: "",
  priority: 80,
  time: "2026-09-25T10:00:00.000Z",
  unread: true,
  typeLabel: "Issue assigned",
  item: { id: "fake-snapshot:1" } as Item,
};

const cardRow: InboxRowModel = {
  kind: "card",
  id: "LOCAL-926",
  source: "local",
  title: "Triage the flaky build report",
  snippet: "",
  priority: 0,
  time: "2026-09-25T10:00:00.000Z",
  unread: false,
  typeLabel: "Ticket",
  card: { id: "LOCAL-926", identifier: "LOCAL-926" } as Card,
};

test("ask applies to item rows and card rows with key a", () => {
  assert.ok(ask);
  assert.equal(ask.key, "a");
  assert.equal(ask.label, "Ask about this");
  assert.ok(actionsFor(itemRow).some((a) => a.id === "ask"));
  assert.ok(actionsFor(cardRow).some((a) => a.id === "ask"));
});

test("running ask on an item row calls askAbout with the item question", async () => {
  const asked: string[] = [];
  assert.ok(ask);
  await runAction(ask, context(asked), itemRow);
  assert.deepEqual(asked, [
    askAboutQuestion({
      kind: "item",
      source: "linear",
      typeLabel: "Issue assigned",
      title: "Review the importer",
    }),
  ]);
});

test("running ask on a card row calls askAbout with the card question", async () => {
  const asked: string[] = [];
  assert.ok(ask);
  await runAction(ask, context(asked), cardRow);
  assert.deepEqual(asked, [
    askAboutQuestion({
      kind: "card",
      identifier: "LOCAL-926",
      title: "Triage the flaky build report",
    }),
  ]);
});
