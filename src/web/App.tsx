import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  useMemo,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { activityFeedQueryOptions } from "./queries/activity-queries.js";
import {
  boardSnapshotQueryOptions,
  latestBoard,
  useBoardLiveUpdates,
} from "./queries/board-snapshot-queries.js";
import {
  isUnseen,
  stampLastOpened,
  useLastOpened,
} from "./hooks/useUnseenActivity.js";
import { useTransitionNotifications } from "./hooks/useTransitionNotifications.js";
import { ShellView } from "./modules/shell/index.js";
import {
  NAV_ITEMS,
  visibleNavItems,
} from "./modules/shell/domain/nav-items.js";
import { hideDisabledSlack } from "./lib/hide-disabled-slack.js";
import {
  useLocation,
  useRouteContext,
  useRouter,
  useRouterState,
  Outlet,
} from "@tanstack/react-router";
import {
  routeFromMatch,
  routeHash,
  type Page,
  type Route,
} from "../shared/route.js";
import { AppStateProvider, type AppPages } from "./components/AppState.js";
import { useTheme } from "./hooks/useTheme.js";
import {
  AccountChipView,
  accountsQueryOptions,
} from "./modules/accounts/index.js";
import { Glyph, wordmarkStyle } from "./components/icons/Glyph.js";
import {
  actionablePinnedCard,
  actionablePinnedMembers,
  inboxWaitingCount,
  membersOf,
  type PinnedCard,
  stubToCard,
} from "./features/board/index.js";
import { DetailPanel } from "./features/detail/index.js";
import {
  ActivityList,
  type ActivityFilter,
} from "./features/activity/index.js";
import {
  StartModal,
  CleanupModal,
  ResetModal,
  SyncToLinearModal,
  CreateTicketModal,
  MultiSelect,
} from "./features/modals/index.js";
import { SetupWizardView } from "./modules/setup/index.js";
import { SetupConnectionsView } from "./modules/connections/index.js";
import { Spinner } from "./primitives/Spinner.js";
import { Button } from "./primitives/Button.js";
import { undoToastCopy, useUndoToast } from "./hooks/useUndoToast.js";
import {
  moveCard,
  getSlackThread,
  pollSource,
  promoteItem,
  resetCard as resetCardApi,
  restoreArchived,
  resumeCard,
  setItemState,
  snoozeItem,
  switchSession,
  unwindGroup as unwindGroupApi,
} from "./lib/api.js";
import { syncSources, type ActionServices } from "./lib/actions.js";
import { buildCommands } from "./modules/shell/domain/commands.js";
import {
  BOARD_SHORTCUTS,
  GLOBAL_SHORTCUTS,
  INBOX_SHORTCUTS,
  SESSIONS_SHORTCUTS,
  bindShortcuts,
} from "../shared/shortcuts.js";
import { useShortcuts } from "./hooks/useShortcuts.js";
import { useItems } from "./hooks/useItems.js";
import { buildPrRows } from "../shared/pr-rows.js";
import { feedItems, isListedError } from "../shared/feed-items.js";
import { slackRows } from "./modules/slack/domain/slack-rows.js";
import { nowMs } from "../shared/format-age.js";
import { flattenSessions } from "./lib/sessions.js";
import { useAsk } from "./hooks/useAsk.js";
import { askAboutQuestion } from "./lib/ask.js";
import type { UnwindDestination } from "../shared/types.js";
import {
  cleanupCard as cleanupCardApi,
  getCard,
  getSetup,
  markOnboardingDone,
} from "./lib/api.js";
import {
  shouldMarkOnboardingDone,
  shouldOpenSetupWizard,
} from "../shared/setup-wizard.js";
import {
  cleanupAttemptEnded,
  cleanupOutcomeCopy,
  cleanupRequestFailedCopy,
} from "./lib/cleanup-feedback.js";
import { playChime } from "./lib/chime.js";
import { refreshPushSubscription } from "./lib/push.js";
import type { StartRequest } from "./lib/start-request.js";
import { meetingNotice } from "./modules/meetings/domain/meetings.js";
import { formatSize } from "../shared/format-size.js";
import type {
  BoardSnapshot,
  ConnectionStatus,
  SetupChecks,
  TunnelState,
  WorktreeRow,
} from "../shared/types.js";
import type { CardSearchResult } from "../shared/search.js";
import { DONE_PAGE_SIZE } from "../shared/done-limit.js";

import { isTicketCard } from "../shared/linear-state.js";

