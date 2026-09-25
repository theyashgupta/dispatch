import { useSyncExternalStore } from "react";
import { ASK_LIMITS, type AskTurn } from "../../shared/types.js";
import { askQuestion, type AskResult } from "../lib/api.js";

export type AskErrorKind = Extract<AskResult, { ok: false }>["error"];

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

const EMPTY: AskState = { turns: [], pending: null, error: null };

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
      return EMPTY;
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

let state = EMPTY;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function dispatch(event: AskEvent): void {
  const next = askReducer(state, event);
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function send(question: string): Promise<void> {
  const text = question.trim();
  if (text === "" || state.pending !== null) return;
  const history = askHistory(state.turns);
  dispatch({ type: "send", question: text });
  const run = new AbortController();
  controller = run;
  let result: AskResult;
  try {
    result = await askQuestion(text, history, run.signal);
  } catch {
    result = { ok: false, error: "failed" };
  }
  if (controller !== run) return;
  controller = null;
  dispatch(
    result.ok
      ? { type: "answer", answer: result.answer }
      : { type: "fail", error: result.error },
  );
}

function cancel(): void {
  controller?.abort();
  controller = null;
  dispatch({ type: "cancel" });
}

function clear(): void {
  cancel();
  dispatch({ type: "clear" });
}

function retry(): Promise<void> {
  const last = state.turns.at(-1);
  if (state.error === null || last?.role !== "user") return Promise.resolve();
  dispatch({ type: "retry" });
  return send(last.text);
}

export const askStore = {
  getState: () => state,
  subscribe,
  send,
  cancel,
  clear,
  retry,
};

/**
 * Expose the Ask conversation, kept in a module store so it survives page switches and ends on
 * reload.
 */
export function useAsk(): AskState & {
  send: (question: string) => void;
  cancel: () => void;
  clear: () => void;
  retry: () => void;
} {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  return {
    ...snapshot,
    send: (question) => void send(question),
    cancel,
    clear,
    retry: () => void retry(),
  };
}
