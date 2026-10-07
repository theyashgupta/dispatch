interface OverlayReturnStore {
  getState: () => { overlayReturn: HTMLElement | null };
  setOverlayReturn: (el: HTMLElement | null) => void;
}

/** Remember the focused element as the overlay's return target, then open the overlay. */
export function openOverlay(store: OverlayReturnStore, open: () => void): void {
  store.setOverlayReturn(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  open();
}

/**
 * Close an overlay and return focus to the element it opened from.
 *
 * @remarks Focus stays put when the overlay ran a command, because the command moved it on purpose.
 */
export function closeOverlay(
  store: OverlayReturnStore,
  close: () => void,
  ran = false,
): void {
  close();
  const target = store.getState().overlayReturn;
  store.setOverlayReturn(null);
  if (ran !== true && target?.isConnected === true) target.focus();
}
