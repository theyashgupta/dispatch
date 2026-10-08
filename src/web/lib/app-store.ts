import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import { DONE_PAGE_SIZE } from "../../shared/done-limit.js";
import { pinFromBoard, type PinnedCard } from "../../shared/pinned-card.js";
import type { Page } from "../../shared/route.js";
import type { CardSearchResult } from "../../shared/search.js";
import { stubToCard } from "../../shared/search-stub.js";
import type { StartRequest } from "../../shared/start-request.js";
import type {
  BoardKey,
  Card,
  ConnectionStatus,
  SetupChecks,
  TunnelState,
} from "../../shared/types.js";
import {
  IDLE_TOAST,
  reduceUndoToast,
  type UndoToastAction,
  type UndoToastState,
} from "../../shared/undo-toast.js";

export interface AppState {
  selectedCardId: string | null;
  pinned: PinnedCard | null;
  pinnedHydrating: boolean;
  pinFetchError: { id: string; kind: "not-found" | "network" } | null;
  pinFetch: { id: string; gen: number } | null;
  board: BoardKey;
  doneLimit: number;
  start: StartRequest | null;
  groupStart: Card[] | null;
  selectionResetToken: number;
  cleanupCardId: string | null;
  resetCardId: string | null;
  syncCardId: string | null;
  createTicketOpen: boolean;
  meetingNotesOpen: boolean;
  overlayReturn: HTMLElement | null;
  setupWizard: SetupChecks | null;
  setupRuns: number;
  soundEnabled: boolean;
  errorsInFeeds: boolean;
  tunnelState: TunnelState;
  connection: ConnectionStatus;
  activityOpen: boolean;
  toast: UndoToastState;
  toastSeq: number;
}

const DEFAULT_STATE: AppState = {
  selectedCardId: null,
  pinned: null,
  pinnedHydrating: false,
  pinFetchError: null,
  pinFetch: null,
  board: DEFAULT_BOARD_KEY,
  doneLimit: DONE_PAGE_SIZE,
  start: null,
  groupStart: null,
  selectionResetToken: 0,
  cleanupCardId: null,
  resetCardId: null,
  syncCardId: null,
  createTicketOpen: false,
  meetingNotesOpen: false,
  overlayReturn: null,
  setupWizard: null,
  setupRuns: 0,
  soundEnabled: true,
  errorsInFeeds: false,
  tunnelState: { status: "off" },
  connection: "connecting",
  activityOpen: false,
  toast: IDLE_TOAST,
  toastSeq: 0,
};

const CLOSED_PANEL = {
  selectedCardId: null,
  pinned: null,
  pinnedHydrating: false,
} satisfies Partial<AppState>;

/**
 * Create the store for the UI state that several modules or the shell share.
 *
 * @remarks Every action goes through one `set`, which changes nothing and notifies no listener
 * when each patched field is `Object.is` equal to its current value. Readers select one field, so
 * a same-value no-op never re-renders them.
 */
