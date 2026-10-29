import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey, Card } from "../../../../shared/types.js";
import { switcherItems, type SwitcherItem } from "./board-switcher.js";
import {
  buildCommands,
  commandsInGroup,
  filterCommands,
  groupCommands,
  type CommandContext,
} from "./commands.js";

function card(extra: Partial<Card> = {}): Card {
  return {
    id: "LOCAL-7",
    boardKey: DEFAULT_BOARD_KEY,
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
    meetingNotes: () => calls.push("meeting-notes"),
    syncNow: () => calls.push("sync"),
    switchBoard: (key) => calls.push(`switch ${key}`),
    createBoard: async (name) => {
      calls.push(`create-board ${name}`);
      await Promise.resolve();
    },
  };
  return { context, calls };
}

const nav = [{ page: "inbox" as const, label: "Inbox" }];

const ids = (card: Card | null) =>
  buildCommands(ctx().context, nav, card).map((c) => c.id);

test("with no card only the page commands, New ticket and Sync now appear", () => {
  assert.deepEqual(ids(null), [
    "go:board",
    "go:inbox",
    "go:settings",
    "new-ticket",
    "meeting-notes",
    "sync-now",
    "manage-boards",
    "create-board",
  ]);
});

test("the meeting notes command opens the paste flow", () => {
  const { context, calls } = ctx();
  const command = buildCommands(context, nav, null).find(
    (c) => c.id === "meeting-notes",
  );
  assert.equal(command?.label, "New tickets from meeting notes");
  void command?.run();
  assert.deepEqual(calls, ["meeting-notes"]);
});

