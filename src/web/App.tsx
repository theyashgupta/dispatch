import { useState } from "react";
import { useBoardStream } from "./hooks/useBoardStream.js";
import { useTransitionNotifications } from "./hooks/useTransitionNotifications.js";
import { SyncStrip } from "./features/SyncStrip.js";
import { Glyph } from "./primitives/Glyph.js";
import { Board } from "./features/Board.js";
import { DetailPanel } from "./features/DetailPanel.js";
import { StartModal } from "./features/StartModal.js";
import { CleanupModal } from "./features/CleanupModal.js";
import { cleanupCard as cleanupCardApi } from "./lib/api.js";

export function App() {
  const { board, connection } = useBoardStream();

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  useTransitionNotifications(board, connection, setSelectedCardId);

  const selectedCard =
    board?.cards.find((card) => card.id === selectedCardId) ?? null;

  const [startCardId, setStartCardId] = useState<string | null>(null);
  const startCard =
    board?.cards.find((card) => card.id === startCardId) ?? null;

  const [cleanupCardId, setCleanupCardId] = useState<string | null>(null);
  const cleanupCard =
    board?.cards.find((card) => card.id === cleanupCardId) ?? null;

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
      />
      <Board
        board={board}
        selectedCardId={selectedCard ? selectedCardId : null}
        onSelectCard={setSelectedCardId}
        onStartRequest={setStartCardId}
        onCleanupRequest={setCleanupCardId}
      />
      <DetailPanel
        card={selectedCard}
        editors={board?.editors}
        onClose={() => setSelectedCardId(null)}
        onStartRequest={setStartCardId}
      />
      {startCard && (
        <StartModal
          key={startCardId}
          card={startCard}
          onClose={() => setStartCardId(null)}
        />
      )}
      {cleanupCard && (
        <CleanupModal
          key={cleanupCardId}
          card={cleanupCard}
          onConfirm={() => {
            void cleanupCardApi(cleanupCardId!).catch((err) => {
              console.error("cleanupCard failed", err);
            });
            setCleanupCardId(null);
          }}
          onClose={() => setCleanupCardId(null)}
        />
      )}
    </div>
  );
}
