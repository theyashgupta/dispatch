import { isManualMoveAllowed } from "../../shared/column-transitions.js";
import { COLUMNS, type Card } from "../../shared/types.js";
import { CARD_ACTIONS, type CardActionContext } from "./actions.js";
import { COLUMN_LABELS } from "./event-copy.js";
import type { Page } from "./route.js";

export interface Command {
  id: string;
  label: string;
  key?: string;
  run: () => void | Promise<void>;
}

export interface CommandContext extends CardActionContext {
  navigate: (page: Page) => void;
  newTicket: () => void;
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
    { id: "sync-now", label: "Sync now", run: ctx.syncNow },
  ];
  if (card == null || card.groupId != null) return general;
  const commands: Command[] = [];
  if (card.column === "todo") {
    commands.push({
      id: "start",
      label: "Start",
      run: () => CARD_ACTIONS.start(ctx, card),
    });
  }
  if (hasLiveSession(card)) {
    commands.push({
      id: "open-terminal",
      label: "Open terminal",
      run: () => CARD_ACTIONS.openTerminal(ctx, card),
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
      run: () => CARD_ACTIONS.moveTo(ctx, card, column),
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
      run: () => CARD_ACTIONS.cleanup(ctx, card),
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
