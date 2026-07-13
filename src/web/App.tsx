import { useEffect, useState } from "react";
import { useBoardStream } from "./hooks/useBoardStream.js";
import { useActivityFeed } from "./hooks/useActivityFeed.js";
import {
  isUnseen,
  stampLastOpened,
  useLastOpened,
} from "./hooks/useUnseenActivity.js";
import { useTransitionNotifications } from "./hooks/useTransitionNotifications.js";
import { SyncStrip } from "./features/sync/SyncStrip.js";
import { Glyph } from "./primitives/Glyph.js";
import { Board } from "./features/board/Board.js";
import { DetailPanel } from "./features/detail/DetailPanel.js";
import { ActivityDrawer } from "./features/activity/ActivityDrawer.js";
import { StartModal } from "./features/modals/StartModal.js";
import { CleanupModal } from "./features/modals/CleanupModal.js";
import { SettingsModal } from "./features/modals/SettingsModal.js";
import { cleanupCard as cleanupCardApi } from "./lib/api.js";
import type { StartRequest } from "./lib/start-request.js";

export function App() {
  const feed = useActivityFeed();
  const { board, connection } = useBoardStream({ onActivity: feed.append });

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  const lastOpened = useLastOpened();
  const newestTs = feed.events[0]?.ts;
  const activityUnseen = isUnseen(newestTs, lastOpened["__feed__"]);

  useTransitionNotifications(board, connection, setSelectedCardId);

  const selectedCard =
    board?.cards.find((card) => card.id === selectedCardId) ?? null;

  const [startRequest, setStartRequest] = useState<StartRequest | null>(null);
  const startCard =
    board?.cards.find((card) => card.id === startRequest?.cardId) ?? null;

  const requestStart = (req: string | StartRequest) => {
    setStartRequest(
      typeof req === "string"
        ? { cardId: req, targetColumn: "in_progress", variant: "full" }
        : req,
    );
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

  if (board === null) {
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

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <SyncStrip
        syncedAt={board?.syncedAt ?? null}
        connection={connection}
        pollIntervalMs={board?.pollIntervalMs ?? null}
        syncWarning={board?.syncWarning ?? null}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenActivity={() => {
          setActivityOpen(true);
          stampLastOpened("__feed__");
        }}
        activityUnseen={activityUnseen}
        activityOpen={activityOpen}
      />
      <Board
        board={board}
        selectedCardId={selectedCard ? selectedCardId : null}
        onSelectCard={setSelectedCardId}
        onStartRequest={requestStart}
        onCleanupRequest={setCleanupCardId}
      />
      <DetailPanel
        card={selectedCard}
        editors={board?.editors}
        activityEvents={feed.events}
        onClose={() => setSelectedCardId(null)}
        onStartRequest={requestStart}
      />
      <ActivityDrawer
        open={activityOpen}
        events={feed.events}
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
          stage={
            startRequest.targetColumn === "in_planning"
              ? "planning"
              : "implementation"
          }
          variant={startRequest.variant}
          targetColumn={startRequest.targetColumn}
          onClose={() => setStartRequest(null)}
        />
      )}
      {cleanupCard && (
        <CleanupModal
          key={cleanupCardId}
          card={cleanupCard}
          onConfirm={(force) => {
            setCleanupAttempted(true);
            void cleanupCardApi(cleanupCardId!, force).catch((err) => {
              console.error("cleanupCard failed", err);
            });
          }}
          onClose={() => setCleanupCardId(null)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
