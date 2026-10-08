import assert from "node:assert/strict";
import { test } from "node:test";
import { DONE_PAGE_SIZE } from "../../shared/done-limit.js";
import type { PinnedCard } from "../../shared/pinned-card.js";
import type { CardSearchResult } from "../../shared/search.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import type { Card, SetupChecks } from "../../shared/types.js";
import { IDLE_TOAST } from "../../shared/undo-toast.js";
import { createAppStore, type AppState } from "./app-store.js";

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    boardKey: DEFAULT_BOARD_KEY,
    identifier: id.toUpperCase(),
    title: id,
    column: "todo",
    issueId: "",
    description: null,
    priority: 0,
    updatedAt: new Date(0).toISOString(),
    ...extra,
  };
}

function counted(initial: Partial<AppState> = {}) {
  const store = createAppStore(initial);
  const counter = { calls: 0 };
  store.subscribe(() => counter.calls++);
  return { store, counter };
}

const live: PinnedCard = { card: card("c1"), kind: "hydrated", members: [] };
const result: CardSearchResult = {
  id: "c9",
  identifier: "C9",
  title: "Nine",
  column: "todo",
};
const checks = {
  prerequisites: [],
  node: {},
  storage: {},
} as unknown as SetupChecks;

test("the initial state has the defaults and an initial value overrides one field", () => {
  const state = createAppStore().getState();
  assert.equal(state.selectedCardId, null);
  assert.equal(state.pinned, null);
  assert.equal(state.pinnedHydrating, false);
  assert.equal(state.pinFetchError, null);
  assert.equal(state.pinFetch, null);
  assert.equal(state.doneLimit, DONE_PAGE_SIZE);
  assert.equal(state.start, null);
  assert.equal(state.groupStart, null);
  assert.equal(state.selectionResetToken, 0);
  assert.equal(state.cleanupCardId, null);
  assert.equal(state.resetCardId, null);
  assert.equal(state.syncCardId, null);
  assert.equal(state.createTicketOpen, false);
  assert.equal(state.meetingNotesOpen, false);
  assert.equal(state.overlayReturn, null);
  assert.equal(state.setupWizard, null);
  assert.equal(state.setupRuns, 0);
  assert.equal(state.soundEnabled, true);
  assert.equal(state.errorsInFeeds, false);
  assert.deepEqual(state.tunnelState, { status: "off" });
  assert.equal(state.connection, "connecting");
  assert.equal(state.activityOpen, false);
  assert.equal(state.toast, IDLE_TOAST);
  assert.equal(state.toastSeq, 0);

  const quiet = createAppStore({ soundEnabled: false }).getState();
  assert.deepEqual(quiet, { ...state, soundEnabled: false });
});

test("subscribe returns an unsubscribe and every listener gets one call per change", () => {
  const store = createAppStore();
  let first = 0;
  let second = 0;
  const off = store.subscribe(() => first++);
  store.subscribe(() => second++);
  store.setActivityOpen(true);
  assert.equal(first, 1);
  assert.equal(second, 1);
  off();
  store.setActivityOpen(false);
  assert.equal(first, 1);
  assert.equal(second, 2);
});

test("a same-value action changes nothing and notifies no listener", () => {
  const { store, counter } = counted();
  const before = store.getState();
  store.selectCard(null, null);
  store.setSoundEnabled(true);
  store.closeCleanup();
  store.setActivityOpen(false);
  assert.equal(counter.calls, 0);
  assert.equal(store.getState(), before);
});

test("a mixed patch with one equal key and one changed key notifies once", () => {
  const { store, counter } = counted({ groupStart: [card("a")] });
  store.pageChanged("inbox");
  assert.equal(store.getState().groupStart, null);
  assert.equal(counter.calls, 1);
});

test("pageChanged to the current page with nothing open notifies no listener", () => {
  const { store, counter } = counted();
  const before = store.getState();
  store.pageChanged("board");
  assert.equal(counter.calls, 0);
  assert.equal(store.getState(), before);
});

