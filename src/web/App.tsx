import { useEffect, useRef, useState } from "react";
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
import { SyncStrip } from "./features/sync/index.js";
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
import { InboxView } from "./features/inbox/index.js";
import { OrcaView, mostRecentCardId } from "./features/orca/index.js";
import { DetailPanel } from "./features/detail/index.js";
import { ActivityDrawer } from "./features/activity/index.js";
import {
  StartModal,
  CleanupModal,
  CreateTicketModal,
} from "./features/modals/index.js";
import { SettingsScreen, type SettingsTab } from "./features/settings/index.js";
import { FirstRunSetup } from "./features/setup/index.js";
import { UpdateBanner } from "./features/update/index.js";
import { cleanupCard as cleanupCardApi, getCard, getSetup } from "./lib/api.js";
import type { StartRequest } from "./lib/start-request.js";
import type { PrerequisiteStatus, TunnelState } from "../shared/types.js";
import type { CardSearchResult } from "../shared/search.js";
import { DONE_PAGE_SIZE } from "../shared/done-limit.js";

function BootScreen({ connection }: { connection: ConnectionStatus }) {
  const statusText =
    connection === "disconnected"
      ? "Disconnected — reconnecting…"
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
              ? "var(--destructive)"
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
  const [viewMode, setViewMode] = useState<"board" | "workspace">(() => {
    try {
      const stored = localStorage.getItem("dsp.view");
      return stored === "workspace" || stored === "orca"
        ? "workspace"
        : "board";
    } catch {
      return "board";
    }
  });
  const [inboxOpen, setInboxOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dsp.sound") !== "off";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("dsp.view", viewMode);
    } catch {}
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem("dsp.sound", soundEnabled ? "on" : "off");
    } catch {}
  }, [soundEnabled]);

  const lastOpened = useLastOpened();
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

  useEffect(() => {
    if (viewMode !== "workspace" || selectedCard != null || board == null) {
      return;
    }
    const id = mostRecentCardId(lastOpened, board.cards);
    if (id != null) setSelectedCardId(id);
  }, [viewMode, selectedCard, board, lastOpened]);

  useTransitionNotifications(board, connection, selectCard, soundEnabled);

  const cardIdentifiers: Record<string, string> = {};
  for (const card of board?.cards ?? []) {
    cardIdentifiers[card.id] = card.identifier;
  }

  const [startRequest, setStartRequest] = useState<StartRequest | null>(null);
  const startCard =
    board?.cards.find((card) => card.id === startRequest?.cardId) ??
    actionablePinnedCard(startRequest?.cardId, pinned);

  const requestStart = (req: string | StartRequest) => {
    const id = typeof req === "string" ? req : req.cardId;
    const card = board?.cards.find((c) => c.id === id);
    if (card == null) return;
    if (card.groupId != null) return;
    if (card.column !== "todo" && card.sessionLost !== true) return;
    setStartRequest(typeof req === "string" ? { cardId: req } : req);
  };

  const [cleanupCardId, setCleanupCardId] = useState<string | null>(null);
  const [cleanupAttempted, setCleanupAttempted] = useState(false);
  const cleanupCard =
    board?.cards.find((card) => card.id === cleanupCardId) ??
    actionablePinnedCard(cleanupCardId, pinned);

  useEffect(() => {
    setCleanupAttempted(false);
  }, [cleanupCardId]);

  const cleanupBlocked = cleanupCard?.cleanupBlocked;
  const cleanupResolved =
    cleanupAttempted &&
    cleanupCard != null &&
    (cleanupBlocked == null || cleanupBlocked.length === 0) &&
    ((!cleanupCard.tmuxSession && !cleanupCard.workspacePath) ||
      (cleanupCard.cleanupWarning != null &&
        cleanupCard.cleanupWarning.trim() !== ""));
  useEffect(() => {
    if (cleanupResolved) setCleanupCardId(null);
  }, [cleanupResolved]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTab>("filters");
  const [createTicketOpen, setCreateTicketOpen] = useState(false);

  const overlayAboveContent =
    selectedCard != null ||
    activityOpen ||
    settingsOpen ||
    createTicketOpen ||
    cleanupCard != null ||
    (startCard != null && startRequest != null);

  useEffect(() => {
    if (!inboxOpen || overlayAboveContent) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setInboxOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inboxOpen, overlayAboveContent]);

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

  return (
    <AppShell
      header={
        <>
          <UpdateBanner />
          <SyncStrip
            syncedAt={board?.syncedAt ?? null}
            connection={connection}
            pollIntervalMs={board?.pollIntervalMs ?? null}
            syncWarning={board?.syncWarning ?? null}
            syncUnreachable={board?.syncUnreachable ?? false}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenActivity={() => {
              setActivityOpen(true);
              stampLastOpened("__feed__");
            }}
            activityUnseen={activityUnseen}
            activityOpen={activityOpen}
            onOpenInbox={() => setInboxOpen((v) => !v)}
            inboxCount={inboxWaitingCount(board.cards)}
            inboxOpen={inboxOpen}
            onOpenCreateTicket={() => setCreateTicketOpen(true)}
            viewMode={viewMode}
            onSelectViewMode={(mode) => {
              setViewMode(mode);
              if (mode === "workspace") setInboxOpen(false);
            }}
          />
        </>
      }
      content={
        viewMode === "workspace" ? (
          <OrcaView
            board={board}
            selectedCardId={selectedCard ? selectedCardId : null}
            onSelectCard={selectCard}
          />
        ) : inboxOpen ? (
          <InboxView
            board={board}
            selectedCardId={selectedCard ? selectedCardId : null}
            onSelectCard={selectCard}
          />
        ) : (
          <Board
            board={board}
            selectedCardId={selectedCard ? selectedCardId : null}
            onSelectCard={selectCard}
            onStartRequest={requestStart}
            onEditPlaybooks={() => {
              setSettingsInitialTab("playbooks");
              setSettingsOpen(true);
            }}
            onOpenInbox={() => setInboxOpen(true)}
            doneTotal={board?.doneCounts?.total}
            doneLimit={doneLimit}
            onLoadMoreDone={() => setDoneLimit((n) => n + DONE_PAGE_SIZE)}
            onSelectSearchResult={selectSearchResult}
            overlayAboveContent={overlayAboveContent}
          />
        )
      }
      detail={
        <DetailPanel
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
          docked={viewMode === "workspace"}
        />
      }
    >
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
          key={startRequest.cardId}
          card={startCard}
          onClose={() => setStartRequest(null)}
          onEditPlaybooks={() => {
            setStartRequest(null);
            setSettingsInitialTab("playbooks");
            setSettingsOpen(true);
          }}
        />
      )}
      {cleanupCard && (
        <CleanupModal
          key={cleanupCardId}
          card={cleanupCard}
          onConfirm={(force) => {
            setCleanupAttempted(true);
            return cleanupCardApi(cleanupCardId!, force).catch((err) => {
              console.error("cleanupCard failed", err);
              throw err;
            });
          }}
          onClose={() => setCleanupCardId(null)}
        />
      )}
      {settingsOpen && (
        <SettingsScreen
          initialTab={settingsInitialTab}
          tunnelState={tunnelState}
          soundEnabled={soundEnabled}
          onToggleSound={setSoundEnabled}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsInitialTab("filters");
          }}
        />
      )}
      {createTicketOpen && (
        <CreateTicketModal onClose={() => setCreateTicketOpen(false)} />
      )}
    </AppShell>
  );
}
