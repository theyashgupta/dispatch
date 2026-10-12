import { formatCount } from "../../../../shared/format-count.js";
import type { Board, BoardCount, BoardKey } from "../../../../shared/types.js";

export interface SwitcherItem {
  key: BoardKey;
  name: string;
  attention: number;
  loops: number;
  selected: boolean;
}

/** The active boards in list order with their attention and running loop counts and the selected mark. */
export function switcherItems(
  boards: readonly Pick<Board, "key" | "name" | "archived">[],
  counts: readonly BoardCount[] | undefined,
  selected: BoardKey,
): SwitcherItem[] {
  return boards
    .filter((board) => !board.archived)
    .map((board) => {
      const count = counts?.find((entry) => entry.key === board.key);
      return {
        key: board.key,
        name: board.name,
        attention: count?.attention ?? 0,
        loops: count?.loops.length ?? 0,
        selected: board.key === selected,
      };
    });
}

/** The accessible name of an attention badge. */
export function attentionLabel(n: number): string {
  return n === 1
    ? "1 item needs attention"
    : `${formatCount(n)} items need attention`;
}

/** The accessible name of a running loops count. */
export function loopsLabel(n: number): string {
  return n === 1 ? "1 running loop" : `${formatCount(n)} running loops`;
}
