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
} from "react";
import {
  useBoardStream,
  type ConnectionStatus,
} from "./hooks/useBoardStream.js";
import { useActivityFeed } from "./hooks/useActivityFeed.js";
import {
  isUnseen,
  stampLastOpened,
  useLastOpened,
} from "./hooks/useUnseenActivity.js";
import { useTransitionNotifications } from "./hooks/useTransitionNotifications.js";
import { AppShell } from "./AppShell.js";
import { NavSheet, SidebarNav, TopBar } from "./features/nav/index.js";
import { effectiveNavState } from "./lib/nav-state.js";
import {
  CAROUSEL_QUERY,
  NARROW_QUERY,
  useMediaQuery,
} from "./hooks/useMediaQuery.js";
import { PageHeader } from "./primitives/PageHeader.js";
import { useRoute } from "./hooks/useRoute.js";
import type { Page } from "./lib/route.js";
import { useNavState } from "./hooks/useNavState.js";
import { UsageChip } from "./features/accounts/index.js";
import { useClaudeAccounts } from "./hooks/useClaudeAccounts.js";
import { Glyph, wordmarkStyle } from "./primitives/Glyph.js";
import {
  actionablePinnedCard,
  actionablePinnedMembers,
  Board,
  inboxWaitingCount,
  membersOf,
  type PinnedCard,
  stubToCard,
} from "./features/board/index.js";
import { DetailPanel } from "./features/detail/index.js";
import {
  ActivityDrawer,
  ActivityPage,
  type ActivityFilter,
} from "./features/activity/index.js";
import {
  StartModal,
  CleanupModal,
  ResetModal,
  CreateTicketModal,
  MultiSelect,
} from "./features/modals/index.js";
import { settingsTabFrom } from "./lib/settings-tab.js";
import { FirstRunSetup } from "./features/setup/index.js";
import { Toast } from "./primitives/Toast.js";
import { Spinner } from "./primitives/Spinner.js";
import { Button } from "./primitives/Button.js";
import {
  isToastVisible,
  undoToastCopy,
  useUndoToast,
} from "./hooks/useUndoToast.js";
import { unwindGroup as unwindGroupApi } from "./lib/api.js";
import { resetCard as resetCardApi } from "./lib/api.js";
import type { UnwindDestination } from "../shared/types.js";
import { UpdateBanner } from "./features/update/index.js";
import { cleanupCard as cleanupCardApi, getCard, getSetup } from "./lib/api.js";
import {
  cleanupAttemptEnded,
  cleanupOutcomeCopy,
  cleanupRequestFailedCopy,
} from "./lib/cleanup-feedback.js";
import { refreshPushSubscription } from "./lib/push.js";
import type { StartRequest } from "./lib/start-request.js";
import type { PrerequisiteStatus, TunnelState } from "../shared/types.js";
import type { CardSearchResult } from "../shared/search.js";
import { DONE_PAGE_SIZE } from "../shared/done-limit.js";

const InboxView = lazy(() =>
  import("./features/inbox/index.js").then((m) => ({ default: m.InboxView })),
);
const OrcaView = lazy(() =>
  import("./features/orca/index.js").then((m) => ({ default: m.OrcaView })),
);
const SettingsScreen = lazy(() =>
  import("./features/settings/index.js").then((m) => ({
    default: m.SettingsScreen,
  })),
);
const AccountsPage = lazy(() =>
  import("./features/accounts/index.js").then((m) => ({
    default: m.AccountsPage,
  })),
);
const PlaybooksPage = lazy(() =>
  import("./features/playbooks/index.js").then((m) => ({
    default: m.PlaybooksPage,
  })),
);
const VaultPage = lazy(() =>
  import("./features/vault/index.js").then((m) => ({
    default: m.VaultPage,
  })),
);
const ArchivePage = lazy(() =>
  import("./features/archive/index.js").then((m) => ({
    default: m.ArchivePage,
  })),
);

