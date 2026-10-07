import {
  DEFAULT_BOARD_KEY,
  DEFAULT_CHECK_COMMAND,
} from "../../../shared/board-key.js";
import type { Board, BoardWorkspaceRepo } from "../../../shared/types.js";

export interface BoardWorkspace {
  workspaceRoot: string | null;
  repositories: BoardWorkspaceRepo[];
}

/**
 * The sessions folder and repositories a session of this board uses.
 *
 * @remarks The default board keeps both where they live today, `Config.workspaceRoot` and the
 * global workspace folders, with no stored base branch (D-1 amendment of 2026-10-06).
 */
export function boardWorkspace(
  board: Board,
  configWorkspaceRoot: string | null | undefined,
  workspaceFolders: readonly string[],
): BoardWorkspace {
  if (board.key !== DEFAULT_BOARD_KEY) {
    return {
      workspaceRoot: board.workspaceRoot,
      repositories: board.repositories,
    };
  }
  return {
    workspaceRoot: configWorkspaceRoot ?? null,
    repositories: workspaceFolders.map((path) => ({
      path,
      baseBranch: null,
      checkCommand: DEFAULT_CHECK_COMMAND,
    })),
  };
}