const MeetingNotesView = lazy(() =>
  import("./modules/meetings/index.js").then((m) => ({
    default: m.MeetingNotesView,
  })),
);

const SHORTCUT_GROUPS = [
  { title: "Global", rows: GLOBAL_SHORTCUTS },
  { title: "Board", rows: BOARD_SHORTCUTS },
  { title: "Inbox", rows: INBOX_SHORTCUTS },
  { title: "Sessions", rows: SESSIONS_SHORTCUTS },
];

const PANEL_FREE_PAGES: ReadonlySet<Page> = new Set([
  "settings",
  "accounts",
  "playbooks",
  "vault",
  "archive",
  "ask",
  "flow",
]);

const headerNoteStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

const activitySelectStyle: CSSProperties = {
  height: "28px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
};

class PageErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-sm)",
          color: "var(--text-muted)",
          fontSize: "var(--font-body)",
        }}
      >
        <span>This page failed to load.</span>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

export function PageFallback() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      style={{
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Spinner />
    </div>
  );
}

export function BootScreen({ connection }: { connection: ConnectionStatus }) {
  const statusText =
    connection === "disconnected"
      ? "Disconnected, reconnecting…"
      : "Connecting…";
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-xl)",
        color: "var(--text)",
        userSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-sm)",
        }}
      >
        <Glyph size={44} />
        <span style={wordmarkStyle}>DISPATCH</span>
      </div>
      <div
        style={{
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          color:
            connection === "disconnected"
              ? "var(--destructive-text)"
              : "var(--text-muted)",
        }}
      >
        {statusText}
      </div>
    </div>
  );
}

type WorkspacesSummary = Parameters<
  AppPages["workspaces"]["onSummaryChange"]
>[0];

function useCommittedRoute(): Route {
  const leaf = useRouterState({ select: (s) => s.matches.at(-1) });
  const pathname = useLocation({ select: (l) => l.pathname });
  return routeFromMatch(leaf, pathname);
}

