import assert from "node:assert/strict";
import { test } from "node:test";
import type { Card } from "../../shared/types.js";
import {
  buildCommands,
  filterCommands,
  type CommandContext,
} from "./commands.js";

function card(extra: Partial<Card> = {}): Card {
  return {
    id: "LOCAL-7",
    issueId: "LOCAL-7",
    identifier: "LOCAL-7",
    title: "Alpha task",
    description: null,
    priority: 0,
    column: "todo",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...extra,
  };
}

function ctx() {
  const calls: string[] = [];
  const context: CommandContext = {
    api: {
      moveCard: async (id, column) => {
        calls.push(`move ${id} ${column}`);
        await Promise.resolve();
      },
    },
    requestStart: (id) => calls.push(`start ${id}`),
    requestCleanup: (id) => calls.push(`cleanup ${id}`),
    openCard: (id) => calls.push(`open ${id}`),
    navigate: (page) => calls.push(`go ${page}`),
    newTicket: () => calls.push("new"),
    syncNow: () => calls.push("sync"),
  };
  return { context, calls };
}

const nav = [
  { page: "inbox" as const, label: "Inbox" },
  { page: "board" as const, label: "Board" },
];

const ids = (card: Card | null) =>
  buildCommands(ctx().context, nav, card).map((c) => c.id);

test("with no card only the page commands, New ticket and Sync now appear", () => {
  assert.deepEqual(ids(null), [
    "go:inbox",
    "go:board",
    "go:settings",
    "new-ticket",
    "sync-now",
  ]);
});

test("a To Do card puts Start and every allowed Move to first, in column order, never In Progress or Agent Done", () => {
  const cardIds = ids(card()).slice(0, -5);
  assert.deepEqual(cardIds, [
    "start",
    "move:needs_input",
    "move:in_review",
    "move:parked",
    "move:done",
  ]);
});

test("a Done card with a live session yields Open terminal and Clean up and never a move to its own column", () => {
  const cardIds = ids(
    card({ column: "done", tmuxSession: "dsp-LOCAL-7" }),
  ).slice(0, -5);
  assert.deepEqual(cardIds, [
    "open-terminal",
    "move:todo",
    "move:in_progress",
    "move:needs_input",
    "move:in_review",
    "move:parked",
    "cleanup",
  ]);
  assert.equal(
    ids(card({ column: "done", tmuxSession: "x", sessionLost: true })).includes(
      "open-terminal",
    ),
    false,
  );
  assert.equal(
    ids(card({ column: "done", cleaningUp: true })).includes("cleanup"),
    false,
  );
});

test("each command runs its action once", async () => {
  const { context, calls } = ctx();
  const commands = buildCommands(context, nav, card());
  for (const id of [
    "go:inbox",
    "new-ticket",
    "sync-now",
    "start",
    "move:parked",
  ]) {
    await commands.find((c) => c.id === id)?.run();
  }
  assert.deepEqual(calls, [
    "go inbox",
    "new",
    "sync",
    "start LOCAL-7",
    "move LOCAL-7 parked",
  ]);
});

test("filter is a case-insensitive substring over the label that keeps order", () => {
  const commands = buildCommands(ctx().context, nav, card());
  assert.deepEqual(
    filterCommands(commands, "INB").map((c) => c.id),
    ["go:inbox"],
  );
  assert.deepEqual(
    filterCommands(commands, "move to p").map((c) => c.id),
    ["move:parked"],
  );
  assert.equal(filterCommands(commands, "  ").length, commands.length);
  assert.deepEqual(filterCommands(commands, "zzz"), []);
});

test("an Inbox card offers only Move to To Do and a grouped member gets no card commands", () => {
  assert.deepEqual(ids(card({ column: "inbox" })).slice(0, -5), ["move:todo"]);
  assert.deepEqual(ids(card({ groupId: "g1" })), ids(null));
});

test("an already cleaned Done card offers no Clean up", () => {
  assert.equal(ids(card({ column: "done" })).includes("cleanup"), false);
  assert.equal(
    ids(card({ column: "done", workspacePath: "/ws" })).includes("cleanup"),
    true,
  );
});
