import { useCallback, useEffect, useReducer } from "react";
import type { ArchivedGroupSummary } from "../../shared/types.js";
import { restoreArchived } from "../lib/api.js";

export const UNDO_TOAST_MS = 10_000;

export interface UndoToastState {
  archived: ArchivedGroupSummary | null;
  undoing: boolean;
  error: string | null;
}

export type UndoToastAction =
  | { type: "show"; archived: ArchivedGroupSummary }
  | { type: "notice"; error: string }
  | { type: "undo"; id: string }
  | { type: "undone"; id: string }
  | { type: "failed"; id: string; error: string }
  | { type: "dismiss" };

export const IDLE_TOAST: UndoToastState = {
  archived: null,
  undoing: false,
  error: null,
};

/**
 * The undo toast's state machine (LOCAL-17): a fresh `show` replaces whatever was on screen, a
 * failed undo keeps the toast open with the server's reason, and `dismiss` always clears it.
 * @remarks Undo outcomes carry the archive id they were started for and are ignored when a later
 * `show` has replaced the toast, so a slow restore can never dismiss or mislabel another group's toast.
 */
export function reduceUndoToast(
  state: UndoToastState,
  action: UndoToastAction,
): UndoToastState {
  switch (action.type) {
    case "show":
      return { archived: action.archived, undoing: false, error: null };
    case "notice":
      return { archived: null, undoing: false, error: action.error };
    case "undo":
      return state.archived?.id === action.id
        ? { ...state, undoing: true, error: null }
        : state;
    case "undone":
      return state.archived?.id === action.id ? IDLE_TOAST : state;
    case "failed":
      return state.archived?.id === action.id
        ? { ...state, undoing: false, error: action.error }
        : state;
    case "dismiss":
      return IDLE_TOAST;
  }
}

/** The toast's one-line copy for an unwound group. */
export function undoToastCopy(archived: ArchivedGroupSummary): string {
  const n = archived.members.length;
  const where = archived.destination === "inbox" ? "Inbox" : "To Do";
  return `Unwound ${archived.identifier}: ${n} ticket${n === 1 ? "" : "s"} sent to ${where}`;
}

/** True while the toast has something to display. */
export function isToastVisible(state: UndoToastState): boolean {
  return state.archived != null || state.error != null;
}

/**
 * Drive the undo toast: `show` after an unwind, `undo` calls Restore and closes on success,
 * `notice` shows a plain message with no Undo (a refused unwind), and anything visible dismisses
 * on its own after {@link UNDO_TOAST_MS} unless an undo is in flight.
 */
export function useUndoToast(): {
  state: UndoToastState;
  show: (archived: ArchivedGroupSummary) => void;
  notice: (error: string) => void;
  undo: () => void;
  dismiss: () => void;
} {
  const [state, dispatch] = useReducer(reduceUndoToast, IDLE_TOAST);

  useEffect(() => {
    if (!isToastVisible(state) || state.undoing) return;
    const timer = setTimeout(
      () => dispatch({ type: "dismiss" }),
      UNDO_TOAST_MS,
    );
    return () => clearTimeout(timer);
  }, [state]);

  const undo = useCallback(() => {
    const archived = state.archived;
    if (!archived || state.undoing) return;
    const id = archived.id;
    dispatch({ type: "undo", id });
    void restoreArchived(id)
      .then((result) => {
        if (result.ok) dispatch({ type: "undone", id });
        else dispatch({ type: "failed", id, error: result.error });
      })
      .catch((err: unknown) => {
        console.error("restoreArchived failed", err);
        dispatch({ type: "failed", id, error: "Couldn't restore this group." });
      });
  }, [state.archived, state.undoing]);

  return {
    state,
    show: useCallback(
      (archived: ArchivedGroupSummary) => dispatch({ type: "show", archived }),
      [],
    ),
    notice: useCallback(
      (error: string) => dispatch({ type: "notice", error }),
      [],
    ),
    undo,
    dismiss: useCallback(() => dispatch({ type: "dismiss" }), []),
  };
}
