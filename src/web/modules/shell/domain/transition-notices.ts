import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type {
  BoardSnapshot,
  Card,
  Column,
  ConnectionStatus,
} from "../../../../shared/types.js";
import { needsSeed } from "./transition-seed.js";

export interface NoticeState {
  prev: ReadonlyMap<string, Column>;
  seeded: string | null;
  visibleSince: number;
}

export const INITIAL_NOTICE_STATE: NoticeState = {
  prev: new Map(),
  seeded: null,
  visibleSince: 0,
};

const STALE_NOTICE_MS = 5 * 60_000;

function isAttentionColumn(col: Column): col is "needs_input" | "agent_done" {
  return col === "needs_input" || col === "agent_done";
}

function isFresh(card: Card, cutoff: number): boolean {
  if (card.columnSince === undefined) return true;
  const since = Date.parse(card.columnSince);
  return Number.isNaN(since) || since >= cutoff;
}

/**
 * Clear the seeded board when the connection is not connected, so the next snapshot seeds again.
 */
export function noticeConnection(
  state: NoticeState,
  status: ConnectionStatus,
): NoticeState {
  return status === "connected" ? state : { ...state, seeded: null };
}

/**
 * Record when the tab became visible, so moves made before it count as a missed backlog.
 */
export function noticeVisible(state: NoticeState, at: number): NoticeState {
  return { ...state, visibleSince: at };
}

/**
 * Decide which cards of a snapshot need a notice, and return the next state.
 *
 * @remarks ATTN-01: the first snapshot after a connect or a board change only seeds. Only Needs Input
 * and Agent Done notify, and never for a mirrored group member, so a start or a success never does.
 * A move older than STALE_NOTICE_MS, or made before the tab last became visible, is history, not
 * news; a card with no columnSince counts as fresh.
 */
export function noticeSnapshot(
  state: NoticeState,
  board: BoardSnapshot,
  now: number,
): { state: NoticeState; notices: Card[] } {
  const next = new Map<string, Column>(
    board.cards.map((c) => [c.id, c.column]),
  );

  if (needsSeed(state.seeded, board)) {
    return {
      state: {
        ...state,
        prev: next,
        seeded: board.boardKey ?? DEFAULT_BOARD_KEY,
      },
      notices: [],
    };
  }

  const cutoff = Math.max(now - STALE_NOTICE_MS, state.visibleSince);
  const notices = board.cards.filter(
    (c) =>
      c.groupId == null &&
      c.column !== state.prev.get(c.id) &&
      isAttentionColumn(c.column) &&
      isFresh(c, cutoff),
  );
  return { state: { ...state, prev: next }, notices };
}
