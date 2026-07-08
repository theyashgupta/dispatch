import { useState } from "react";
import { useBoardStream } from "./hooks/useBoardStream.js";
import { useTransitionNotifications } from "./hooks/useTransitionNotifications.js";
import { SyncStrip } from "./features/SyncStrip.js";
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
