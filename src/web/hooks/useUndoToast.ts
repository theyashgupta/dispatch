import { useCallback, useEffect, useReducer, useRef } from "react";
import { toast } from "sonner";
import type { ArchivedGroupSummary } from "../../shared/types.js";

export const UNDO_TOAST_MS = 10_000;

const SONNER_TOAST_ID = "undo-toast";

export interface UndoToastEntry {
  id: number;
  label: string;
  undo: () => Promise<void>;
}

export interface UndoToastState {
  toast: UndoToastEntry | null;
  undoing: boolean;
  error: string | null;
}

export type UndoToastAction =
  | { type: "show"; toast: UndoToastEntry }
  | { type: "notice"; error: string }
  | { type: "undo"; id: number }
  | { type: "undone"; id: number }
  | { type: "failed"; id: number; error: string }
  | { type: "dismiss" };

export const IDLE_TOAST: UndoToastState = {
  toast: null,
  undoing: false,
  error: null,
};

/**
 * The undo toast's state machine (LOCAL-17).
 *
 * @remarks A fresh `show` replaces whatever was on screen, a failed undo keeps the toast open with
 * the reason, and `dismiss` always clears it. Undo outcomes carry the id of the toast they started
 * for and are ignored once a later `show` replaced it, and a second undo while one is in flight is
 * a no-op.
 */
export function reduceUndoToast(
  state: UndoToastState,
  action: UndoToastAction,
): UndoToastState {
  switch (action.type) {
    case "show":
      return { toast: action.toast, undoing: false, error: null };
    case "notice":
      return { toast: null, undoing: false, error: action.error };
    case "undo":
      return state.toast?.id === action.id && !state.undoing
        ? { ...state, undoing: true, error: null }
        : state;
    case "undone":
      return state.toast?.id === action.id ? IDLE_TOAST : state;
    case "failed":
      return state.toast?.id === action.id
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
  return state.toast != null || state.error != null;
}

export interface UndoToastView {
  label: string;
  description: string | undefined;
  undoable: boolean;
}

/**
 * Map an undo toast state to what Sonner shows, or null when nothing is visible.
 *
 * @remarks The description is the failure text and only appears next to a toast, so a notice
 * shows its text as the label.
 */
export function undoToastView(state: UndoToastState): UndoToastView | null {
  const label = state.toast?.label ?? state.error;
  if (label == null) return null;
  return {
    label,
    description: state.toast ? (state.error ?? undefined) : undefined,
    undoable: state.toast != null,
  };
}

/**
 * Drive the undo toast.
 *
 * @remarks `show(label, undo)` offers Undo and `undo` runs the closure, closing on success;
 * `notice` shows a plain message with no Undo. Anything visible dismisses on its own after
 * {@link UNDO_TOAST_MS} unless an undo is in flight.
 */
export function useUndoToast(): {
  show: (label: string, undo: () => Promise<void>) => void;
  notice: (error: string) => void;
} {
  const [state, dispatch] = useReducer(reduceUndoToast, IDLE_TOAST);
  const nextId = useRef(0);

  useEffect(() => {
    if (!isToastVisible(state) || state.undoing) return;
    const timer = setTimeout(
      () => dispatch({ type: "dismiss" }),
      UNDO_TOAST_MS,
    );
    return () => clearTimeout(timer);
  }, [state]);

  const mirrored = useRef(false);
  const undoInFlight = useRef<number | null>(null);

  const undo = useCallback(() => {
    const entry = state.toast;
    if (!entry || state.undoing || undoInFlight.current === entry.id) return;
    const id = entry.id;
    undoInFlight.current = id;
    dispatch({ type: "undo", id });
    entry.undo().then(
      () => {
        undoInFlight.current = null;
        dispatch({ type: "undone", id });
      },
      (err: unknown) => {
        undoInFlight.current = null;
        console.error("undo failed", err);
        dispatch({
          type: "failed",
          id,
          error: err instanceof Error ? err.message : "Couldn't undo.",
        });
      },
    );
  }, [state.toast, state.undoing]);

  useEffect(() => {
    const view = undoToastView(state);
    if (view === null) {
      mirrored.current = false;
      toast.dismiss(SONNER_TOAST_ID);
      return;
    }
    mirrored.current = true;
    toast(view.label, {
      id: SONNER_TOAST_ID,
      description: view.description,
      duration: Infinity,
      closeButton: true,
      action: view.undoable
        ? {
            label: state.undoing ? "Undo…" : "Undo",
            onClick: (event) => {
              event.preventDefault();
              undo();
            },
          }
        : undefined,
      onDismiss: () => {
        if (mirrored.current) dispatch({ type: "dismiss" });
      },
    });
  }, [state, undo]);

  return {
    show: useCallback((label: string, undo: () => Promise<void>) => {
      nextId.current += 1;
      dispatch({ type: "show", toast: { id: nextId.current, label, undo } });
    }, []),
    notice: useCallback(
      (error: string) => dispatch({ type: "notice", error }),
      [],
    ),
  };
}