export function App() {
  const { data: activityData } = useQuery(activityFeedQueryOptions());
  const events = activityData ?? [];
  const { data: claudeAccounts } = useQuery(accountsQueryOptions());
  const ask = useAsk();
  const router = useRouter();
  const route = useCommittedRoute();
  const currentPage = route.page;
  const { setup } = useRouteContext({ from: "__root__" });
  const navigate = useCallback(
    (page: Page, id?: string, options?: { replace?: boolean }) => {
      void router.navigate({
        href: routeHash({ page, id }).slice(1),
        replace: options?.replace,
      });
    },
    [router],
  );
  const {
    preference: themePreference,
    theme,
    setPreference: setThemePreference,
  } = useTheme();
  const [archiveCount, setArchiveCount] = useState<number | undefined>();
  const [playbookCount, setPlaybookCount] = useState<number | undefined>();
  const [vaultCount, setVaultCount] = useState<number | undefined>();
  const [workspacesSummary, setWorkspacesSummary] = useState<
    WorkspacesSummary | undefined
  >();
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>({
    cardId: null,
    types: [],
  });
  const [playbookCreateRequest, setPlaybookCreateRequest] = useState(0);
  const [tunnelState, setTunnelState] = useState<TunnelState>({
    status: "off",
  });
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<PinnedCard | null>(null);
  const [pinnedHydrating, setPinnedHydrating] = useState(false);
  const [panelPage, setPanelPage] = useState(route.page);
  if (panelPage !== route.page) {
    setPanelPage(route.page);
    if (route.page !== "workspace") {
      setSelectedCardId(null);
      setPinned(null);
      setPinnedHydrating(false);
    }
  }
  const [pinFetchError, setPinFetchError] = useState<{
    id: string;
    kind: "not-found" | "network";
  } | null>(null);
  const pinFetchGenRef = useRef(0);
  const { connection } = useBoardLiveUpdates(doneLimit, {
    onTunnelState: (state) => {
      setTunnelState(state);
    },
    onBoardUpdate: (snapshot) => {
      if (selectedCardId == null) return;
      const live = snapshot.cards.find((card) => card.id === selectedCardId);
      if (live != null)
        setPinned({
          card: live,
          kind: "hydrated",
          members: membersOf(live, snapshot.cards),
        });
    },
  });
  const boardQuery = useQuery({
    ...boardSnapshotQueryOptions(doneLimit),
    placeholderData: keepPreviousData,
  });
  const lastBoard = useRef<BoardSnapshot | null>(null);
  const board = latestBoard(boardQuery.data, lastBoard.current);
  lastBoard.current = board;

  const [activityOpen, setActivityOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dsp.sound") !== "off";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("dsp.sound", soundEnabled ? "on" : "off");
    } catch {}
  }, [soundEnabled]);

  const [errorsInFeeds, setErrorsInFeeds] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dsp.errorsInFeeds") === "on";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("dsp.errorsInFeeds", errorsInFeeds ? "on" : "off");
    } catch {}
  }, [errorsInFeeds]);

  useEffect(() => {
    void refreshPushSubscription();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("card");
    if (id == null || id === "") return;
    setSelectedCardId(id);
    hydratePinned(id);
    params.delete("card");
    const search = params.toString();
    const next =
      window.location.pathname +
      (search ? `?${search}` : "") +
      window.location.hash;
    window.history.replaceState(window.history.state, "", next);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onMessage(event: MessageEvent) {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const { type, cardId } = data as { type?: unknown; cardId?: unknown };
      if (type !== "dsp-open-card" || typeof cardId !== "string") return;
      setSelectedCardId(cardId);
      hydratePinned(cardId);
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const lastOpened = useLastOpened();
  useEffect(() => {
    if (currentPage === "activity") stampLastOpened("__feed__");
  }, [currentPage, events.length]);
  const firstRouteRef = useRef(true);
  useEffect(() => {
    if (route.page !== "playbooks") setPlaybookCreateRequest(0);
    if (PANEL_FREE_PAGES.has(route.page)) {
      setSelectedCardId(null);
      setPinned(null);
      setPinnedHydrating(false);
    }
    if (firstRouteRef.current) {
      firstRouteRef.current = false;
      return;
    }
    document.querySelector<HTMLElement>("header h1")?.focus();
  }, [route.page]);
  const newestTs = events[0]?.ts;
  const activityUnseen = isUnseen(newestTs, lastOpened["__feed__"]);

  const selectedCard =
    board?.cards.find((card) => card.id === selectedCardId) ??
    (pinned?.card.id === selectedCardId ? pinned.card : null);
  const selectedCardInWindow =
    board?.cards.some((card) => card.id === selectedCardId) === true;
  const selectedCardMembers =
    selectedCard == null || selectedCard.source !== "group"
      ? undefined
      : selectedCardInWindow
        ? membersOf(selectedCard, board?.cards ?? [])
        : pinned?.card.id === selectedCardId
          ? pinned.members
          : [];
  const membersActionable =
    selectedCardInWindow || actionablePinnedMembers(selectedCardId, pinned);
  const pinFetchErrorKind =
    !selectedCardInWindow &&
    pinFetchError != null &&
    pinFetchError.id === selectedCardId
      ? pinFetchError.kind
      : null;

  function selectCard(id: string | null) {
    setSelectedCardId(id);
    if (id == null) return;
    const live = board?.cards.find((card) => card.id === id);
    if (live != null)
      setPinned({
        card: live,
        kind: "hydrated",
        members: membersOf(live, board?.cards ?? []),
      });
  }

  function hydratePinned(id: string) {
    setPinnedHydrating(true);
    const gen = ++pinFetchGenRef.current;
    getCard(id)
      .then((fetched) => {
        if (gen !== pinFetchGenRef.current) return;
        if (fetched != null) {
          setPinned({
            card: fetched.card,
            kind: "hydrated",
            members: fetched.members,
          });
          setPinFetchError(null);
        } else {
          setPinFetchError({ id, kind: "not-found" });
        }
        setPinnedHydrating(false);
      })
      .catch(() => {
        if (gen !== pinFetchGenRef.current) return;
        setPinFetchError({ id, kind: "network" });
        setPinnedHydrating(false);
      });
  }

  function selectSearchResult(result: CardSearchResult) {
    setSelectedCardId(result.id);
    if (board?.cards.some((card) => card.id === result.id) === true) {
      setPinned(null);
      setPinnedHydrating(false);
      return;
    }
    setPinned({ card: stubToCard(result), kind: "stub", members: [] });
    hydratePinned(result.id);
  }

  function isInBoardWindow(id: string): boolean {
    return board?.cards.some((card) => card.id === id) === true;
  }

  function requestWorktreeCleanup(row: WorktreeRow): void {
    if (isInBoardWindow(row.cardId)) setCleanupCardId(row.cardId);
    else openWorktreeCard(row);
  }

  function openWorktreeCard(row: WorktreeRow): void {
    if (isInBoardWindow(row.cardId)) {
      selectCard(row.cardId);
      return;
    }
    selectSearchResult({
      id: row.cardId,
      identifier: row.identifier,
      title: row.title,
      column: row.column,
    });
  }

  useTransitionNotifications(board, connection, selectCard, soundEnabled);

  const cardIdentifiers: Record<string, string> = {};
  for (const card of board?.cards ?? []) {
    cardIdentifiers[card.id] = card.identifier;
  }
  const activityCardIds = new Set(
    events.map((e) => e.cardId).filter((id): id is string => id != null),
  );
  if (activityFilter.cardId != null) activityCardIds.add(activityFilter.cardId);
  const activityCardOptions = [...activityCardIds].map((id) => ({
    id,
    label: cardIdentifiers[id] ?? id,
  }));
  const activityTypeOptions = [
    ...new Set([...events.map((e) => e.type), ...activityFilter.types]),
  ].map((type) => ({ id: type, label: type.replace(/_/g, " ") }));

  const undoToast = useUndoToast();
  const items = useItems(board);
  const inboxItems = useMemo(
    () =>
      hideDisabledSlack(
        feedItems(items, errorsInFeeds),
        board?.enabledSources ?? [],
      ),
    [items, errorsInFeeds, board?.enabledSources],
  );
  const slack = useMemo(() => slackRows(inboxItems), [inboxItems]);
  const navItems = useMemo(
    () => visibleNavItems(NAV_ITEMS, board?.enabledSources ?? []),
    [board?.enabledSources],
  );
  const meetingItems = items.filter((item) => item.source === "meeting");
  const inboxRows = useMemo(
    () => inboxItems.filter((item) => item.source !== "calendar"),
    [inboxItems],
  );
  const { show: showUndo, notice: showNotice } = undoToast;
  const [startRequest, setStartRequest] = useState<StartRequest | null>(null);
  const startAgent = useCallback(
    async (
      target: { itemId?: string; cardId?: string },
      extraDirection: string,
      context?: string,
    ) => {
      try {
        if (target.cardId) {
          setStartRequest({
            cardId: target.cardId,
            newSession: true,
            extraDirection,
          });
          return;
        }
        if (!target.itemId) return;
        const { card } = await promoteItem(target.itemId, context);
        if (card.column === "inbox") await moveCard(card.id, "todo");
        setStartRequest({ cardId: card.id, extraDirection });
      } catch {
        showNotice("Couldn't start the agent. Try again.");
      }
    },
    [showNotice],
  );

  const askAbout = useCallback(
    (question: string) => navigate("ask", question),
    [navigate],
  );
  const consumeAskPrefill = useCallback(
    () => navigate("ask", undefined, { replace: true }),
    [navigate],
  );
  const actionServices = useMemo<ActionServices>(
    () => ({
      api: {
        promoteItem,
        setItemState,
        snoozeItem,
        moveCard,
        cleanupCard: cleanupCardApi,
        switchSession,
        resumeCard,
        pollSource,
        getSlackThread,
      },
      showUndo,
      notice: showNotice,
      openUrl: (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      copyText: (text) =>
        navigator.clipboard
          ? navigator.clipboard.writeText(text)
          : Promise.reject(new Error("Clipboard unavailable over http")),
      startAgent,
      askAbout,
    }),
    [showUndo, showNotice, startAgent, askAbout],
  );
  const requestUnwind = useCallback(
    (id: string, to: UnwindDestination) => {
      void unwindGroupApi(id, to)
        .then((result) => {
          if (result.ok) {
            const archivedId = result.archived.id;
            undoToast.show(undoToastCopy(result.archived), async () => {
              const restored = await restoreArchived(archivedId);
              if (!restored.ok) throw new Error(restored.error);
            });
            setSelectedCardId((current) =>
              current === result.archived.id ? null : current,
            );
            return;
          }
          undoToast.notice(result.error);
        })
        .catch((err: unknown) => {
          console.error("unwindGroup failed", err);
          undoToast.notice("Couldn't unwind this group.");
        });
    },
    [undoToast],
  );

  const startCard =
    board?.cards.find((card) => card.id === startRequest?.cardId) ??
    actionablePinnedCard(startRequest?.cardId, pinned);

  const requestStart = (req: string | StartRequest) => {
    const id = typeof req === "string" ? req : req.cardId;
    const card = board?.cards.find((c) => c.id === id);
    if (card == null) return;
    if (card.groupId != null) return;
    const wantsNewSession = typeof req !== "string" && req.newSession === true;
    if (!wantsNewSession && card.column !== "todo" && card.sessionLost !== true)
      return;
    setStartRequest(typeof req === "string" ? { cardId: req } : req);
  };

  const [cleanupCardId, setCleanupCardId] = useState<string | null>(null);
  const cleanupCard =
    board?.cards.find((card) => card.id === cleanupCardId) ??
    actionablePinnedCard(cleanupCardId, pinned);

  const cleanupWatchRef = useRef(new Map<string, number | undefined>());
  const notifyCleanupOutcome = undoToast.notice;
  useEffect(() => {
    if (board == null) return;
    for (const [id, attempt] of cleanupWatchRef.current) {
      const card = board.cards.find((c) => c.id === id);
      if (card == null || !cleanupAttemptEnded(card, attempt)) continue;
      cleanupWatchRef.current.delete(id);
      const copy = cleanupOutcomeCopy(card);
      if (copy != null) notifyCleanupOutcome(copy);
    }
  }, [board, notifyCleanupOutcome]);
  const requestCleanup = (force: boolean) => {
    if (cleanupCard == null) return;
    const { id, identifier, cleanupAttempt } = cleanupCard;
    cleanupWatchRef.current.set(id, cleanupAttempt);
    void cleanupCardApi(id, force).catch((err: unknown) => {
      console.error("cleanupCard failed", err);
      cleanupWatchRef.current.delete(id);
      notifyCleanupOutcome(cleanupRequestFailedCopy(identifier));
    });
  };

  const [resetCardId, setResetCardId] = useState<string | null>(null);
  const [syncCardId, setSyncCardId] = useState<string | null>(null);
  const cardToSync = board?.cards.find((card) => card.id === syncCardId);
  const resetCard =
    board?.cards.find((card) => card.id === resetCardId) ??
    actionablePinnedCard(resetCardId, pinned);
  const requestReset = () => {
    if (resetCard == null) return;
    const { id, identifier } = resetCard;
    void resetCardApi(id)
      .then((result) => {
        notifyCleanupOutcome(
          result.ok ? `${identifier} reset to Inbox.` : result.error,
        );
      })
      .catch((err: unknown) => {
        console.error("resetCard failed", err);
        notifyCleanupOutcome(`Couldn't reset ${identifier}.`);
      });
  };

  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [meetingNotesOpen, setMeetingNotesOpen] = useState(false);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const overlayReturnRef = useRef<HTMLElement | null>(null);
  const openOverlay = (open: (value: boolean) => void) => () => {
    overlayReturnRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    open(true);
  };
  const closeOverlay =
    (open: (value: boolean) => void) =>
    (ran = false) => {
      open(false);
      const target = overlayReturnRef.current;
      overlayReturnRef.current = null;
      if (ran !== true && target?.isConnected === true) target.focus();
    };

  const [setupWizardOpen, setSetupWizardOpen] = useState(
    () => setup != null && shouldOpenSetupWizard(setup),
  );
  const [setupChecks, setSetupChecks] = useState<SetupChecks | null>(setup);
  const [setupRuns, setSetupRuns] = useState(0);
  useShortcuts(
    bindShortcuts(GLOBAL_SHORTCUTS, {
      "meta+k": openOverlay(setPaletteOpen),
      n: openOverlay(setCreateTicketOpen),
      "?": openOverlay(setShortcutsOpen),
    }),
    {
      menuOpen: activityOpen || sheetOpen || board === null || setupWizardOpen,
      scopeId: "root",
    },
  );
  useEffect(() => {
    if (setup != null && shouldMarkOnboardingDone(setup)) {
      void markOnboardingDone().catch((err: unknown) => {
        console.error("markOnboardingDone failed", err);
      });
    }
  }, [setup]);

  const openSetupWizard = async (): Promise<boolean> => {
    try {
      setSetupChecks(await getSetup());
      setSetupWizardOpen(true);
      return true;
    } catch (err) {
      console.error("getSetup failed", err);
      return false;
    }
  };

  const closeSetupWizard = (linearChanged: boolean) => {
    setSetupWizardOpen(false);
    if (linearChanged) setSetupRuns((n) => n + 1);
    void markOnboardingDone().catch((err: unknown) => {
      console.error("markOnboardingDone failed", err);
    });
  };

  if (board === null) {
    return <BootScreen connection={connection} />;
  }

  const accountSlot = claudeAccounts ? (
    <AccountChipView onOpenSettings={() => navigate("accounts")} />
  ) : null;

  const inboxCount = inboxWaitingCount(board.cards, inboxRows);
  const sessionRows = flattenSessions(board.cards, nowMs());
  const liveSessionCount = sessionRows.filter((row) => row.running).length;
  const githubEnabled = board.enabledSources?.includes("github") === true;
  const prCount = githubEnabled
    ? items.filter((item) => item.source === "github" && item.state !== "done")
        .length
    : 0;
  const ticketsCount = board.cards.filter(isTicketCard).length;
  const sentryEnabled = board.enabledSources?.includes("sentry") === true;
  const errorCount = sentryEnabled ? items.filter(isListedError).length : 0;
  const slackCount = slack.filter((row) => row.unread).length;
  const pageMeta: Record<Page, { title: string; count?: number }> = {
    board: { title: "Board", count: board.cards.length },
    inbox: { title: "Inbox", count: inboxCount },
    sessions: { title: "Sessions", count: sessionRows.length },
    tickets: { title: "Tickets", count: ticketsCount },
    workspace: { title: "Workspace" },
    settings: { title: "Settings" },
    activity: { title: "Activity", count: events.length },
    accounts: {
      title: "Accounts and Usage",
      count: claudeAccounts?.accounts.length,
    },
    playbooks: { title: "Playbooks", count: playbookCount },
    vault: { title: "Vault", count: vaultCount },
    archive: { title: "Archive", count: archiveCount },
    "pull-requests": {
      title: "Pull Requests",
      count: githubEnabled ? buildPrRows(items, board.cards).length : 0,
    },
    errors: { title: "Errors", count: errorCount },
    today: { title: "Today" },
    slack: { title: "Slack", count: slack.length },
    meetings: { title: "Meetings", count: meetingItems.length },
    calendar: { title: "Calendar" },
    workspaces: { title: "Workspaces", count: workspacesSummary?.count },
    ask: { title: "Ask", count: ask.turns.length },
    flow: { title: "Flow" },
  };
  const pageTitle = pageMeta[route.page].title;

  const pages: AppPages = {
    workspace: {
      board,
      selectedCardId: selectedCard ? selectedCardId : null,
      onSelectCard: selectCard,
    },
    "pull-requests": {
      board,
      items,
      onSelect: (key) =>
        navigate("pull-requests", key ?? undefined, { replace: true }),
      onMarkRead: (id) => void setItemState(id, "read"),
      onNotice: showNotice,
      onStartAgent: (row, prompt) =>
        void startAgent({ itemId: row.itemId, cardId: row.cardId }, prompt),
    },
    errors: {
      board,
      items,
      onSelect: (key) =>
        navigate("errors", key ?? undefined, { replace: true }),
      onMarkRead: (id) => void setItemState(id, "read"),
      onNotice: showNotice,
      onStartAgent: (row, prompt, context) =>
        void startAgent(
          { itemId: row.itemId, cardId: row.cardId },
          prompt,
          context,
        ),
    },
    today: {
      board,
      items: inboxItems,
      onSelectCard: selectCard,
      onNavigate: navigate,
    },
    slack: {
      board,
      rows: slack,
      onSelect: (id) => navigate("slack", id ?? undefined, { replace: true }),
      onMarkRead: (id) =>
        void setItemState(id, "read").catch(() =>
          showNotice("Couldn't mark it read."),
        ),
      onNotice: showNotice,
      onShowUndo: showUndo,
      onCopyText: actionServices.copyText,
      onStartAgent: (target, prompt) => startAgent(target, prompt),
    },
    inbox: {
      board,
      items: inboxRows,
      selectedCardId: selectedCard ? selectedCardId : null,
      onSelectCard: selectCard,
      services: actionServices,
    },
    tickets: {
      board,
      selectedCardId: selectedCard ? selectedCardId : null,
      onSelectCard: selectCard,
      onStartRequest: requestStart,
      onMoveCard: moveCard,
      onNotice: showNotice,
    },
    settings: {
      onTabChange: (tab) => navigate("settings", tab, { replace: true }),
      onOpenPage: (page) => navigate(page),
      onSaved: () => notifyCleanupOutcome("Settings saved."),
      tunnelState,
      soundEnabled,
      onToggleSound: setSoundEnabled,
      themePreference,
      onThemePreferenceChange: setThemePreference,
      onRunSetup: openSetupWizard,
      connectionKey: setupRuns,
      errorsInFeeds,
      onToggleErrorsInFeeds: setErrorsInFeeds,
      onPlayChime: playChime,
    },
    activity: {
      events: events,
      identifiers: cardIdentifiers,
      filter: activityFilter,
      onSelectCard: selectCard,
    },
    accounts: {},
    sessions: {
      board,
      selectedCardId: selectedCard ? selectedCardId : null,
      onSelectCard: selectCard,
      services: actionServices,
    },
    archive: { onCountChange: setArchiveCount },
    playbooks: {
      createRequest: playbookCreateRequest,
      onCountChange: setPlaybookCount,
    },
    vault: { onCountChange: setVaultCount },
    calendar: {
      items,
      cards: board.cards,
      services: actionServices,
      onStartPromoted: (cardId) => setStartRequest({ cardId }),
      onOpenSettings: () => navigate("settings"),
    },
    meetings: {
      items: meetingItems,
      onSelect: (id) => navigate("meetings", id ?? undefined),
      onOpenMeetingNotes: openOverlay(setMeetingNotesOpen),
      onNotice: showNotice,
      onShowUndo: showUndo,
      onStartPromoted: (cardId) => setStartRequest({ cardId }),
    },
    workspaces: {
      board,
      onSummaryChange: setWorkspacesSummary,
      onOpenCard: openWorktreeCard,
      onCleanupRequest: requestWorktreeCleanup,
    },
    ask: { onPrefillConsumed: consumeAskPrefill },
    flow: { board, onOpenList: () => navigate("inbox") },
    board: {
      board,
      selectedCardId: selectedCard ? selectedCardId : null,
      onSelectCard: selectCard,
      onStartRequest: requestStart,
      onEditPlaybooks: () => navigate("playbooks"),
      onOpenInbox: () => navigate("inbox"),
      doneTotal: board?.doneCounts?.total,
      doneLimit,
      onLoadMoreDone: () => setDoneLimit((n) => n + DONE_PAGE_SIZE),
      onSelectSearchResult: selectSearchResult,
    },
  };

  const headerActions =
    currentPage === "playbooks" ? (
      <Button
        variant="primary"
        onClick={() => setPlaybookCreateRequest((n) => n + 1)}
      >
        New playbook
      </Button>
    ) : currentPage === "meetings" ? (
      <Button variant="primary" onClick={openOverlay(setMeetingNotesOpen)}>
        From meeting notes
      </Button>
    ) : currentPage === "activity" ? (
      <>
        <select
          aria-label="Filter by card"
          value={activityFilter.cardId ?? ""}
          onChange={(event) =>
            setActivityFilter((f) => ({
              ...f,
              cardId: event.target.value === "" ? null : event.target.value,
            }))
          }
          style={activitySelectStyle}
        >
          <option value="">All cards</option>
          {activityCardOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <MultiSelect
          label="Event types"
          placeholder="All types"
          options={activityTypeOptions}
          selected={activityFilter.types}
          loading={false}
          loadError={false}
          emptyText="No events yet"
          onChange={(next) =>
            setActivityFilter((f) => ({
              ...f,
              types: next as ActivityFilter["types"],
            }))
          }
        />
      </>
    ) : currentPage === "workspaces" && workspacesSummary ? (
      <span style={headerNoteStyle}>
        {`${formatSize(workspacesSummary.totalKb)} on disk`}
        {workspacesSummary.unknownSizes > 0
          ? ` (${workspacesSummary.unknownSizes} unknown)`
          : ""}
      </span>
    ) : currentPage === "ask" ? (
      <Button
        disabled={ask.turns.length === 0 && ask.pending === null}
        onClick={ask.clear}
      >
        Clear
      </Button>
    ) : undefined;

  const paletteCommands = buildCommands(
    {
      api: {
        moveCard: (id, column) =>
          moveCard(id, column).catch(() =>
            showNotice(
              `Couldn't move ${board.cards.find((c) => c.id === id)?.identifier ?? id}.`,
            ),
          ),
      },
      requestStart,
      requestCleanup: setCleanupCardId,
      openCard: selectCard,
      navigate,
      newTicket: openOverlay(setCreateTicketOpen),
      meetingNotes: openOverlay(setMeetingNotesOpen),
      syncNow: () =>
        void syncSources(
          actionServices.api,
          board.enabledSources ?? [],
          showNotice,
        ),
    },
    navItems,
    selectedCard,
  );

  return (
    <AppStateProvider value={pages}>
      <ShellView
        route={route}
        onNavigate={navigate}
        navItems={navItems}
        counts={{
          inbox: inboxCount,
          meetings: meetingItems.length,
          sessions: liveSessionCount,
          "pull-requests": prCount,
          tickets: ticketsCount,
          errors: errorCount,
          slack: slackCount,
        }}
        sync={{
          syncedAt: board.syncedAt ?? null,
          connection,
          pollIntervalMs: board.pollIntervalMs ?? null,
          syncWarning: board.syncWarning ?? null,
          syncUnreachable: board.syncUnreachable ?? false,
          noSource: (board.enabledSources ?? []).length === 0,
        }}
        accountSlot={accountSlot}
        onOpenCreateTicket={openOverlay(setCreateTicketOpen)}
        onOpenActivity={() => {
          setActivityOpen(true);
          stampLastOpened("__feed__");
        }}
        activityUnseen={activityUnseen}
        activityOpen={activityOpen}
        onCloseActivity={() => setActivityOpen(false)}
        activityList={
          <ActivityList
            events={events}
            identifiers={cardIdentifiers}
            onSelectCard={(id) => {
              selectCard(id);
              setActivityOpen(false);
            }}
            ticking={activityOpen}
          />
        }
        paletteOpen={paletteOpen}
        onClosePalette={closeOverlay(setPaletteOpen)}
        commands={paletteCommands}
        onOpenSearchResult={selectSearchResult}
        shortcutsOpen={shortcutsOpen}
        onCloseShortcuts={closeOverlay(setShortcutsOpen)}
        shortcutGroups={SHORTCUT_GROUPS}
        theme={theme}
        pageTitle={pageTitle}
        pageCount={pageMeta[route.page].count}
        headerActions={headerActions}
        onMobileOpenChange={setSheetOpen}
        content={
          <PageErrorBoundary key={route.page}>
            <Outlet />
          </PageErrorBoundary>
        }
        detail={
          <DetailPanel
            accounts={claudeAccounts?.accounts}
            card={selectedCard}
            hydrating={pinnedHydrating && !selectedCardInWindow}
            pinFetchError={pinFetchErrorKind}
            onRetryPinFetch={() => {
              if (selectedCardId != null) hydratePinned(selectedCardId);
            }}
            editors={board?.editors}
            activityEvents={events}
            cardIdentifiers={cardIdentifiers}
            members={selectedCardMembers}
            membersActionable={membersActionable}
            onClose={() => {
              setSelectedCardId(null);
              setPinned(null);
              setPinnedHydrating(false);
            }}
            onStartRequest={requestStart}
            onCleanupRequest={setCleanupCardId}
            onUnwindRequest={requestUnwind}
            onResetRequest={setResetCardId}
            onSyncRequest={setSyncCardId}
            onAskRequest={(card) =>
              askAbout(
                askAboutQuestion({
                  kind: "card",
                  identifier: card.identifier,
                  title: card.title,
                }),
              )
            }
            docked={currentPage === "workspace"}
          />
        }
      >
        {startCard && startRequest && (
          <StartModal
            key={`${startRequest.cardId}:${startRequest.newSession === true ? "new" : "start"}`}
            card={startCard}
            newSession={startRequest.newSession === true}
            extraDirection={startRequest.extraDirection}
            onClose={() => setStartRequest(null)}
            onEditPlaybooks={() => {
              setStartRequest(null);
              navigate("playbooks");
            }}
          />
        )}
        {cleanupCard && (
          <CleanupModal
            key={cleanupCardId}
            card={cleanupCard}
            onConfirm={requestCleanup}
            onClose={() => setCleanupCardId(null)}
          />
        )}
        {resetCard && (
          <ResetModal
            key={resetCardId}
            card={resetCard}
            onConfirm={requestReset}
            onClose={() => setResetCardId(null)}
          />
        )}
        {cardToSync && (
          <SyncToLinearModal
            key={syncCardId}
            card={cardToSync}
            cards={board?.cards ?? []}
            onClose={() => setSyncCardId(null)}
          />
        )}
        {createTicketOpen && (
          <CreateTicketModal
            onClose={closeOverlay(setCreateTicketOpen)}
            onFromMeetingNotes={() => {
              overlayReturnRef.current?.focus();
              setCreateTicketOpen(false);
              setMeetingNotesOpen(true);
            }}
          />
        )}
        {meetingNotesOpen && (
          <Suspense fallback={null}>
            <MeetingNotesView
              onClose={closeOverlay(setMeetingNotesOpen)}
              onCreated={(result) => showNotice(meetingNotice(result))}
            />
          </Suspense>
        )}
        {setupWizardOpen && setupChecks && (
          <SetupWizardView
            {...setupChecks}
            onClose={closeSetupWizard}
            connections={<SetupConnectionsView />}
          />
        )}
      </ShellView>
    </AppStateProvider>
  );
}