const PANEL_FREE_PAGES: ReadonlySet<Page> = new Set([
  "settings",
  "accounts",
  "playbooks",
  "vault",
  "archive",
]);

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

function PageFallback() {
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

function BootScreen({ connection }: { connection: ConnectionStatus }) {
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

export function App() {
  const feed = useActivityFeed();
  const claudeAccounts = useClaudeAccounts();
  const { route, navigate } = useRoute();
  const nav = useNavState();
  const carousel = useMediaQuery(CAROUSEL_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [archiveCount, setArchiveCount] = useState<number | undefined>();
  const [playbookCount, setPlaybookCount] = useState<number | undefined>();
  const [vaultCount, setVaultCount] = useState<number | undefined>();
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>({
    cardId: null,
    types: [],
  });
  const [playbookCreateRequest, setPlaybookCreateRequest] = useState(0);
  const navMode = effectiveNavState(
    nav.collapsed ? "collapsed" : "expanded",
    carousel,
    narrow,
  );
  const [tunnelState, setTunnelState] = useState<TunnelState>({
    status: "off",
  });
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<PinnedCard | null>(null);
  const [pinnedHydrating, setPinnedHydrating] = useState(false);
  const [pinFetchError, setPinFetchError] = useState<{
    id: string;
    kind: "not-found" | "network";
  } | null>(null);
  const pinFetchGenRef = useRef(0);
  const { board, connection } = useBoardStream(doneLimit, {
    onActivity: feed.append,
    onTunnelState: setTunnelState,
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
    window.history.replaceState(null, "", next);
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
    if (route.page === "activity") stampLastOpened("__feed__");
  }, [route.page, feed.events.length]);
  useEffect(() => {
    if (navMode !== "topbar") setSheetOpen(false);
  }, [navMode]);
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
  const newestTs = feed.events[0]?.ts;
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

  useTransitionNotifications(board, connection, selectCard, soundEnabled);

  const cardIdentifiers: Record<string, string> = {};
  for (const card of board?.cards ?? []) {
    cardIdentifiers[card.id] = card.identifier;
  }
  const activityCardIds = new Set(
    feed.events.map((e) => e.cardId).filter((id): id is string => id != null),
  );
  if (activityFilter.cardId != null) activityCardIds.add(activityFilter.cardId);
  const activityCardOptions = [...activityCardIds].map((id) => ({
    id,
    label: cardIdentifiers[id] ?? id,
  }));
  const activityTypeOptions = [
    ...new Set([...feed.events.map((e) => e.type), ...activityFilter.types]),
  ].map((type) => ({ id: type, label: type.replace(/_/g, " ") }));

  const undoToast = useUndoToast();
  const requestUnwind = useCallback(
    (id: string, to: UnwindDestination) => {
      void unwindGroupApi(id, to)
        .then((result) => {
          if (result.ok) {
            undoToast.show(result.archived);
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

  const [startRequest, setStartRequest] = useState<StartRequest | null>(null);
  const startCard =
    board?.cards.find((card) => card.id === startRequest?.cardId) ??
    actionablePinnedCard(startRequest?.cardId, pinned);

  const handleCloseSheet = useCallback(() => {
    setSheetOpen(false);
    requestAnimationFrame(() => document.getElementById("nav-menu")?.focus());
  }, []);

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

  const overlayAboveContent =
    selectedCard != null ||
    activityOpen ||
    sheetOpen ||
    createTicketOpen ||
    cleanupCard != null ||
    resetCard != null ||
    (startCard != null && startRequest != null);

  const [setupState, setSetupState] = useState<
    "loading" | "needsKey" | "ready"
  >("loading");
  const [prerequisites, setPrerequisites] = useState<PrerequisiteStatus[]>([]);
  const [node, setNode] = useState<{
    version: string;
    floor: string;
    ok: boolean;
  } | null>(null);
  const [storage, setStorage] = useState<{ ok: boolean; path: string } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void getSetup()
      .then((s) => {
        if (!active) return;
        setPrerequisites(s.prerequisites);
        setNode(s.node);
        setStorage(s.storage);
        setSetupState(s.needsKey ? "needsKey" : "ready");
      })
      .catch(() => {
        if (active) setSetupState("ready");
      });
    return () => {
      active = false;
    };
  }, []);

  if (setupState === "loading") {
    return <BootScreen connection={connection} />;
  }

  if (setupState === "needsKey" && node && storage) {
    return (
      <FirstRunSetup
        prerequisites={prerequisites}
        node={node}
        storage={storage}
        onConnected={() => setSetupState("ready")}
      />
    );
  }

  if (board === null) {
    return <BootScreen connection={connection} />;
  }

  const accountSlot = claudeAccounts.loaded ? (
    <UsageChip
      accounts={claudeAccounts.accounts}
      activeId={claudeAccounts.activeId}
      compact
      onSwitch={claudeAccounts.switchAccount}
      onRefresh={claudeAccounts.refreshUsage}
      onOpenSettings={() => navigate("accounts")}
    />
  ) : null;

  const inboxCount = inboxWaitingCount(board.cards);
  const pageMeta: Record<Page, { title: string; count?: number }> = {
    board: { title: "Board", count: board.cards.length },
    inbox: { title: "Inbox", count: inboxCount },
    workspace: { title: "Workspace" },
    settings: { title: "Settings" },
    activity: { title: "Activity", count: feed.events.length },
    accounts: {
      title: "Accounts and Usage",
      count: claudeAccounts.loaded ? claudeAccounts.accounts.length : undefined,
    },
    playbooks: { title: "Playbooks", count: playbookCount },
    vault: { title: "Vault", count: vaultCount },
    archive: { title: "Archive", count: archiveCount },
  };
  const pageTitle = pageMeta[route.page].title;

  const sidebar = (
    <SidebarNav
      route={route}
      onNavigate={(page) => {
        navigate(page);
        if (navMode === "topbar") handleCloseSheet();
      }}
      collapsed={navMode === "collapsed"}
      onToggleCollapsed={nav.toggle}
      inboxCount={inboxCount}
      syncedAt={board.syncedAt ?? null}
      connection={connection}
      pollIntervalMs={board.pollIntervalMs ?? null}
      syncWarning={board.syncWarning ?? null}
      syncUnreachable={board.syncUnreachable ?? false}
      accountSlot={accountSlot}
      onOpenCreateTicket={() => {
        setCreateTicketOpen(true);
        if (navMode === "topbar") setSheetOpen(false);
      }}
      onOpenActivity={() => {
        setActivityOpen(true);
        stampLastOpened("__feed__");
        if (navMode === "topbar") setSheetOpen(false);
      }}
      activityUnseen={activityUnseen}
      activityOpen={activityOpen}
      sheet={navMode === "topbar"}
      collapsible={!carousel}
    />
  );

  const pageHeader = (
    <PageHeader
      title={pageTitle}
      count={pageMeta[route.page].count}
      actions={
        route.page === "playbooks" ? (
          <Button
            variant="primary"
            onClick={() => setPlaybookCreateRequest((n) => n + 1)}
          >
            New playbook
          </Button>
        ) : route.page === "activity" ? (
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
        ) : undefined
      }
    />
  );

  return (
    <AppShell
      navWidth={
        navMode === "topbar"
          ? "0px"
          : navMode === "collapsed"
            ? "var(--nav-width-collapsed)"
            : "var(--nav-width)"
      }
      nav={navMode === "topbar" ? null : sidebar}
      contentInert={navMode === "topbar" && sheetOpen}
      topBar={
        navMode === "topbar" ? (
          <TopBar
            title={pageTitle}
            menuOpen={sheetOpen}
            onOpenMenu={() => setSheetOpen(true)}
          />
        ) : null
      }
      banner={<UpdateBanner />}
      header={pageHeader}
      content={
        <PageErrorBoundary key={route.page}>
          <Suspense fallback={<PageFallback />}>
            {route.page === "workspace" ? (
              <OrcaView
                board={board}
                selectedCardId={selectedCard ? selectedCardId : null}
                onSelectCard={selectCard}
              />
            ) : route.page === "inbox" ? (
              <InboxView
                board={board}
                selectedCardId={selectedCard ? selectedCardId : null}
                onSelectCard={selectCard}
              />
            ) : route.page === "settings" ? (
              <SettingsScreen
                tab={settingsTabFrom(route.id)}
                onTabChange={(tab) =>
                  navigate("settings", tab, { replace: true })
                }
                onOpenPage={(page) => navigate(page)}
                onSaved={() => notifyCleanupOutcome("Settings saved.")}
                tunnelState={tunnelState}
                soundEnabled={soundEnabled}
                onToggleSound={setSoundEnabled}
              />
            ) : route.page === "activity" ? (
              <ActivityPage
                events={feed.events}
                identifiers={cardIdentifiers}
                filter={activityFilter}
                onSelectCard={selectCard}
              />
            ) : route.page === "accounts" ? (
              <AccountsPage claudeAccounts={claudeAccounts} />
            ) : route.page === "archive" ? (
              <ArchivePage onCountChange={setArchiveCount} />
            ) : route.page === "playbooks" ? (
              <PlaybooksPage
                createRequest={playbookCreateRequest}
                onCountChange={setPlaybookCount}
              />
            ) : route.page === "vault" ? (
              <VaultPage onCountChange={setVaultCount} />
            ) : (
              <Board
                board={board}
                selectedCardId={selectedCard ? selectedCardId : null}
                onSelectCard={selectCard}
                onStartRequest={requestStart}
                onEditPlaybooks={() => navigate("playbooks")}
                onOpenInbox={() => navigate("inbox")}
                doneTotal={board?.doneCounts?.total}
                doneLimit={doneLimit}
                onLoadMoreDone={() => setDoneLimit((n) => n + DONE_PAGE_SIZE)}
                onSelectSearchResult={selectSearchResult}
                overlayAboveContent={overlayAboveContent}
              />
            )}
          </Suspense>
        </PageErrorBoundary>
      }
      detail={
        <DetailPanel
          accounts={claudeAccounts.accounts}
          card={selectedCard}
          hydrating={pinnedHydrating && !selectedCardInWindow}
          pinFetchError={pinFetchErrorKind}
          onRetryPinFetch={() => {
            if (selectedCardId != null) hydratePinned(selectedCardId);
          }}
          editors={board?.editors}
          activityEvents={feed.events}
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
          docked={route.page === "workspace"}
        />
      }
    >
      {navMode === "topbar" && (
        <NavSheet open={sheetOpen} onClose={handleCloseSheet}>
          {sidebar}
        </NavSheet>
      )}
      <ActivityDrawer
        open={activityOpen}
        events={feed.events}
        identifiers={cardIdentifiers}
        onClose={() => {
          setActivityOpen(false);
          document.getElementById("activity-toggle")?.focus();
        }}
        onSelectCard={(id) => {
          selectCard(id);
          setActivityOpen(false);
        }}
      />
      {startCard && startRequest && (
        <StartModal
          key={`${startRequest.cardId}:${startRequest.newSession === true ? "new" : "start"}`}
          card={startCard}
          newSession={startRequest.newSession === true}
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
      {createTicketOpen && (
        <CreateTicketModal onClose={() => setCreateTicketOpen(false)} />
      )}
      {isToastVisible(undoToast.state) && (
        <Toast
          label={
            undoToast.state.archived
              ? undoToastCopy(undoToast.state.archived)
              : undoToast.state.error
          }
          detail={undoToast.state.archived ? undoToast.state.error : undefined}
          actionLabel={undoToast.state.archived ? "Undo" : undefined}
          actionPending={undoToast.state.undoing}
          onAction={undoToast.undo}
          onClose={undoToast.dismiss}
        />
      )}
    </AppShell>
  );
}