test("selectCard sets the selection and keeps the pin when no live card comes with it", () => {
  const store = createAppStore();
  store.selectCard("c1", live);
  assert.equal(store.getState().selectedCardId, "c1");
  assert.equal(store.getState().pinned, live);
  store.selectCard("c2", null);
  assert.equal(store.getState().selectedCardId, "c2");
  assert.equal(store.getState().pinned, live);
  store.selectCard(null, null);
  assert.equal(store.getState().selectedCardId, null);
  assert.equal(store.getState().pinned, live);
});

test("openSearchResult clears the pin in the window and pins a stub outside it", () => {
  const store = createAppStore({ pinned: live, pinnedHydrating: true });
  store.openSearchResult(result, true);
  assert.equal(store.getState().selectedCardId, "c9");
  assert.equal(store.getState().pinned, null);
  assert.equal(store.getState().pinnedHydrating, false);

  store.openSearchResult(result, false);
  const state = store.getState();
  assert.equal(state.selectedCardId, "c9");
  assert.equal(state.pinned?.kind, "stub");
  assert.equal(state.pinned?.card.id, "c9");
  assert.deepEqual(state.pinned?.members, []);
  assert.equal(state.pinnedHydrating, true);
  assert.deepEqual(state.pinFetch, { id: "c9", gen: 1 });
});

test("openPushCard selects, hydrates and raises the fetch generation each time", () => {
  const store = createAppStore();
  store.openPushCard("c1");
  assert.equal(store.getState().selectedCardId, "c1");
  assert.equal(store.getState().pinnedHydrating, true);
  assert.deepEqual(store.getState().pinFetch, { id: "c1", gen: 1 });
  store.openPushCard("c1");
  assert.deepEqual(store.getState().pinFetch, { id: "c1", gen: 2 });
});

test("pinFetched hydrates the pin for the current generation and ignores a stale one", () => {
  const { store, counter } = counted();
  store.openPushCard("c1");
  store.pinFetched(1, null);
  assert.equal(store.getState().pinFetchError?.kind, "not-found");
  store.openPushCard("c1");
  store.openPushCard("c1");
  const before = store.getState();
  const calls = counter.calls;
  store.pinFetched(2, { card: card("c1"), members: [] });
  assert.equal(store.getState(), before);
  assert.equal(counter.calls, calls);

  store.pinFetched(3, { card: card("c1"), members: [card("m1")] });
  const state = store.getState();
  assert.equal(state.pinned?.kind, "hydrated");
  assert.equal(state.pinned?.card.id, "c1");
  assert.equal(state.pinned?.members.length, 1);
  assert.equal(state.pinFetchError, null);
  assert.equal(state.pinnedHydrating, false);
});

test("a missing card reads not-found, a failed fetch reads network, a stale generation is a no-op", () => {
  const store = createAppStore();
  store.openPushCard("c1");
  store.pinFetched(1, null);
  assert.deepEqual(store.getState().pinFetchError, {
    id: "c1",
    kind: "not-found",
  });
  assert.equal(store.getState().pinnedHydrating, false);

  store.openPushCard("c1");
  store.pinFetchFailed(2);
  assert.deepEqual(store.getState().pinFetchError, {
    id: "c1",
    kind: "network",
  });

  const before = store.getState();
  store.pinFetchFailed(1);
  store.pinFetched(1, null);
  assert.equal(store.getState(), before);
});

test("retryPinFetch raises the generation for the selection and does nothing without one", () => {
  const { store, counter } = counted();
  store.retryPinFetch();
  assert.equal(counter.calls, 0);
  store.selectCard("c1", null);
  store.retryPinFetch();
  assert.equal(store.getState().selectedCardId, "c1");
  assert.equal(store.getState().pinnedHydrating, true);
  assert.deepEqual(store.getState().pinFetch, { id: "c1", gen: 1 });
});

