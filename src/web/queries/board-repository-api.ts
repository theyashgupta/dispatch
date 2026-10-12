import type { BoardRefusal } from "../../shared/board-create.js";
import type { Board, BoardKey } from "../../shared/types.js";
import { boardRequest } from "./board-create-api.js";

export type InitRepositoryResult =
  { ok: true; board: Board } | ({ ok: false } & BoardRefusal);

/** Make a git repository in the board folder: POST /api/boards/:key/repositories/init. */
export async function initBoardRepository(
  key: BoardKey,
): Promise<InitRepositoryResult> {
  const result = await boardRequest<{ board: Board }>(
    `/api/boards/${encodeURIComponent(key)}/repositories/init`,
    { method: "POST" },
  );
  return result.ok ? { ok: true, board: result.data.board } : result;
}
