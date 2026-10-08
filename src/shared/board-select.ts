import { DEFAULT_BOARD_KEY, parseBoardKey } from "./board-key.js";
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

/** True when more than one board is active, which shows the switcher and the board names (U3-09, U3-12). */
export function hasManyBoards(boards: readonly BoardEntry[]): boolean {
  return boards.filter((board) => !board.archived).length > 1;
}

/** True when the board counts poll runs: more than one active board, or the boards page is open (U3-05). */
export function shouldPollCounts(
  boards: readonly BoardEntry[],
  onBoardsPage: boolean,
): boolean {
  return onBoardsPage || hasManyBoards(boards);
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
