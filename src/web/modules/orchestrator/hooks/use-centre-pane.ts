import { useSyncExternalStore } from "react";

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

const listeners = new Set<() => void>();
let state = DEFAULTS;

function update(next: Partial<CentrePaneState>) {
  state = { ...state, ...next };
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function read(): CentrePaneState {
  return state;
}

function setPage(page: CentrePaneState["page"]) {
  update({ page });
}

function setPane(pane: CentrePaneState["pane"]) {
  update({ pane });
}

function requestCommentFocus() {
  update({ page: "conversation", pane: "conversation", focusPending: true });
}

function takeCommentFocus(): boolean {
  const pending = state.focusPending;
  if (pending) update({ focusPending: false });
  return pending;
}

/**
 * Restore the default page, pane and focus request.
 *
 * @remarks The centre page calls this on leave, so the next visit opens on Branches below 768 px and on Conversation in the pane.
 */
export function resetCentrePane() {
  state = DEFAULTS;
  for (const notify of listeners) notify();
}

/**
 * Read the shared page tab, pane tab and comment focus request of the command centre, with their setters.
 *
 * @remarks The canvas container and the pane container read one module store, so neither imports the other. `takeCommentFocus` returns the pending request and clears it, so one Enter focuses the box once.
 */
export function useCentrePane() {
  const snapshot = useSyncExternalStore(subscribe, read);
  return {
    ...snapshot,
    setPage,
    setPane,
    requestCommentFocus,
    takeCommentFocus,
  };
}