test("boardUpdated replaces the pin with the live selected card and its members", () => {
  const store = createAppStore();
  const group = card("g1", { source: "group" });
  const member = card("m1", { groupId: "g1" });
  store.selectCard("g1", null);
  store.boardUpdated([group, member, card("c2")]);
  assert.equal(store.getState().pinned?.card, group);
  assert.deepEqual(store.getState().pinned?.members, [member]);

  store.selectCard("gone", null);
  const before = store.getState();
  store.boardUpdated([group]);
  assert.equal(store.getState(), before);

  const pinnedOnly = createAppStore({ pinned: live });
  const kept = pinnedOnly.getState();
  pinnedOnly.boardUpdated([group]);
  assert.equal(pinnedOnly.getState(), kept);
});

test("closePanel clears the selection, the pin and hydrating; deselect clears only its own id", () => {
  const store = createAppStore({
    selectedCardId: "c1",
    pinned: live,
    pinnedHydrating: true,
  });
  store.deselect("other");
  assert.equal(store.getState().selectedCardId, "c1");
  store.deselect("c1");
  assert.equal(store.getState().selectedCardId, null);
  assert.equal(store.getState().pinned, live);

  store.selectCard("c1", null);
  store.closePanel();
  assert.equal(store.getState().selectedCardId, null);
  assert.equal(store.getState().pinned, null);
  assert.equal(store.getState().pinnedHydrating, false);
});

test("pageChanged closes the panel off Workspace and the group start off Board", () => {
  const members = [card("a"), card("b")];
  const store = createAppStore({
    selectedCardId: "c1",
    pinned: live,
    pinnedHydrating: true,
    groupStart: members,
  });
  store.pageChanged("inbox");
  assert.equal(store.getState().selectedCardId, null);
  assert.equal(store.getState().pinned, null);
  assert.equal(store.getState().pinnedHydrating, false);
  assert.equal(store.getState().groupStart, null);

  const docked = createAppStore({ selectedCardId: "c1", groupStart: members });
  docked.pageChanged("workspace");
  assert.equal(docked.getState().selectedCardId, "c1");
  assert.equal(docked.getState().groupStart, null);

  const board = createAppStore({ selectedCardId: "c1", groupStart: members });
  board.pageChanged("board");
  assert.equal(board.getState().selectedCardId, null);
  assert.equal(board.getState().groupStart, members);
});

test("loadMoreDone adds one page each time", () => {
  const store = createAppStore();
  store.loadMoreDone();
  store.loadMoreDone();
  assert.equal(store.getState().doneLimit, DONE_PAGE_SIZE * 3);
});

test("requestStart opens only for a startable card", () => {
  const store = createAppStore();
  store.requestStart("c1", undefined);
  store.requestStart("g", card("g", { groupId: "x" }));
  store.requestStart("c1", card("c1", { column: "in_progress" }));
  assert.equal(store.getState().start, null);

  store.requestStart("c1", card("c1"));
  assert.deepEqual(store.getState().start, { cardId: "c1" });
  store.closeStart();
  store.requestStart("c2", card("c2", { column: "done", sessionLost: true }));
  assert.deepEqual(store.getState().start, { cardId: "c2" });
  store.closeStart();
  const fresh = { cardId: "c3", newSession: true };
  store.requestStart(fresh, card("c3", { column: "in_progress" }));
  assert.equal(store.getState().start, fresh);
});

test("each close action clears only its own request", () => {
  const open = (): ReturnType<typeof createAppStore> => {
    const store = createAppStore();
    store.openStart({ cardId: "s" });
    store.openGroupStart([card("a")]);
    store.openCleanup("c");
    store.openReset("r");
    store.openSync("y");
    store.openCreateTicket();
    store.openMeetingNotes();
    store.openSetupWizard(checks);
    return store;
  };
  const fields = [
    "start",
    "groupStart",
    "cleanupCardId",
    "resetCardId",
    "syncCardId",
    "createTicketOpen",
    "meetingNotesOpen",
    "setupWizard",
  ] as const;
  const closes: Record<
    (typeof fields)[number],
    (s: ReturnType<typeof createAppStore>) => void
  > = {
    start: (s) => s.closeStart(),
    groupStart: (s) => s.closeGroupStart(),
    cleanupCardId: (s) => s.closeCleanup(),
    resetCardId: (s) => s.closeReset(),
    syncCardId: (s) => s.closeSync(),
    createTicketOpen: (s) => s.closeCreateTicket(),
    meetingNotesOpen: (s) => s.closeMeetingNotes(),
    setupWizard: (s) => s.closeSetupWizard(false),
  };
  for (const field of fields) {
    const store = open();
    const before = store.getState();
    closes[field](store);
    const after = store.getState();
    assert.equal(after[field], field.endsWith("Open") ? false : null, field);
    for (const other of fields) {
      if (other !== field) assert.equal(after[other], before[other], other);
    }
  }
});

