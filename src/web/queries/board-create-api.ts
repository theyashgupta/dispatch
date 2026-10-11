import type {
  BoardRefusal,
  CreateBoardInput,
} from "../../shared/board-create.js";
import type { Board } from "../../shared/types.js";
import { http, type ApiFailure } from "@/lib/http";

export type BoardRequestResult<T> =
  { ok: true; data: T } | ({ ok: false } & BoardRefusal);

export type CreateBoardResult =
  { ok: true; board: Board; link: string } | ({ ok: false } & BoardRefusal);

const BOARD_ERROR_COPY: Record<string, string> = {
  "board-archived": "This board is archived.",
  "invalid-base-branch": "Enter a valid branch name.",
  "invalid-check-command": "Enter a valid check command.",
  "invalid-linear-team-keys":
    "Team keys use capital letters and digits, like ENG.",
  "invalid-repository": "Enter the path of a git repository.",
  "unsupported-field": "This field cannot be changed.",
};

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The copy for a server error text: the UI copy of a schema code, else the text as is. */
export function boardErrorText(raw: string): string {
  return Object.hasOwn(BOARD_ERROR_COPY, raw) ? BOARD_ERROR_COPY[raw] : raw;
}

/**
 * Read a board refusal from a failed response.
 *
 * @remarks The body `code`, `suggestion`, `field`, `path` and `detail` pass on, so a form can place the copy
 * on its field.
 */
export function parseBoardRefusal(failure: ApiFailure): BoardRefusal {
  const body = (failure.body ?? {}) as Record<string, unknown>;
  const raw = failure.error;
  const refusal: BoardRefusal = {
    error:
      raw === null
        ? `${failure.status} ${failure.statusText}`.trim()
        : boardErrorText(raw),
    code: text(body.code) ?? raw ?? "unknown",
  };
  for (const key of ["suggestion", "field", "path", "detail"] as const) {
    const value = text(body[key]);
    if (value !== undefined) refusal[key] = value;
  }
  return refusal;
}

/**
 * Send a board request and resolve its data or a typed refusal.
 *
 * @remarks Any non-OK status and any network failure resolve as a refusal, so a caller handles one shape.
 */
export async function boardRequest<T>(
  url: string,
  init: RequestInit,
): Promise<BoardRequestResult<T>> {
  try {
    const result = await http<T>(url, init);
    if (result.ok) return { ok: true, data: result.data };
    return { ok: false, ...parseBoardRefusal(result) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The request failed",
      code: "network",
    };
  }
}

/** Create a board: POST /api/boards. */
export async function createBoard(
  input: CreateBoardInput,
): Promise<CreateBoardResult> {
  const result = await boardRequest<{ board: Board; link: string }>(
    "/api/boards",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.ok
    ? { ok: true, board: result.data.board, link: result.data.link }
    : result;
}
