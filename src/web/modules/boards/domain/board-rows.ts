import type { Board, BoardCount, BoardKey } from "../../../../shared/types.js";
import {
  archiveAction,
  keyClash,
  type ArchiveAction,
} from "./board-archive.js";

export interface BoardRow {
  board: Board;
  counts: Pick<
    BoardCount,
    "running" | "openGroups" | "attention" | "loops"
  > | null;
  keyClash: boolean;
  archive: ArchiveAction;
}

/** Build the table rows of the active boards, with the counts of each board when they are known. */
export function boardRows(
  boards: readonly Board[],
  counts: readonly BoardCount[] | undefined,
  knownLinearTeamKeys: readonly string[],
): BoardRow[] {
  const byKey = new Map<BoardKey, BoardCount>(
    (counts ?? []).map((count) => [count.key, count]),
  );
  return boards
    .filter((board) => !board.archived)
    .map((board) => {
      const count = byKey.get(board.key) ?? null;
      return {
        board,
        counts: count,
        keyClash: keyClash(board, knownLinearTeamKeys),
        archive: archiveAction(board, count?.running ?? 0),
      };
    });
}
