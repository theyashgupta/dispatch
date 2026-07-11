import { useEffect, useState } from "react";
import { useBoardStream } from "./hooks/useBoardStream.js";
import { useTransitionNotifications } from "./hooks/useTransitionNotifications.js";
import { SyncStrip } from "./features/sync/SyncStrip.js";
import { Glyph } from "./primitives/Glyph.js";
import { Board } from "./features/board/Board.js";
import { DetailPanel } from "./features/detail/DetailPanel.js";
import { StartModal } from "./features/modals/StartModal.js";
import { CleanupModal } from "./features/modals/CleanupModal.js";
import { SettingsModal } from "./features/modals/SettingsModal.js";
import { cleanupCard as cleanupCardApi } from "./lib/api.js";
import type { StartRequest } from "./lib/start-request.js";

export function App() {
  const { board, connection } = useBoardStream();

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

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
  const cleanupCard =
    board?.cards.find((card) => card.id === cleanupCardId) ?? null;

  const cleanupBlocked = cleanupCard?.cleanupBlocked;
  const cleanupResolved =
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
        onClose={() => setSelectedCardId(null)}
        onStartRequest={requestStart}
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
