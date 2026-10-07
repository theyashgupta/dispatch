import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  useLocation,
  useRouteContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { toast } from "sonner";
import {
  boardSearch,
  shouldPollCounts,
  staleCountsLabel,
} from "../../../../shared/board-select.js";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import { inboxFeed, isListedError } from "../../../../shared/feed-items.js";
import { nowMs } from "../../../../shared/format-age.js";
import { inboxWaitingCount } from "../../../../shared/inbox-count.js";
import { syncSources } from "../../../../shared/item-actions.js";
import { isTicketCard } from "../../../../shared/linear-state.js";
import {
  pinFromBoard,
  selectedCardOf,
} from "../../../../shared/pinned-card.js";
import { buildPrRows } from "../../../../shared/pr-rows.js";
import {
  routeFromMatch,
  routeHash,
  type Page,
  type Route,
} from "../../../../shared/route.js";
import { flattenSessions } from "../../../../shared/sessions.js";
import {
  BOARD_SHORTCUTS,
  INBOX_SHORTCUTS,
  SESSIONS_SHORTCUTS,
  bindShortcuts,
} from "../../../../shared/shortcuts.js";
import { slackRows } from "../../../../shared/slack-rows.js";
import { startTarget } from "../../../../shared/start-request.js";
import type {
  ActivityEvent,
  BoardKey,
  BoardSnapshot,
} from "../../../../shared/types.js";
import { isUnseen } from "../../../../shared/unseen-activity.js";
import { BootScreen } from "@/components/BootScreen";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { useThemeState } from "@/components/ThemeProvider";
import {
  closeOverlay,
  openOverlay,
} from "@/components/ui/hooks/overlay-return";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import {
  stampLastOpened,
  useLastOpened,
} from "@/components/ui/hooks/use-last-opened";
import { useShortcuts } from "@/components/ui/hooks/use-shortcuts";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { ActivityDrawer } from "@/modules/shell/components/ActivityDrawer";
import type { BoardSwitcherData } from "@/modules/shell/components/BoardSwitcher";
import { CheatSheet } from "@/modules/shell/components/CheatSheet";
import { ShellFrame } from "@/modules/shell/components/ShellFrame";
import {
  showSwitcher,
  switcherItems,
  switcherShortcuts,
} from "@/modules/shell/domain/board-switcher";
import { boardPageTitle } from "@/modules/shell/domain/board-title";
import { buildCommands } from "@/modules/shell/domain/commands";
import { NAV_ITEMS, visibleNavItems } from "../../../../shared/nav-items.js";
import { sidebarOpen } from "@/modules/shell/domain/nav-open";
import { useNavPreference } from "@/modules/shell/hooks/use-nav-preference";
import { useTransitionNotifications } from "@/modules/shell/hooks/use-transition-notifications";
import { useUndoToast } from "@/modules/shell/hooks/use-undo-toast";
import { useViewportNav } from "@/modules/shell/hooks/use-viewport-nav";
import { CommandPaletteContainer } from "@/modules/shell/containers/CommandPaletteContainer";
import { UpdateBannerContainer } from "@/modules/shell/containers/UpdateBannerContainer";
import {
  useBoardCountsQuery,
  useBoardListQuery,
} from "@/queries/board-list-queries";
import { actionApi } from "@/queries/action-services";
import { useActivityFeedQuery } from "@/queries/activity-queries";
import {
  latestBoard,
  useBoardLiveUpdates,
  useBoardSnapshotQuery,
} from "@/queries/board-snapshot-queries";
import { moveCard } from "@/queries/cards-api";
import { refreshPushSubscription } from "@/queries/push-api";

export interface ShellContainerProps {
  headerViews: Partial<Record<Page, ComponentType>>;
  accountSlot: ReactNode;
  activityList: ReactNode;
  content: ReactNode;
  detail: ReactNode;
  children?: ReactNode;
}

const SHORTCUT_GROUPS_AFTER_GLOBAL = [
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
  "boards",
]);

