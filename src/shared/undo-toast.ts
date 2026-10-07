import type { ArchivedGroupSummary } from "./types.js";

export const UNDO_TOAST_MS = 10_000;

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
