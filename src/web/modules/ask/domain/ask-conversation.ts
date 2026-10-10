import { ASK_LIMITS, type AskTurn } from "../../../../shared/types.js";

export type AskErrorKind = "busy" | "timeout" | "failed" | "invalid";

export interface AskState {
  turns: AskTurn[];
  pending: string | null;
  error: AskErrorKind | null;
  pendingBoardName: boolean;
  generation: number;
}

export type AskEvent =
  | { type: "send"; question: string }
  | { type: "answer"; answer: string }
  | { type: "fail"; error: AskErrorKind }
  | { type: "cancel" }
  | { type: "retry" }
  | { type: "clear" }
  | { type: "local"; turn: AskTurn; generation?: number }
  | { type: "await-board-name" }
  | { type: "board-name-done" };

export const EMPTY_ASK_STATE: AskState = {
  turns: [],
  pending: null,
  error: null,
  pendingBoardName: false,
  generation: 0,
};

/**
 * Apply one conversation event; a send while a run is pending returns the state unchanged.
 *
 * @remarks Retry drops the unanswered user turn so the resend appends it once, not twice. A local
 * turn is dropped while a run is pending, because it would land between a question and its answer,
 * and when it carries a `generation` that clear has since bumped.
 */
export function askReducer(state: AskState, event: AskEvent): AskState {
  switch (event.type) {
    case "send":
      if (state.pending !== null) return state;
      return {
        ...state,
        turns: [...state.turns, { role: "user", text: event.question }],
        pending: event.question,
        error: null,
        pendingBoardName: false,
      };
    case "answer":
      return {
        ...state,
        turns: [...state.turns, { role: "assistant", text: event.answer }],
        pending: null,
        error: null,
      };
    case "fail":
      return { ...state, pending: null, error: event.error };
    case "cancel":
      return state.pending === null ? state : { ...state, pending: null };
    case "retry":
      if (state.error === null) return state;
      return { ...state, turns: state.turns.slice(0, -1), error: null };
    case "clear":
      return { ...EMPTY_ASK_STATE, generation: state.generation + 1 };
    case "local":
      if (state.pending !== null) return state;
      if (
        event.generation !== undefined &&
        event.generation !== state.generation
      ) {
        return state;
      }
      return { ...state, turns: [...state.turns, event.turn], error: null };
    case "await-board-name":
      return state.pendingBoardName
        ? state
        : { ...state, pendingBoardName: true };
    case "board-name-done":
      return state.pendingBoardName
        ? { ...state, pendingBoardName: false }
        : state;
  }
}

/**
 * Return the history a send carries: the newest `ASK_LIMITS.turns` turns, each clipped to
 * `ASK_LIMITS.turnText` characters.
 *
 * @remarks The server refuses a longer turn, so one long answer would otherwise fail every
 * later question until Clear.
 */
export function askHistory(turns: readonly AskTurn[]): AskTurn[] {
  return turns
    .slice(-ASK_LIMITS.turns)
    .map((turn) =>
      turn.text.length > ASK_LIMITS.turnText
        ? { ...turn, text: turn.text.slice(0, ASK_LIMITS.turnText) }
        : turn,
    );
}