const PAGE_TITLES: Record<Page, string> = {
  board: "Board",
  inbox: "Inbox",
  sessions: "Sessions",
  tickets: "Tickets",
  workspace: "Workspace",
  settings: "Settings",
  activity: "Activity",
  accounts: "Accounts and Usage",
  playbooks: "Playbooks",
  vault: "Vault",
  archive: "Archive",
  "pull-requests": "Pull Requests",
  errors: "Errors",
  today: "Today",
  slack: "Slack",
  meetings: "Meetings",
  calendar: "Calendar",
  workspaces: "Workspaces",
  ask: "Ask",
  flow: "Flow",
  boards: "Boards",
};

const NO_EVENTS: ActivityEvent[] = [];

function useCommittedRoute(): Route {
  const leaf = useRouterState({ select: (s) => s.matches.at(-1) });
  const pathname = useLocation({ select: (l) => l.pathname });
  return routeFromMatch(leaf, pathname);
}

export function ShellContainer({
  headerViews,
  accountSlot,
  activityList,
  content,
  detail,
  children,
}: ShellContainerProps) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const route = useCommittedRoute();
  const { theme } = useThemeState();
  const { preference, setPreference } = useNavPreference();
  const { carousel } = useViewportNav();
  const boardKey = useAppStore(appStore, (s) => s.board);
  const doneLimit = useAppStore(appStore, (s) => s.doneLimit);
  const soundEnabled = useAppStore(appStore, (s) => s.soundEnabled);
  const errorsInFeeds = useAppStore(appStore, (s) => s.errorsInFeeds);
  const activityOpen = useAppStore(appStore, (s) => s.activityOpen);
  const setupWizardOpen = useAppStore(appStore, (s) => s.setupWizard != null);
  const selectedCardId = useAppStore(appStore, (s) => s.selectedCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const { data: events = NO_EVENTS } = useActivityFeedQuery(boardKey);
  const list = useBoardListQuery();
  const boardList = list.data;
  const listFailed =
    list.isError || (boardList === undefined && list.errorUpdateCount > 0);
  const showBoards = showSwitcher(boardList?.boards, listFailed, boardKey);
  const counts = useBoardCountsQuery(
    shouldPollCounts(boardList?.boards ?? [], route.page === "boards"),
  );
  const boardItems =
    showBoards && boardList !== undefined
      ? switcherItems(boardList.boards, counts.data?.counts, boardKey)
      : null;
  const boardName = boardItems?.find((item) => item.selected)?.name ?? null;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const navigate = useCallback(
    (page: Page, id?: string, options?: { replace?: boolean }) => {
      void router.navigate({
        href: routeHash({ page, id }).slice(1),
        replace: options?.replace,
      });
    },
    [router],
  );

  const switchBoard = useCallback(
    (key: BoardKey) => {
      void router.navigate({
        to: ".",
        search: (prev) => ({ ...prev, ...boardSearch(key) }),
      });
    },
    [router],
  );

  const newBoard = useCallback(() => {
    void router.navigate({
      to: "/boards/{-$id}",
      search: { ...boardSearch(boardKey), dialog: "new" as const },
    });
  }, [router, boardKey]);

  const [liveBoard, setLiveBoard] = useState<BoardSnapshot | null>(null);
  const { connection } = useBoardLiveUpdates(boardKey, doneLimit, {
    onTunnelState: appStore.setTunnelState,
    onBoardUpdate: (snapshot, fresh) => {
      appStore.boardUpdated(snapshot.cards);
      if (fresh) setLiveBoard(snapshot);
    },
  });
  const boardQuery = useBoardSnapshotQuery(boardKey, doneLimit);
  const [lastBoard, setLastBoard] = useState<BoardSnapshot | null>(null);
  const current = latestBoard(boardQuery.data, lastBoard, boardKey);
  if (current !== null && current !== lastBoard) setLastBoard(current);
  const board = current ?? lastBoard;

  const { refetch: refetchBoard } = boardQuery;
  const boardLoadError =
    boardQuery.data === undefined && boardQuery.fetchStatus === "idle"
      ? boardQuery.error
      : null;
  const neverLoaded = board === null;
  const hasBoardData = boardQuery.data !== undefined;
  const toastedBoard = useRef<BoardKey | null>(null);
  useEffect(() => {
    if (hasBoardData) toastedBoard.current = null;
  }, [hasBoardData]);
  useEffect(() => {
    if (boardLoadError === null || toastedBoard.current === boardKey) return;
    toastedBoard.current = boardKey;
    if (neverLoaded && boardKey !== DEFAULT_BOARD_KEY) {
      const failed = boardKey;
      toast(`Board ${failed} could not be loaded.`, {
        action: { label: "Try again", onClick: () => switchBoard(failed) },
      });
      void router.navigate({
        to: ".",
        search: (prev) => ({ ...prev, ...boardSearch(DEFAULT_BOARD_KEY) }),
        replace: true,
      });
      return;
    }
    toast(`Board ${boardKey} could not be loaded.`, {
      action: { label: "Try again", onClick: () => void refetchBoard() },
    });
  }, [
    boardLoadError,
    boardKey,
    refetchBoard,
    neverLoaded,
    router,
    switchBoard,
  ]);

  const selectCard = (id: string | null) =>
    appStore.selectCard(id, pinFromBoard(id, board?.cards ?? []));

  useTransitionNotifications(
    liveBoard,
    connection,
    appStore.openPushCard,
    soundEnabled,
  );
  useUndoToast(appStore);

  useEffect(() => {
    void refreshPushSubscription();
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onMessage(event: MessageEvent) {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const { type, cardId } = data as { type?: unknown; cardId?: unknown };
      if (type !== "dsp-open-card" || typeof cardId !== "string") return;
      appStore.openPushCard(cardId);
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [appStore]);

  const lastOpened = useLastOpened();
  const pageRef = useRef<Page | null>(null);
  useLayoutEffect(() => {
    const previous = pageRef.current;
    pageRef.current = route.page;
    if (PANEL_FREE_PAGES.has(route.page)) appStore.closePanel();
    if (previous === null || previous === route.page) return;
    appStore.pageChanged(route.page);
    document.querySelector<HTMLElement>("header h1")?.focus();
  }, [route.page, appStore]);

  const items = useItems(board);
  const enabledSources = board?.enabledSources;
  const inboxItems = useMemo(
    () => inboxFeed(items, errorsInFeeds, enabledSources ?? []),
    [items, errorsInFeeds, enabledSources],
  );
  const slack = useMemo(() => slackRows(inboxItems), [inboxItems]);
  const navItems = useMemo(
    () => visibleNavItems(NAV_ITEMS, enabledSources ?? []),
    [enabledSources],
  );
  const inboxRows = useMemo(
    () => inboxItems.filter((item) => item.source !== "calendar"),
    [inboxItems],
  );

  useShortcuts(
    bindShortcuts(switcherShortcuts(showBoards), {
      "meta+k": () => openOverlay(appStore, () => setPaletteOpen(true)),
      n: () => openOverlay(appStore, appStore.openCreateTicket),
      "?": () => openOverlay(appStore, () => setShortcutsOpen(true)),
      b: () => setSwitcherOpen(true),
    }),
    {
      menuOpen:
        activityOpen ||
        sheetOpen ||
        switcherOpen ||
        board === null ||
        setupWizardOpen,
      scopeId: "root",
    },
  );

  if (board === null) {
    return <BootScreen connection={connection} />;
  }

  const meetingItems = items.filter((item) => item.source === "meeting");
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
  const pageCounts: Partial<Record<Page, number>> = {
    board: board.cards.length,
    inbox: inboxCount,
    sessions: sessionRows.length,
    tickets: ticketsCount,
    activity: events.length,
    "pull-requests": githubEnabled ? buildPrRows(items, board.cards).length : 0,
    errors: errorCount,
    slack: slack.length,
    meetings: meetingItems.length,
  };
  const HeaderView = headerViews[route.page];
  const inWindow = (id: string) => board.cards.some((card) => card.id === id);

  const paletteCommands = buildCommands(
    {
      api: {
        moveCard: (id, column) =>
          moveCard(id, column).catch(() =>
            appStore.notice(
              `Couldn't move ${board.cards.find((c) => c.id === id)?.identifier ?? id}.`,
            ),
          ),
      },
      requestStart: (id) =>
        appStore.requestStart(id, startTarget(id, board.cards)),
      requestCleanup: appStore.openCleanup,
      openCard: selectCard,
      navigate,
      newTicket: () => openOverlay(appStore, appStore.openCreateTicket),
      meetingNotes: () => openOverlay(appStore, appStore.openMeetingNotes),
      syncNow: () =>
        void syncSources(
          actionApi(boardKey),
          board.enabledSources ?? [],
          appStore.notice,
        ),
      switchBoard,
      newBoard,
    },
    navItems,
    selectedCardOf(board.cards, selectedCardId, pinned),
    boardItems,
  );
  const switcher: BoardSwitcherData | undefined = showBoards
    ? {
        selected: boardKey,
        items: boardItems ?? [],
        failed: boardList === undefined,
        staleLabel: staleCountsLabel(counts),
        open: switcherOpen,
        onOpenChange: setSwitcherOpen,
        onSelect: switchBoard,
        onManage: () => navigate("boards"),
        onRetry: () => void list.refetch(),
      }
    : undefined;

  return (
    <SidebarProvider
      open={sidebarOpen(preference, carousel)}
      onOpenChange={(next) => {
        if (!carousel) setPreference(next ? "expanded" : "collapsed");
      }}
      className="h-svh min-h-0 overflow-hidden [--sidebar-width-icon:var(--nav-width-collapsed)]! [--sidebar-width:var(--nav-width)]!"
    >
      <ShellFrame
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
        onOpenCreateTicket={() =>
          openOverlay(appStore, appStore.openCreateTicket)
        }
        onOpenActivity={() => {
          appStore.setActivityOpen(true);
          stampLastOpened("__feed__");
        }}
        activityUnseen={isUnseen(events[0]?.ts, lastOpened["__feed__"])}
        activityOpen={activityOpen}
        carousel={carousel}
        switcher={switcher}
        pageTitle={boardPageTitle(
          route.page,
          PAGE_TITLES[route.page],
          boardName,
        )}
        pageCount={pageCounts[route.page]}
        headerView={
          HeaderView ? (
            <PageErrorBoundary key={route.page} fallback={null}>
              <Suspense fallback={null}>
                <HeaderView />
              </Suspense>
            </PageErrorBoundary>
          ) : undefined
        }
        banner={<UpdateBannerContainer />}
        onMobileOpenChange={setSheetOpen}
        content={
          <PageErrorBoundary key={route.page}>{content}</PageErrorBoundary>
        }
        detail={detail}
      >
        <ActivityDrawer
          open={activityOpen}
          onClose={() => appStore.setActivityOpen(false)}
        >
          {activityList}
        </ActivityDrawer>
        {children}
        {shortcutsOpen && (
          <CheatSheet
            groups={[
              { title: "Global", rows: switcherShortcuts(showBoards) },
              ...SHORTCUT_GROUPS_AFTER_GLOBAL,
            ]}
            onClose={() =>
              closeOverlay(appStore, () => setShortcutsOpen(false))
            }
          />
        )}
        {paletteOpen && (
          <CommandPaletteContainer
            commands={paletteCommands}
            onClose={(ran) =>
              closeOverlay(appStore, () => setPaletteOpen(false), ran)
            }
            onOpenCard={(result) =>
              appStore.openSearchResult(result, inWindow(result.id))
            }
          />
        )}
        <Toaster
          theme={theme}
          position="bottom-center"
          offset="var(--space-xl)"
          mobileOffset="var(--space-xl)"
          toastOptions={{
            closeButtonAriaLabel: "Dismiss",
            classNames: {
              description: "text-destructive-text!",
              actionButton: "bg-primary! text-primary-foreground!",
            },
          }}
        />
      </ShellFrame>
    </SidebarProvider>
  );
}
