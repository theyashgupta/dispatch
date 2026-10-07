import type { Board, BoardKey } from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";
import type {
  CreateBoardInput,
  UpdateBoardInput,
} from "@/modules/boards/domain/board-form";

export type BoardWriteResult =
  { ok: true; board: Board } | { ok: false; error: string };

const ERROR_COPY: Record<string, string> = {
  "invalid-base-branch": "Enter a valid branch name.",
  "invalid-check-command": "Enter a valid check command.",
  "invalid-linear-team-keys":
    "Team keys use capital letters and digits, like ENG.",
  "invalid-repository": "Enter the path of a git repository.",
  "unsupported-field": "This field cannot be changed.",
};

/**
 * Send a board write and map the response to a result.
 *
 * @remarks A refusal is a 4xx with `{ error }`. A schema code maps to its copy and any other text
 * passes through as is; a response with no readable error falls back to the status line. A network
 * failure resolves as a refusal too, so a caller handles one shape.
 */
async function send(url: string, init: RequestInit): Promise<BoardWriteResult> {
  try {
    const result = await http<{ board: Board }>(url, init);
    if (result.ok) return { ok: true, board: result.data.board };
    const text = result.error;
    return {
      ok: false,
      error:
        (text !== null && Object.hasOwn(ERROR_COPY, text)
          ? ERROR_COPY[text]
          : undefined) ??
        text ??
        `${result.status} ${result.statusText}`.trim(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The request failed",
    };
  }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Read one board with its resolved folders: GET /api/boards/:key. */
export async function getBoardDetail(key: BoardKey): Promise<Board> {
  const result = await http<{ board: Board }>(
    `/api/boards/${encodeURIComponent(key)}`,
  );
  if (!result.ok) throw httpError("getBoardDetail", result);
  return result.data.board;
}

/** Create a board: POST /api/boards. */
export async function createBoard(
  input: CreateBoardInput,
): Promise<BoardWriteResult> {
  return send("/api/boards", jsonInit("POST", input));
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
