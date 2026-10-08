import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Board } from "../../../../shared/types.js";

export type ArchiveAction =
  { kind: "none" } | { kind: "disabled"; reason: string } | { kind: "enabled" };

/** What the row menu shows for the Archive item: none for the default board, disabled while sessions run. */
export function archiveAction(
  board: Pick<Board, "key">,
  running: number,
): ArchiveAction {
  if (board.key === DEFAULT_BOARD_KEY) return { kind: "none" };
  if (running > 0) {
    return {
      kind: "disabled",
      reason: `Stop the ${running} running ${running === 1 ? "session" : "sessions"} first.`,
    };
  }
  return { kind: "enabled" };
}

/** True when a non-default board has the key of a known Linear team (the D-2 warning). */
export function keyClash(
  board: Pick<Board, "key">,
  knownLinearTeamKeys: readonly string[],
): boolean {
  return (
    board.key !== DEFAULT_BOARD_KEY && knownLinearTeamKeys.includes(board.key)
  );
}
