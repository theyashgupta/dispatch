import { ASK_LIMITS, type AskTurn } from "../../../../shared/types.js";

export type AskErrorKind = "busy" | "timeout" | "failed" | "invalid";

export interface AskState {
  turns: AskTurn[];
  pending: string | null;
  error: AskErrorKind | null;
}

export type AskEvent =
  | { type: "send"; question: string }
  | { type: "answer"; answer: string }
  | { type: "fail"; error: AskErrorKind }
  | { type: "cancel" }
  | { type: "retry" }
  | { type: "clear" };

export const EMPTY_ASK_STATE: AskState = {
  turns: [],
  pending: null,
  error: null,
};

/**
 * Apply one conversation event; a send while a run is pending returns the state unchanged.
 *
 * @remarks Retry drops the unanswered user turn so the resend appends it once, not twice.
 */
export function askReducer(state: AskState, event: AskEvent): AskState {
  switch (event.type) {
    case "send":
      if (state.pending !== null) return state;
      return {
        turns: [...state.turns, { role: "user", text: event.question }],
        pending: event.question,
        error: null,
      };
    case "answer":
      return {
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
      return EMPTY_ASK_STATE;
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
