import type { Board } from "./types.js";

export interface RepositoryInput {
  path: string;
  baseBranch?: string | null;
  checkCommand?: string;
}

export interface CreateBoardInput {
  name: string;
  key?: string;
  workspaceRoot?: string;
  repositories?: RepositoryInput[];
  linearTeamKeys?: string[];
}

export interface UpdateBoardInput {
  name?: string;
  repositories?: RepositoryInput[];
  linearTeamKeys?: string[];
}

export interface BoardRefusal {
  error: string;
  code: string;
  suggestion?: string;
  field?: string;
  path?: string;
  detail?: string;
}

/** The success line for a created board, shown in a toast. */
export function createdBoardText(board: Pick<Board, "name" | "key">): string {
  return `Created board ${board.name} (${board.key})`;
}
