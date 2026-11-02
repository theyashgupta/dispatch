import type { BoardEntry } from "./board-select.js";
import type { BoardKey } from "./types.js";

export type SplitDirection = "row" | "column";

export type SplitLayout =
  | { mode: "single" }
  | { mode: "split"; secondary: BoardKey; dir: SplitDirection };

/**
 * Decide whether the board page shows one board or two.
 *
 * @remarks The split shows only on a wide viewport and only for a listed, active board other than the primary. While the board list is loading the answer is single, so a deep link never flashes a pane it may have to drop.
 */
export function splitLayout(input: {
  primary: BoardKey;
  split: string | null | undefined;
  dir: SplitDirection | undefined;
  wide: boolean;
  boards: readonly BoardEntry[] | undefined;
}): SplitLayout {
  const { primary, split, wide, boards } = input;
  if (!wide || !split || split === primary || boards === undefined) {
    return { mode: "single" };
  }
  const entry = boards.find((board) => board.key === split);
  if (entry === undefined || entry.archived) return { mode: "single" };
  return { mode: "split", secondary: entry.key, dir: input.dir ?? "row" };
}

/** The first active board, in list order, that differs from the primary. */
export function firstOtherBoard(
  primary: BoardKey,
  boards: readonly BoardEntry[] | undefined,
): BoardKey | null {
  return (
    boards?.find((board) => board.key !== primary && !board.archived)?.key ??
    null
  );
}
