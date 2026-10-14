import { useCallback } from "react";
import { createModuleState } from "@/components/ui/hooks/module-state";

interface CentrePaneState {
  page: "branches" | "conversation";
  pane: "conversation" | "terminal";
  focusPending: boolean;
}

const DEFAULTS: CentrePaneState = {
  page: "branches",
  pane: "conversation",
  focusPending: false,
};

const useCentrePaneState = createModuleState<CentrePaneState>(DEFAULTS);

/**
 * Read and set the element below the pane tabs where the header toolbar shows its failure alert at 768 px and wider.
 *
 * @remarks The header and the pane render in different slots, so the toolbar portals its alert into this element and the alert never covers the tabs.
 */
export const useCentreAlertSlot = createModuleState<HTMLElement | null>(null);

/**
 * Read the shared page tab, pane tab and comment focus request of the command centre, with their setters.
 *
 * @remarks
 * The canvas container and the pane container read one module store, so neither imports the other.
 */
export function useCentrePane() {
  const [state, set] = useCentrePaneState();
  const reset = useCallback(() => set(DEFAULTS), [set]);
  return {
    ...state,
    setPage: (page: string) =>
      set({
        ...state,
        page: page === "conversation" ? "conversation" : "branches",
      }),
    setPane: (pane: string) =>
      set({
        ...state,
        pane: pane === "terminal" ? "terminal" : "conversation",
      }),
    requestCommentFocus: () =>
      set({ page: "conversation", pane: "conversation", focusPending: true }),
    takeCommentFocus: (): boolean => {
      if (state.focusPending) set({ ...state, focusPending: false });
      return state.focusPending;
    },
    reset,
  };
}
