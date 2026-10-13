import type { Board, BoardKey } from "../../../../shared/types.js";
import type {
  BoardRefusal,
  UpdateBoardInput,
} from "../../../../shared/board-create.js";
import { http, httpError } from "@/lib/http";
import { boardRequest } from "@/queries/board-create-api";

export type BoardWriteResult =
  { ok: true; board: Board } | ({ ok: false } & BoardRefusal);

async function send(url: string, init: RequestInit): Promise<BoardWriteResult> {
  const result = await boardRequest<{ board: Board }>(url, init);
  return result.ok ? { ok: true, board: result.data.board } : result;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Read one board with its resolved folders: GET /api/boards/:key.
 *
 * @remarks A 404 or a 400 resolves `null`: the route reads only the key, so a 400 means the key is
 * not a valid key and no board has it.
 */
export async function getBoardDetail(key: BoardKey): Promise<Board | null> {
  const result = await http<{ board: Board }>(
    `/api/boards/${encodeURIComponent(key)}`,
  );
  if (!result.ok) {
    if (result.status === 404 || result.status === 400) return null;
    throw httpError("getBoardDetail", result);
  }
  return result.data.board;
}

/** Change a board: PATCH /api/boards/:key. */
export async function updateBoard(
  key: BoardKey,
  input: UpdateBoardInput,
): Promise<BoardWriteResult> {
  return send(
    `/api/boards/${encodeURIComponent(key)}`,
    jsonInit("PATCH", input),
  );
}

/** Archive a board: POST /api/boards/:key/archive. */
export async function archiveBoard(key: BoardKey): Promise<BoardWriteResult> {
  return send(`/api/boards/${encodeURIComponent(key)}/archive`, {
    method: "POST",
  });
}

/** Restore an archived board: POST /api/boards/:key/restore. */
export async function restoreBoard(key: BoardKey): Promise<BoardWriteResult> {
  return send(`/api/boards/${encodeURIComponent(key)}/restore`, {
    method: "POST",
  });
}