test("groupStarted raises the selection reset token and closeGroupStart does not", () => {
  const store = createAppStore();
  store.openGroupStart([card("a")]);
  store.closeGroupStart();
  assert.equal(store.getState().selectionResetToken, 0);
  store.groupStarted();
  assert.equal(store.getState().selectionResetToken, 1);
});

test("closeSetupWizard counts a run only when Linear changed", () => {
  const store = createAppStore();
  store.openSetupWizard(checks);
  store.closeSetupWizard(false);
  assert.equal(store.getState().setupWizard, null);
  assert.equal(store.getState().setupRuns, 0);
  store.openSetupWizard(checks);
  store.closeSetupWizard(true);
  assert.equal(store.getState().setupWizard, null);
  assert.equal(store.getState().setupRuns, 1);
});

test("setOverlayReturn notifies once for one element and clears with null", () => {
  const { store, counter } = counted();
  const el = {} as HTMLElement;
  store.setOverlayReturn(el);
  store.setOverlayReturn(el);
  assert.equal(counter.calls, 1);
  assert.equal(store.getState().overlayReturn, el);
  store.setOverlayReturn(null);
  assert.equal(store.getState().overlayReturn, null);
});

test("the preference and live state setters set their field and notify once", () => {
  const { store, counter } = counted();
  store.setSoundEnabled(false);
  assert.equal(store.getState().soundEnabled, false);
  assert.equal(counter.calls, 1);
  store.setErrorsInFeeds(true);
  assert.equal(store.getState().errorsInFeeds, true);
  assert.equal(counter.calls, 2);
  const tunnel = { status: "starting" } as const;
  store.setTunnelState(tunnel);
  assert.equal(store.getState().tunnelState, tunnel);
  assert.equal(counter.calls, 3);
  store.setConnection("disconnected");
  assert.equal(store.getState().connection, "disconnected");
  assert.equal(counter.calls, 4);
  store.setConnection("disconnected");
  assert.equal(counter.calls, 4);
  store.setActivityOpen(true);
  assert.equal(store.getState().activityOpen, true);
  assert.equal(counter.calls, 5);
});

test("the toast shows, undoes, fails, dismisses and ignores a stale id", () => {
  const store = createAppStore();
  const undo = () => Promise.resolve();
  store.showUndo("Unwound X", undo);
  assert.equal(store.getState().toastSeq, 1);
  assert.deepEqual(store.getState().toast, {
    toast: { id: 1, label: "Unwound X", undo },
    undoing: false,
    error: null,
  });

  store.toastUndo(1);
  assert.equal(store.getState().toast.undoing, true);
  store.toastFailed(1, "e");
  assert.equal(store.getState().toast.toast?.id, 1);
  assert.equal(store.getState().toast.error, "e");
  store.toastUndo(1);
  store.toastUndone(1);
  assert.equal(store.getState().toast, IDLE_TOAST);

  store.notice("text");
  assert.deepEqual(store.getState().toast, {
    toast: null,
    undoing: false,
    error: "text",
  });
  store.dismissToast();
  assert.equal(store.getState().toast, IDLE_TOAST);

  store.showUndo("Unwound Y", undo);
  let calls = 0;
  store.subscribe(() => calls++);
  const before = store.getState();
  store.toastUndo(1);
  store.toastUndone(1);
  store.toastFailed(1, "late");
  assert.equal(calls, 0);
  assert.equal(store.getState(), before);
});
