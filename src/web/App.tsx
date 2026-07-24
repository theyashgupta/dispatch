import { useEffect, useState } from "react";
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
import { Glyph } from "./primitives/Glyph.js";
import { Board, membersOf } from "./features/board/index.js";
import { InboxView } from "./features/inbox/index.js";
import { OrcaView, mostRecentCardId } from "./features/orca/index.js";
import { DetailPanel } from "./features/detail/index.js";
import { ActivityDrawer } from "./features/activity/index.js";
import {
  StartModal,
  CleanupModal,
  SettingsModal,
  CreateTicketModal,
  type SettingsTab,
} from "./features/modals/index.js";
import { FirstRunSetup } from "./features/setup/index.js";
import { UpdateBanner } from "./features/update/index.js";
import { cleanupCard as cleanupCardApi, getSetup } from "./lib/api.js";
import type { StartRequest } from "./lib/start-request.js";
import type { PrerequisiteStatus, TunnelState } from "../shared/types.js";

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
        <span
          style={{
            fontWeight: 800,
            fontSize: "var(--font-display)",
            letterSpacing: "0.18em",
          }}
        >
          DISPATCH
        </span>
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
  const { board, connection } = useBoardStream({
    onActivity: feed.append,
    onTunnelState: setTunnelState,
  });

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"board" | "orca">(() => {
    try {
      return localStorage.getItem("dsp.view") === "orca" ? "orca" : "board";
    } catch {
      return "board";
    }
  });
  const [inboxOpen, setInboxOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("dsp.view", viewMode);
    } catch {}
  }, [viewMode]);

  const lastOpened = useLastOpened();
  const newestTs = feed.events[0]?.ts;
  const activityUnseen = isUnseen(newestTs, lastOpened["__feed__"]);

  const selectedCard =
    board?.cards.find((card) => card.id === selectedCardId) ?? null;
  const selectedCardMembers =
    selectedCard != null && selectedCard.source === "group"
      ? membersOf(selectedCard, board?.cards ?? [])
      : undefined;

  useEffect(() => {
    if (viewMode !== "orca" || selectedCard != null || board == null) {
      return;
    }
    const id = mostRecentCardId(lastOpened, board.cards);
    if (id != null) setSelectedCardId(id);
  }, [viewMode, selectedCard, board, lastOpened]);

  useTransitionNotifications(board, connection, setSelectedCardId);

  const cardIdentifiers: Record<string, string> = {};
  for (const card of board?.cards ?? []) {
    cardIdentifiers[card.id] = card.identifier;
  }

  const [startRequest, setStartRequest] = useState<StartRequest | null>(null);
  const startCard =
    board?.cards.find((card) => card.id === startRequest?.cardId) ?? null;

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
    board?.cards.find((card) => card.id === cleanupCardId) ?? null;

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
            inboxCount={board.cards.filter((c) => c.column === "inbox").length}
            inboxOpen={inboxOpen}
            onOpenCreateTicket={() => setCreateTicketOpen(true)}
            viewMode={viewMode}
            onSelectViewMode={setViewMode}
          />
        </>
      }
      content={
        viewMode === "orca" ? (
          <OrcaView
            board={board}
            selectedCardId={selectedCard ? selectedCardId : null}
            onSelectCard={setSelectedCardId}
          />
        ) : inboxOpen ? (
          <InboxView
            board={board}
            selectedCardId={selectedCard ? selectedCardId : null}
            onSelectCard={setSelectedCardId}
          />
        ) : (
          <Board
            board={board}
            selectedCardId={selectedCard ? selectedCardId : null}
            onSelectCard={setSelectedCardId}
            onStartRequest={requestStart}
            onCleanupRequest={setCleanupCardId}
            onEditPlaybooks={() => {
              setSettingsInitialTab("playbooks");
              setSettingsOpen(true);
            }}
          />
        )
      }
      detail={
        <DetailPanel
          card={selectedCard}
          editors={board?.editors}
          activityEvents={feed.events}
          cardIdentifiers={cardIdentifiers}
          members={selectedCardMembers}
          onClose={() => setSelectedCardId(null)}
          onStartRequest={requestStart}
          docked={viewMode === "orca"}
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
          setSelectedCardId(id);
          setActivityOpen(false);
        }}
      />
      {startCard && startRequest && (
        <StartModal
          key={startRequest.cardId}
          card={startCard}
          onClose={() => setStartRequest(null)}
          onEditPlaybooks={() => {
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
        <SettingsModal
          initialTab={settingsInitialTab}
          tunnelState={tunnelState}
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
