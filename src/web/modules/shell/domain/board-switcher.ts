import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import { formatCount } from "../../../../shared/format-count.js";
import {
  hasManyBoards,
  type BoardEntry,
} from "../../../../shared/board-select.js";
import {
  GLOBAL_SHORTCUTS,
  type ShortcutEntry,
} from "../../../../shared/shortcuts.js";
import type { Board, BoardCount, BoardKey } from "../../../../shared/types.js";

export interface SwitcherItem {
  key: BoardKey;
  name: string;
  attention: number;
  selected: boolean;
}

/**
 * Decide whether the sidebar shows the board switcher (U3-09).
 *
 * @remarks Before the list loads it hides, so a one-board user never sees it. When the list failed
 * with nothing cached it shows only for a URL board other than `LOCAL`, so the user can retry.
 */
export function showSwitcher(
  boards: readonly BoardEntry[] | undefined,
  listFailed: boolean,
  urlBoard: BoardKey,
): boolean {
  if (boards !== undefined) return hasManyBoards(boards);
  return listFailed && urlBoard !== DEFAULT_BOARD_KEY;
}

/** The active boards in list order with their attention counts and the selected mark. */
export function switcherItems(
  boards: readonly Pick<Board, "key" | "name" | "archived">[],
  counts: readonly BoardCount[] | undefined,
  selected: BoardKey,
): SwitcherItem[] {
  return boards
    .filter((board) => !board.archived)
    .map((board) => ({
      key: board.key,
      name: board.name,
      attention:
        counts?.find((count) => count.key === board.key)?.attention ?? 0,
      selected: board.key === selected,
    }));
}

/** The first two letters of a board key, shown on the collapsed trigger. */
export function collapsedLabel(key: BoardKey): string {
  return key.slice(0, 2);
}

/** The accessible name of an attention badge. */
export function attentionLabel(n: number): string {
  return n === 1
    ? "1 item needs attention"
    : `${formatCount(n)} items need attention`;
}

/** The global shortcut rows, with "Switch board" added only while the switcher shows. */
export function switcherShortcuts(show: boolean): readonly ShortcutEntry[] {
  return show
    ? [...GLOBAL_SHORTCUTS, { key: "b", label: "Switch board" }]
    : GLOBAL_SHORTCUTS;
}
