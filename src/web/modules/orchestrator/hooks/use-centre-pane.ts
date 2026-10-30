import { useCallback } from "react";
import { createModuleState } from "@/components/ui/hooks/module-state";

interface CentrePaneState {
  open: boolean | null;
}

const DEFAULTS: CentrePaneState = { open: null };

const useCentrePaneState = createModuleState<CentrePaneState>(DEFAULTS);

/**
 * Read and set the element above the terminal where the header toolbar shows its failure alert at 768 px and wider.
 *
 * @remarks The header and the pane render in different slots, so the toolbar portals its alert into this element and the alert never covers the terminal.
 */
export const useCentreAlertSlot = createModuleState<HTMLElement | null>(null);

/**
 * Read the shared open choice of the terminal pane, with its setter and a reset to unset.
 *
 * @remarks
 * The toolbar, the canvas container and the pane container read one module store, so none imports another.
 * The canvas container resets on unmount, so every entry to the centre page starts with the pane unset, and the terminal state then decides whether it shows.
 */
export function useCentrePane() {
  const [state, set] = useCentrePaneState();
  const setOpen = useCallback((open: boolean) => set({ open }), [set]);
  const reset = useCallback(() => set(DEFAULTS), [set]);
  return { ...state, setOpen, reset };
}
