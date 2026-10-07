import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  UNDO_TOAST_MS,
  isToastVisible,
  undoToastView,
  type UndoToastState,
} from "../../../../shared/undo-toast.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";

const SONNER_TOAST_ID = "undo-toast";

interface UndoToastStore {
  subscribe: (listener: () => void) => () => void;
  getState: () => { toast: UndoToastState };
  toastUndo: (id: number) => void;
  toastUndone: (id: number) => void;
  toastFailed: (id: number, error: string) => void;
  dismissToast: () => void;
}

/**
 * Show the shared undo toast through Sonner, dismiss it after {@link UNDO_TOAST_MS} and run its Undo.
 *
 * @remarks The toast state lives in the app store so any module can show one; only the shell calls
 * this hook, so one timer and one Sonner mirror exist. The timer pauses while an undo is in flight.
 */
export function useUndoToast(store: UndoToastStore): void {
  const state = useAppStore(store, (s) => s.toast);
  const mirrored = useRef(false);
  const undoInFlight = useRef<number | null>(null);

  useEffect(() => {
    if (!isToastVisible(state) || state.undoing) return;
    const timer = setTimeout(() => store.dismissToast(), UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [state, store]);

  const undo = useCallback(() => {
    const entry = state.toast;
    if (!entry || state.undoing || undoInFlight.current === entry.id) return;
    const id = entry.id;
    undoInFlight.current = id;
    store.toastUndo(id);
    entry.undo().then(
      () => {
        undoInFlight.current = null;
        store.toastUndone(id);
      },
      (err: unknown) => {
        undoInFlight.current = null;
        console.error("undo failed", err);
        store.toastFailed(
          id,
          err instanceof Error ? err.message : "Couldn't undo.",
        );
      },
    );
  }, [state.toast, state.undoing, store]);

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
        if (mirrored.current) store.dismissToast();
      },
    });
  }, [state, undo, store]);
}
