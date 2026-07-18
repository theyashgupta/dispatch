import { useEffect, useRef, useState } from "react";
import type {
  ActivityEvent,
  Card as CardModel,
} from "../../../shared/types.js";
import { ensureTerminal } from "../../lib/api.js";
import { stampLastOpened } from "../../hooks/useUnseenActivity.js";
import {
  clearPanelWidth,
  setPanelWidth,
  usePanelWidth,
} from "../../hooks/usePanelWidth.js";
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

  const persistedWidth = usePanelWidth();
  const asideRef = useRef<HTMLElement | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const [hoveringHandle, setHoveringHandle] = useState(false);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    return () => cleanupDragRef.current?.();
  }, []);

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const node = asideRef.current;
    if (node == null) return;
    const startX = e.clientX;
    const startWidth = node.getBoundingClientRect().width;
    const maxPx = window.innerWidth * 0.9;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(ev: PointerEvent) {
      const next = Math.min(
        maxPx,
        Math.max(360, startWidth + (startX - ev.clientX)),
      );
      node!.style.width = `${next}px`;
    }

    function handlePointerUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      cleanupDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizing(false);
      const finalWidth = Math.min(
        maxPx,
        Math.max(360, startWidth + (startX - ev.clientX)),
      );
      node!.style.width = fullscreen
        ? "100vw"
        : `clamp(360px, ${finalWidth}px, 90vw)`;
      setPanelWidth(finalWidth);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    cleanupDragRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }

  function handleResizeDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    const node = asideRef.current;
    if (node != null) {
      node.style.width = fullscreen ? "100vw" : "var(--panel-width)";
    }
    clearPanelWidth();
  }

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

  if (docked && fullscreen) {
    setFullscreen(false);
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
        ref={asideRef}
        style={{
          position: "fixed",
          top: docked ? "var(--chrome-top, var(--strip-height))" : 0,
          left: docked ? "var(--orca-nav-width)" : "auto",
          right: 0,
          height: docked
            ? "calc(100dvh - var(--chrome-top, var(--strip-height)))"
            : "100dvh",
          width: docked
            ? "calc(100% - var(--orca-nav-width))"
            : fullscreen
              ? "100vw"
              : persistedWidth != null
                ? `clamp(360px, ${persistedWidth}px, 90vw)`
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
        {!docked && (
          <div
            onPointerDown={handleResizePointerDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={handleResizeDoubleClick}
            onPointerEnter={() => setHoveringHandle(true)}
            onPointerLeave={() => setHoveringHandle(false)}
            aria-label="Resize panel"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "8px",
              height: "100%",
              cursor: "col-resize",
              zIndex: 3,
              background: "transparent",
              borderLeft:
                hoveringHandle || resizing
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
            }}
          />
        )}
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
