import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import { isManualMoveAllowed } from "../../../../shared/column-transitions.js";
import type { Page } from "../../../../shared/route.js";
import {
  COLUMNS,
  type BoardKey,
  type Card,
  type Column,
} from "../../../../shared/types.js";
import type { SwitcherItem } from "./board-switcher.js";

export const BOARDS_GROUP = "Boards";

export interface Command {
  id: string;
  label: string;
  key?: string;
  group?: string;
  prompt?: {
    placeholder: string;
    hint: string;
    submit: (text: string) => void | Promise<void>;
  };
  run: () => void | Promise<void>;
}

export interface CommandContext {
  api: { moveCard: (cardId: string, column: Column) => void | Promise<void> };
  requestStart: (cardId: string) => void;
  requestCleanup: (cardId: string) => void;
  openCard: (cardId: string) => void;
  navigate: (page: Page) => void;
  newTicket: () => void;
  meetingNotes: () => void;
  syncNow: () => void;
  switchBoard: (key: BoardKey) => void;
  createBoard: (name: string) => Promise<void>;
  split?: { open: boolean; available: boolean; toggle: () => void };
}

const hasLiveSession = (card: Card) =>
  card.tmuxSession != null && card.sessionLost !== true;

/**
 * The one split-view command, or none when the board page cannot split.
 *
 * @remarks The Command type has no disabled state, so a closed split with no other board to open shows no entry.
 */
function splitCommands(split: CommandContext["split"]): Command[] {
  if (split === undefined || (!split.open && !split.available)) return [];
  return [
    {
      id: "board:split",
      label: split.open ? "Close split view" : "Split board view",
      run: split.toggle,
    },
  ];
}

/**
 * The palette's commands for the selected card, then every page, New ticket, Sync now and the boards.
 *
 * @remarks Card commands come first, only for a selected card and only where it can take them. "Go to Board" always shows; "Go to Dashboard" shows only when the current board has a main orchestrator. The "Boards" group comes last.
 */
export function buildCommands(
  ctx: CommandContext,
  navItems: readonly { page: Page; label: string }[],
  card: Card | null,
  switcher: readonly SwitcherItem[] | null = null,
  hasMainOrchestrator = false,
): Command[] {
  const boards: Command[] = [
    ...(switcher ?? [])
      .filter((item) => !item.selected)
      .map((item) => ({
        id: `board:${item.key}`,
        label: `Switch to board ${item.name}`,
        group: BOARDS_GROUP,
        run: () => ctx.switchBoard(item.key),
      })),
    {
      id: "manage-boards",
      label: "Manage boards",
      group: BOARDS_GROUP,
      run: () => ctx.navigate("boards"),
    },
    {
      id: "create-board",
      label: "Create board",
      group: BOARDS_GROUP,
      prompt: {
        placeholder: "Board name",
        hint: "Press Enter to create",
        submit: ctx.createBoard,
      },
      run: () => undefined,
    },
  ];
  const general: Command[] = [
    ...[
      { page: "board" as const, label: "Board" },
      ...navItems,
      { page: "settings" as const, label: "Settings" },
      ...(hasMainOrchestrator
        ? [{ page: "dashboard" as const, label: "Dashboard" }]
        : []),
    ].map((item) => ({
      id: `go:${item.page}`,
      label: `Go to ${item.label}`,
      run: () => ctx.navigate(item.page),
    })),
    { id: "new-ticket", label: "New ticket", key: "n", run: ctx.newTicket },
    {
      id: "meeting-notes",
      label: "New tickets from meeting notes",
      run: ctx.meetingNotes,
    },
    { id: "sync-now", label: "Sync now", run: ctx.syncNow },
    ...splitCommands(ctx.split),
  ];
  if (card == null || card.groupId != null) return [...general, ...boards];
  const commands: Command[] = [];
  if (card.column === "todo") {
    commands.push({
      id: "start",
      label: "Start",
      run: () => ctx.requestStart(card.id),
    });
  }
  if (hasLiveSession(card)) {
    commands.push({
      id: "open-terminal",
      label: "Open terminal",
      run: () => ctx.openCard(card.id),
    });
  }
  for (const column of COLUMNS) {
    if (
      column === card.column ||
      !isManualMoveAllowed(card.column, column) ||
      (card.column === "inbox" && column !== "todo")
    ) {
      continue;
    }
    commands.push({
      id: `move:${column}`,
      label: `Move to ${COLUMN_LABELS[column]}`,
      run: () => ctx.api.moveCard(card.id, column),
    });
  }
  if (
    card.column === "done" &&
    card.cleaningUp !== true &&
    (card.tmuxSession != null || card.workspacePath != null)
  ) {
    commands.push({
      id: "cleanup",
      label: "Clean up",
      run: () => ctx.requestCleanup(card.id),
    });
  }
  return [...commands, ...general, ...boards];
}

/** The commands whose label contains the query, case-insensitive, in their original order. */
export function filterCommands(
  commands: readonly Command[],
  query: string,
): Command[] {
  const q = query.trim().toLowerCase();
  return commands.filter((c) => c.label.toLowerCase().includes(q));
}

export function commandsInGroup(
  commands: readonly Command[],
  group: string | null,
): Command[] {
  return group === null
    ? [...commands]
    : commands.filter((command) => command.group === group);
}

/** Split commands into runs of one group, keeping each command's index in the input. */
export function groupCommands(commands: readonly Command[]): {
  heading: string | undefined;
  rows: { command: Command; index: number }[];
}[] {
  const sections: ReturnType<typeof groupCommands> = [];
  commands.forEach((command, index) => {
    const last = sections.at(-1);
    if (last !== undefined && last.heading === command.group) {
      last.rows.push({ command, index });
    } else {
      sections.push({ heading: command.group, rows: [{ command, index }] });
    }
  });
  return sections;
}
