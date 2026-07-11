import { useEffect, useRef, useState } from "react";
import type { Card as CardModel } from "../../../shared/types.js";
import { ensureTerminal } from "../../lib/api.js";
import { stampLastOpened } from "../../hooks/useUnseenActivity.js";
import { PanelHeader } from "./PanelHeader.js";
import { ReferenceBlocks } from "./ReferenceBlocks.js";
import { SessionLostSection } from "./SessionLostSection.js";
import { TerminalRegion } from "./TerminalRegion.js";

interface DetailPanelProps {
  card: CardModel | null;
  editors?: { code: boolean; cursor: boolean };
  onClose: () => void;
  onStartRequest?: (id: string) => void;
}

export function DetailPanel({
  card,
  editors,
  onClose,
  onStartRequest,
}: DetailPanelProps) {
  const open = card != null;

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [prevCardId, setPrevCardId] = useState<string | null>(card?.id ?? null);
  if ((card?.id ?? null) !== prevCardId) {
    setPrevCardId(card?.id ?? null);
    if (card) {
      setDetailsExpanded(false);
      setFullscreen(false);
    }
  }

  const [shown, setShown] = useState<CardModel | null>(card);
  useEffect(() => {
    if (card) {
      setShown(card);
      return;
    }
    const t = setTimeout(() => setShown(null), 200);
    return () => clearTimeout(t);
  }, [card]);

  useEffect(() => {
    if (!card?.id || !card.tmuxSession) return;
    const id = card.id;
    stampLastOpened(id);
    return () => {
      stampLastOpened(id);
      window.setTimeout(() => stampLastOpened(id), 5000);
    };
  }, [card?.id, card?.tmuxSession]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (fullscreen) setFullscreen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, fullscreen, onClose]);

  const spawnedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!card) {
      spawnedForRef.current = null;
      return;
    }
    if (card.ttydPort != null) {
      spawnedForRef.current = null;
      return;
    }
    if (
      card.tmuxSession &&
      !card.sessionLost &&
      card.terminalError == null &&
      spawnedForRef.current !== card.id
    ) {
      spawnedForRef.current = card.id;
      ensureTerminal(card.id).catch((err) => {
        console.error(err);
        if (spawnedForRef.current === card.id) spawnedForRef.current = null;
      });
    }
  }, [card]);

  const c = shown;

  const hasLiveSession = !!(c?.tmuxSession && !c.sessionLost);

  if (!hasLiveSession && (fullscreen || detailsExpanded)) {
    setFullscreen(false);
    setDetailsExpanded(false);
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 150ms ease-out",
          zIndex: 10,
        }}
      />

      <aside
        aria-label="Ticket detail"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100dvh",
          width: fullscreen ? "100vw" : "var(--panel-width)",
          maxWidth: "100vw",
          background: "var(--surface-column)",
          borderLeft: fullscreen ? "none" : "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 150ms ease-out",
          zIndex: 11,
        }}
      >
        <PanelHeader
          card={c}
          editors={editors}
          hasLiveSession={hasLiveSession}
          detailsExpanded={detailsExpanded}
          onToggleDetails={() => setDetailsExpanded((v) => !v)}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((v) => !v)}
          onClose={onClose}
        />

        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {hasLiveSession ? (
            detailsExpanded && (
              <div
                style={{
                  flex: "0 1 auto",
                  maxHeight: "40%",
                  overflowY: "auto",
                  padding: "var(--space-lg)",
                }}
              >
                <ReferenceBlocks card={c} />
              </div>
            )
          ) : (
            <div
              style={{
                flex: c?.tmuxSession ? "0 1 auto" : "1 1 auto",
                overflowY: "auto",
                padding: "var(--space-xl)",
              }}
            >
              <ReferenceBlocks card={c} />
            </div>
          )}

          {c?.tmuxSession && !c.sessionLost && <TerminalRegion card={c} />}

          {c?.sessionLost === true && c.column !== "done" && (
            <SessionLostSection card={c} onStartRequest={onStartRequest} />
          )}
        </div>
      </aside>
    </>
  );
}
