import { DEFAULT_BOARD_KEY, parseBoardKey } from "./board-key.js";
import { parseRoute } from "./route.js";
import type { Board, BoardKey } from "./types.js";

export type BoardEntry = Pick<Board, "key" | "archived">;

export interface BoardChoice {
  key: BoardKey;
  unavailable: string | null;
}

function activeBoard(
  key: unknown,
  boards: readonly BoardEntry[],
): BoardKey | null {
  return (
    boards.find((board) => board.key === key && !board.archived)?.key ?? null
  );
}

/**
 * Resolve the `board` search parameter to the board the app shows (U3-02).
 *
 * @remarks While the board list is still loading, a parameter that is a valid board key is trusted
 * as given, so a deep link does not wait for the list. Once the list is known, an unknown or archived key falls back
 * to `LOCAL` and names the rejected key for the toast.
 */
export function selectBoard(
  param: unknown,
  boards: readonly BoardEntry[] | undefined,
): BoardChoice {
  if (param === undefined || param === DEFAULT_BOARD_KEY) {
    return { key: DEFAULT_BOARD_KEY, unavailable: null };
  }
  if (boards === undefined && typeof param === "string") {
    const key = parseBoardKey(param);
    if (key !== null) return { key, unavailable: null };
  }
  const key = boards === undefined ? null : activeBoard(param, boards);
  return key === null
    ? {
        key: DEFAULT_BOARD_KEY,
        unavailable: typeof param === "string" ? param : JSON.stringify(param),
      }
    : { key, unavailable: null };
}

/**
 * The toast text for a rejected `board` parameter.
 *
 * @remarks A value that is not a board key is never echoed, so a crafted link cannot put its own text in the toast.
 */
export function unavailableBoardMessage(unavailable: string): string {
  return parseBoardKey(unavailable) === null
    ? "This board link is not valid."
    : `Board ${unavailable} is not available.`;
}

/** The search parameters of a link to a board: `LOCAL` drops the parameter (U3-03). */
export function boardSearch(board: BoardKey): { board: BoardKey | undefined } {
  return { board: board === DEFAULT_BOARD_KEY ? undefined : board };
}

/** Add the `board` query parameter to an API path, or return it unchanged for `LOCAL` (U3-03). */
export function withBoard(path: string, board: BoardKey): string {
  if (board === DEFAULT_BOARD_KEY) return path;
  return `${path}${path.includes("?") ? "&" : "?"}board=${encodeURIComponent(board)}`;
}

/** The board a card deep link must switch to, or null when the card already belongs to the selected board (U3-13). */
export function cardBoardSwitch(
  cardBoard: BoardKey | undefined,
  selected: BoardKey,
): BoardKey | null {
  const board = cardBoard ?? DEFAULT_BOARD_KEY;
  return board === selected ? null : board;
}

/** The board the bare app entry goes to: the remembered board when it is active and not `LOCAL` (U3-01). */
export function entryBoard(
  remembered: string | null,
  boards: readonly BoardEntry[] | undefined,
): BoardKey | null {
  if (remembered === null || remembered === DEFAULT_BOARD_KEY) return null;
  return boards === undefined ? null : activeBoard(remembered, boards);
}

/** The "Counts from <time>" text when the latest counts refetch failed and older counts stay on screen, else null (U3-07). */
export function staleCountsLabel(counts: {
  isError: boolean;
  data: { at: string } | undefined;
}): string | null {
  if (!counts.isError || counts.data === undefined) return null;
  return `Counts from ${new Date(counts.data.at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * The raw board key in a `/boards/<key>` path, or null for any other path.
 *
 * @remarks The key is not validated here; callers run it through `parseBoardKey`.
 */
export function boardKeyFromPath(pathname: string): string | null {
  return parseRoute(`#${pathname}`).board ?? null;
}

/**
 * Pick the board parameter the root resolves, and whether a `board` search parameter must be stripped.
 *
 * @remarks A key in a `/boards/<key>` path wins, and a keyed path must not carry a `board` search parameter.
 */
export function resolveBoardParam(
  pathname: string,
  searchBoard: unknown,
): { param: unknown; stripSearchBoard: boolean } {
  const pathKey = boardKeyFromPath(pathname);
  if (pathKey === null) return { param: searchBoard, stripSearchBoard: false };
  return { param: pathKey, stripSearchBoard: searchBoard !== undefined };
}
