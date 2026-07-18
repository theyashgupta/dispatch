import { useEffect, useRef, useState } from "react";
import type {
  ActivityEvent,
  Card as CardModel,
} from "../../../shared/types.js";
import { ensureTerminal } from "../../lib/api.js";
import { stampLastOpened } from "../../hooks/useUnseenActivity.js";
import { CardTimeline } from "./CardTimeline.js";
import { PanelHeader } from "./PanelHeader.js";
import { ReferenceBlocks } from "./ReferenceBlocks.js";
import { SessionLostSection } from "./SessionLostSection.js";
import { TerminalRegion } from "./TerminalRegion.js";

interface DetailPanelProps {
  card: CardModel | null;
  editors?: { code: boolean; cursor: boolean };
  activityEvents?: ActivityEvent[];
  cardIdentifiers?: Record<string, string>;
  onClose: () => void;
  onStartRequest?: (id: string) => void;
  docked?: boolean;
}

export function DetailPanel({
  card,
  editors,
  activityEvents,
  cardIdentifiers,
  onClose,
  onStartRequest,
  docked = false,
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
      else if (!docked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, fullscreen, docked, onClose]);

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
      {!docked && (
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
      )}

      <aside
        aria-label="Ticket detail"
        style={{
          position: "fixed",
          top: docked ? "var(--strip-height)" : 0,
          left: docked ? "var(--orca-nav-width)" : "auto",
          right: 0,
          height: docked ? "calc(100dvh - var(--strip-height))" : "100dvh",
          width: docked
            ? "calc(100% - var(--orca-nav-width))"
            : fullscreen
              ? "100vw"
              : "var(--panel-width)",
          maxWidth: "100vw",
          background: "var(--surface-column)",
          borderLeft: docked || fullscreen ? "none" : "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          transform: docked
            ? "none"
            : open
              ? "translateX(0)"
              : "translateX(100%)",
          transition: docked ? "none" : "transform 150ms ease-out",
          zIndex: 11,
        }}
      >
        {docked && c == null ? (
          <div
            style={{
              flex: "1 1 auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "var(--space-3xl)",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "var(--font-heading)",
                fontWeight: "var(--weight-semibold)",
                color: "var(--text)",
              }}
            >
              Select a ticket
            </h2>
            <p
              style={{
                margin: "var(--space-sm) 0 0",
                fontSize: "var(--font-body)",
                lineHeight: "var(--line-body)",
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              Choose a ticket from the side nav to see its details and live
              terminal.
            </p>
          </div>
        ) : (
          <>
            <PanelHeader
              card={c}
              editors={editors}
              hasLiveSession={hasLiveSession}
              detailsExpanded={detailsExpanded}
              onToggleDetails={() => setDetailsExpanded((v) => !v)}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((v) => !v)}
              onClose={onClose}
              docked={docked}
              onStartRequest={onStartRequest}
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
                    {c && (
                      <CardTimeline
                        cardId={c.id}
                        events={activityEvents ?? []}
                        identifiers={cardIdentifiers}
                      />
                    )}
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
                  {c && (
                    <CardTimeline
                      cardId={c.id}
                      events={activityEvents ?? []}
                      identifiers={cardIdentifiers}
                    />
                  )}
                </div>
              )}

              {c?.tmuxSession && !c.sessionLost && <TerminalRegion card={c} />}

              {c?.sessionLost === true && c.column !== "done" && (
                <SessionLostSection card={c} onStartRequest={onStartRequest} />
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