test("a To Do card puts Start and every allowed Move to first, in column order, never In Progress or Agent Done", () => {
  const cardIds = ids(card()).slice(0, -8);
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
  ).slice(0, -8);
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

test("the card commands Open terminal and Clean up each call their action once with the card id", async () => {
  const { context, calls } = ctx();
  const commands = buildCommands(
    context,
    nav,
    card({ column: "done", tmuxSession: "dsp-LOCAL-7", workspacePath: "/ws" }),
  );
  await commands.find((c) => c.id === "open-terminal")?.run();
  await commands.find((c) => c.id === "cleanup")?.run();
  assert.deepEqual(calls, ["open LOCAL-7", "cleanup LOCAL-7"]);
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
  assert.deepEqual(ids(card({ column: "inbox" })).slice(0, -8), ["move:todo"]);
  assert.deepEqual(ids(card({ groupId: "g1" })), ids(null));
});

test("an already cleaned Done card offers no Clean up", () => {
  assert.equal(ids(card({ column: "done" })).includes("cleanup"), false);
  assert.equal(
    ids(card({ column: "done", workspacePath: "/ws" })).includes("cleanup"),
    true,
  );
});

test("the palette has Go to Slack only when the filtered nav list keeps the Slack row", () => {
  const withSlack = [
    { page: "inbox" as const, label: "Inbox" },
    { page: "slack" as const, label: "Slack" },
  ];
  const goTo = (list: typeof withSlack) =>
    buildCommands(ctx().context, list, null)
      .map((c) => c.label)
      .filter((label) => label.startsWith("Go to"));
  assert.ok(goTo(withSlack).includes("Go to Slack"));
  assert.deepEqual(goTo(withSlack.slice(0, 1)), [
    "Go to Board",
    "Go to Inbox",
    "Go to Settings",
  ]);
});

const item = (key: string, name: string, selected: boolean): SwitcherItem => ({
  key: key as BoardKey,
  name,
  attention: 0,
  loops: 0,
  selected,
});

const twoBoards = [
  item("LOCAL", "Dispatch", true),
  item("ACME", "Acme", false),
];

test("each board but the selected one gets a Switch to board entry", () => {
  const { context, calls } = ctx();
  const commands = buildCommands(context, nav, null, twoBoards);
  const entries = commands.filter((c) => c.id.startsWith("board:"));
  assert.deepEqual(
    entries.map((c) => [c.id, c.label, c.group]),
    [["board:ACME", "Switch to board Acme", "Boards"]],
  );
  void entries[0]?.run();
  assert.deepEqual(calls, ["switch ACME"]);
});

test("the switch entries follow the list order and leave out the selected board and archived boards", () => {
  const { context } = ctx();
  const listed = switcherItems(
    [
      { key: "LOCAL" as BoardKey, name: "Dispatch", archived: false },
      { key: "OLD" as BoardKey, name: "Old", archived: true },
      { key: "ACME" as BoardKey, name: "Acme", archived: false },
      { key: "GARNET" as BoardKey, name: "Garnet", archived: false },
    ],
    undefined,
    "ACME" as BoardKey,
  );
  assert.deepEqual(
    buildCommands(context, nav, null, listed)
      .filter((c) => c.id.startsWith("board:"))
      .map((c) => c.id),
    ["board:LOCAL", "board:GARNET"],
  );
});

test("with only the selected board or before the list loads there is no Switch to board entry", () => {
  const { context } = ctx();
  for (const switcher of [null, [item("LOCAL", "Dispatch", true)]]) {
    const commands = buildCommands(context, nav, null, switcher);
    assert.equal(
      commands.some((c) => c.id.startsWith("board:")),
      false,
    );
  }
});

test("commandsInGroup keeps only the group rows, or every row for a null group", () => {
  const { context } = ctx();
  const commands = buildCommands(context, nav, card(), twoBoards);
  assert.deepEqual(
    commandsInGroup(commands, "Boards").map((c) => c.id),
    ["board:ACME", "manage-boards", "create-board"],
  );
  assert.equal(commandsInGroup(commands, null).length, commands.length);
  assert.deepEqual(commandsInGroup(commands, "Nope"), []);
});

test("Manage boards and Create board show with and without the switcher", async () => {
  for (const switcher of [null, twoBoards]) {
    const { context, calls } = ctx();
    const commands = buildCommands(context, nav, card(), switcher);
    const manage = commands.find((c) => c.id === "manage-boards");
    const create = commands.find((c) => c.id === "create-board");
    assert.equal(manage?.label, "Manage boards");
    assert.equal(create?.label, "Create board");
    assert.equal(create?.prompt?.placeholder, "Board name");
    assert.equal(create?.prompt?.hint, "Press Enter to create");
    assert.equal(manage?.group, "Boards");
    assert.equal(create?.group, "Boards");
    void manage?.run();
    await create?.prompt?.submit("Payments");
    assert.deepEqual(calls, ["go boards", "create-board Payments"]);
  }
});

test("groupCommands splits the Boards group from the ungrouped commands and keeps indexes", () => {
  const { context } = ctx();
  const commands = buildCommands(context, nav, null, twoBoards);
  const sections = groupCommands(commands);
  assert.deepEqual(
    sections.map((section) => section.heading),
    [undefined, "Boards"],
  );
  assert.deepEqual(
    sections.flatMap((section) => section.rows.map((row) => row.index)),
    commands.map((_, index) => index),
  );
});

test("Go to Dashboard shows only when the current board has a main orchestrator", () => {
  const { context, calls } = ctx();
  const commands = buildCommands(context, nav, null, null, true);
  const listed = commands.map((c) => c.id);
  assert.equal(listed.filter((id) => id === "go:dashboard").length, 1);
  assert.equal(
    listed.indexOf("go:dashboard"),
    listed.indexOf("go:settings") + 1,
  );
  const dashboard = commands.find((c) => c.id === "go:dashboard");
  assert.equal(dashboard?.label, "Go to Dashboard");
  void dashboard?.run();
  assert.deepEqual(calls, ["go dashboard"]);
  assert.equal(
    buildCommands(ctx().context, nav, null).some(
      (c) => c.id === "go:dashboard",
    ),
    false,
  );
});

test("Go to Board always shows and opens the current board", () => {
  for (const hasMain of [false, true]) {
    const { context, calls } = ctx();
    const board = buildCommands(context, nav, null, null, hasMain).find(
      (c) => c.id === "go:board",
    );
    assert.equal(board?.label, "Go to Board");
    void board?.run();
    assert.deepEqual(calls, ["go board"]);
  }
});
