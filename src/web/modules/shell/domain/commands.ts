import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import { isManualMoveAllowed } from "../../../../shared/column-transitions.js";
import type { Page } from "../../../../shared/route.js";
import { COLUMNS, type Card, type Column } from "../../../../shared/types.js";

export interface Command {
  id: string;
  label: string;
  key?: string;
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
}

const hasLiveSession = (card: Card) =>
  card.tmuxSession != null && card.sessionLost !== true;

/**
 * The palette's commands for the selected card, then every page, New ticket and Sync now.
 *
 * @remarks Card commands come first, only with a selected card and only where it can take them:
 * Start from To Do, Open terminal with a live session, Move to every column the manual-move
 * rule allows except the card's own, and Clean up from Done.
 */
export function buildCommands(
  ctx: CommandContext,
  navItems: readonly { page: Page; label: string }[],
  card: Card | null,
): Command[] {
  const general: Command[] = [
    ...[...navItems, { page: "settings" as const, label: "Settings" }].map(
      (item) => ({
        id: `go:${item.page}`,
        label: `Go to ${item.label}`,
        run: () => ctx.navigate(item.page),
      }),
    ),
    { id: "new-ticket", label: "New ticket", key: "n", run: ctx.newTicket },
    {
      id: "meeting-notes",
      label: "New tickets from meeting notes",
      run: ctx.meetingNotes,
    },
    { id: "sync-now", label: "Sync now", run: ctx.syncNow },
  ];
  if (card == null || card.groupId != null) return general;
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
  return [...commands, ...general];
}

/** The commands whose label contains the query, case-insensitive, in their original order. */
export function filterCommands(
  commands: readonly Command[],
  query: string,
): Command[] {
  const q = query.trim().toLowerCase();
  return commands.filter((c) => c.label.toLowerCase().includes(q));
}
