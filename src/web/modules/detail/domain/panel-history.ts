export interface PanelHistoryState {
  pushed: boolean;
  pendingBack: number;
}

export const INITIAL_PANEL_HISTORY: PanelHistoryState = {
  pushed: false,
  pendingBack: 0,
};

/** The state after the takeover panel pushes its history entry. */
export function panelHistoryPushed(
  state: PanelHistoryState,
): PanelHistoryState {
  return { ...state, pushed: true };
}

/**
 * Leave the takeover entry: the panel calls `history.back()` itself when `back` is true.
 *
 * @remarks The back the panel causes fires a popstate too, so the counter records it for
 * {@link panelHistoryPopped} to ignore.
 */
export function panelHistoryLeft(state: PanelHistoryState): {
  state: PanelHistoryState;
  back: boolean;
} {
  if (!state.pushed) return { state, back: false };
  return {
    state: { pushed: false, pendingBack: state.pendingBack + 1 },
    back: true,
  };
}

/**
 * Handle a popstate: `close` is true only for a user back on the panel's own entry.
 *
 * @remarks A popstate that echoes a back the panel caused only lowers the counter, so a card
 * switch in takeover never closes the new card.
 */
export function panelHistoryPopped(state: PanelHistoryState): {
  state: PanelHistoryState;
  close: boolean;
} {
  if (state.pendingBack > 0) {
    return {
      state: { ...state, pendingBack: state.pendingBack - 1 },
      close: false,
    };
  }
  if (!state.pushed) return { state, close: false };
  return { state: { ...state, pushed: false }, close: true };
}