export function createAppStore(initial: Partial<AppState> = {}) {
  let state: AppState = { ...DEFAULT_STATE, ...initial };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<AppState>): void => {
    const keys = Object.keys(patch) as (keyof AppState)[];
    if (keys.every((key) => Object.is(state[key], patch[key]))) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const nextPinFetch = (id: string) => ({
    id,
    gen: (state.pinFetch?.gen ?? 0) + 1,
  });

  const toast = (action: UndoToastAction): void =>
    set({ toast: reduceUndoToast(state.toast, action) });

  return {
    getState: (): AppState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    selectCard: (id: string | null, live: PinnedCard | null): void =>
      set(
        id != null && live != null
          ? { selectedCardId: id, pinned: live }
          : { selectedCardId: id },
      ),
    openSearchResult: (result: CardSearchResult, inWindow: boolean): void =>
      set(
        inWindow
          ? { selectedCardId: result.id, pinned: null, pinnedHydrating: false }
          : {
              selectedCardId: result.id,
              pinned: {
                card: stubToCard(result, state.board),
                kind: "stub",
                members: [],
              },
              pinnedHydrating: true,
              pinFetch: nextPinFetch(result.id),
            },
      ),
    openPushCard: (id: string): void =>
      set({
        selectedCardId: id,
        pinnedHydrating: true,
        pinFetch: nextPinFetch(id),
      }),
    retryPinFetch: (): void => {
      if (state.selectedCardId == null) return;
      set({
        pinnedHydrating: true,
        pinFetch: nextPinFetch(state.selectedCardId),
      });
    },
    pinFetched: (
      gen: number,
      result: { card: Card; members: Card[] } | null,
    ): void => {
      const pending = state.pinFetch;
      if (pending == null || pending.gen !== gen) return;
      set(
        result != null
          ? {
              pinned: {
                card: result.card,
                kind: "hydrated",
                members: result.members,
              },
              pinFetchError: null,
              pinnedHydrating: false,
            }
          : {
              pinFetchError: { id: pending.id, kind: "not-found" },
              pinnedHydrating: false,
            },
      );
    },
    pinFetchFailed: (gen: number): void => {
      const pending = state.pinFetch;
      if (pending == null || pending.gen !== gen) return;
      set({
        pinFetchError: { id: pending.id, kind: "network" },
        pinnedHydrating: false,
      });
    },
    boardUpdated: (cards: Card[]): void => {
      const live = pinFromBoard(state.selectedCardId, cards);
      if (live != null) set({ pinned: live });
    },
    closePanel: (): void => set(CLOSED_PANEL),
    deselect: (id: string): void => {
      if (state.selectedCardId === id) set({ selectedCardId: null });
    },
    pageChanged: (page: Page): void =>
      set({
        ...(page !== "workspace" ? CLOSED_PANEL : {}),
        ...(page !== "board" ? { groupStart: null } : {}),
      }),

    setBoard: (board: BoardKey): void =>
      set(
        board === state.board
          ? { board }
          : { board, doneLimit: DONE_PAGE_SIZE },
      ),

    loadMoreDone: (): void =>
      set({ doneLimit: state.doneLimit + DONE_PAGE_SIZE }),

    requestStart: (
      req: string | StartRequest,
      card: Card | undefined,
    ): void => {
      if (card == null || card.groupId != null) return;
      const wantsNewSession =
        typeof req !== "string" && req.newSession === true;
      if (
        !wantsNewSession &&
        card.column !== "todo" &&
        card.sessionLost !== true
      ) {
        return;
      }
      set({ start: typeof req === "string" ? { cardId: req } : req });
    },
    openStart: (req: StartRequest): void => set({ start: req }),
    closeStart: (): void => set({ start: null }),
    openGroupStart: (members: Card[]): void => set({ groupStart: members }),
    closeGroupStart: (): void => set({ groupStart: null }),
    groupStarted: (): void =>
      set({ selectionResetToken: state.selectionResetToken + 1 }),
    openCleanup: (id: string): void => set({ cleanupCardId: id }),
    closeCleanup: (): void => set({ cleanupCardId: null }),
    openReset: (id: string): void => set({ resetCardId: id }),
    closeReset: (): void => set({ resetCardId: null }),
    openSync: (id: string): void => set({ syncCardId: id }),
    closeSync: (): void => set({ syncCardId: null }),
    openCreateTicket: (): void => set({ createTicketOpen: true }),
    closeCreateTicket: (): void => set({ createTicketOpen: false }),
    openMeetingNotes: (): void => set({ meetingNotesOpen: true }),
    closeMeetingNotes: (): void => set({ meetingNotesOpen: false }),
    setOverlayReturn: (el: HTMLElement | null): void =>
      set({ overlayReturn: el }),
    openSetupWizard: (checks: SetupChecks): void =>
      set({ setupWizard: checks }),
    closeSetupWizard: (linearChanged: boolean): void =>
      set(
        linearChanged
          ? { setupWizard: null, setupRuns: state.setupRuns + 1 }
          : { setupWizard: null },
      ),

    setSoundEnabled: (on: boolean): void => set({ soundEnabled: on }),
    setErrorsInFeeds: (on: boolean): void => set({ errorsInFeeds: on }),
    setTunnelState: (tunnelState: TunnelState): void => set({ tunnelState }),
    setConnection: (connection: ConnectionStatus): void => set({ connection }),
    setActivityOpen: (open: boolean): void => set({ activityOpen: open }),

    showUndo: (label: string, undo: () => Promise<void>): void => {
      const id = state.toastSeq + 1;
      set({
        toastSeq: id,
        toast: reduceUndoToast(state.toast, {
          type: "show",
          toast: { id, label, undo },
        }),
      });
    },
    notice: (text: string): void => toast({ type: "notice", error: text }),
    toastUndo: (id: number): void => toast({ type: "undo", id }),
    toastUndone: (id: number): void => toast({ type: "undone", id }),
    toastFailed: (id: number, error: string): void =>
      toast({ type: "failed", id, error }),
    dismissToast: (): void => toast({ type: "dismiss" }),
  };
}

export type AppStore = ReturnType<typeof createAppStore>;
