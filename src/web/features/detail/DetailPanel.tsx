import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, GripVertical, RotateCw } from "lucide-react";
import type {
  ActivityEvent,
  Card as CardModel,
} from "../../../shared/types.js";
import { ensureTerminal } from "../../lib/api.js";
import type { StartRequest } from "../../lib/start-request.js";
import { stampLastOpened } from "../../hooks/useUnseenActivity.js";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import {
  clearPanelWidth,
  setPanelWidth,
  usePanelWidth,
} from "../../hooks/usePanelWidth.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Button } from "../../primitives/Button.js";
import { Notice } from "../../primitives/Notice.js";
import { CardTimeline } from "./CardTimeline.js";
import { PanelHeader } from "./PanelHeader.js";
import { PreviewRow } from "./PreviewRow.js";
import { UnknownProbeRow } from "./UnknownProbeRow.js";
import { ReferenceBlocks } from "./ReferenceBlocks.js";
import { SessionLostSection } from "./SessionLostSection.js";
import { SessionSwitcher } from "./SessionSwitcher.js";
import { StartAnotherSessionButton } from "./StartAnotherSessionButton.js";
import { TerminalRegion } from "./TerminalRegion.js";

const PANEL_MIN_WIDTH_PX = 360;
const PANEL_MAX_WIDTH_RATIO = 0.9;
const PANEL_KEYBOARD_STEP_PX = 16;

function commitPanelWidth(px: number): void {
  setPanelWidth(px);
}

interface DetailPanelProps {
  card: CardModel | null;
  hydrating?: boolean;
  pinFetchError?: "not-found" | "network" | null;
  onRetryPinFetch?: () => void;
  editors?: { code: boolean; cursor: boolean };
  activityEvents?: ActivityEvent[];
  cardIdentifiers?: Record<string, string>;
  members?: CardModel[];
  membersActionable: boolean;
  onClose: () => void;
  onStartRequest?: (req: string | StartRequest) => void;
  onCleanupRequest?: (id: string) => void;
  docked?: boolean;
}

export function DetailPanel({
  card,
  hydrating = false,
  pinFetchError = null,
  onRetryPinFetch,
  editors,
  activityEvents,
  cardIdentifiers,
  members,
  membersActionable,
  onClose,
  onStartRequest,
  onCleanupRequest,
  docked = false,
}: DetailPanelProps) {
  const open = card != null;

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const isCarousel = useMediaQuery(CAROUSEL_QUERY);
  const isCoarsePointer = useMediaQuery("(pointer: coarse)");
  const takeover = !docked && isCarousel;
  const effectiveFullscreen = fullscreen || takeover;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const pushedHistoryRef = useRef(false);
  const pendingBackRef = useRef(0);
  const panelActive = open && takeover;

  useEffect(() => {
    const entry = window.history.state as { dspPanel?: boolean } | null;
    if (entry?.dspPanel === true) {
      window.history.replaceState(null, "");
    }
    const onPop = () => {
      if (pendingBackRef.current > 0) {
        pendingBackRef.current -= 1;
        return;
      }
      if (!pushedHistoryRef.current) return;
      pushedHistoryRef.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!panelActive) return;
    window.history.pushState({ dspPanel: true }, "");
    pushedHistoryRef.current = true;
    return () => {
      if (!pushedHistoryRef.current) return;
      pushedHistoryRef.current = false;
      pendingBackRef.current += 1;
      window.history.back();
    };
  }, [panelActive]);

  const requestClose = useCallback(() => {
    if (pushedHistoryRef.current) {
      pushedHistoryRef.current = false;
      pendingBackRef.current += 1;
      window.history.back();
    }
    onCloseRef.current();
  }, []);

  const persistedWidth = usePanelWidth();
  const asideRef = useRef<HTMLElement | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const [hoveringHandle, setHoveringHandle] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [handleFocused, setHandleFocused] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [, setViewportWidth] = useState<number>(() => window.innerWidth);

  useEffect(() => {
    return () => cleanupDragRef.current?.();
  }, []);

  useEffect(() => {
    if (resizing) return;
    const node = asideRef.current;
    if (node == null) return;
    const observer = new ResizeObserver(() => {
      setMeasuredWidth(node.getBoundingClientRect().width);
      setViewportWidth(window.innerWidth);
    });
    observer.observe(node);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [resizing]);

  const maxWidthPx = window.innerWidth * PANEL_MAX_WIDTH_RATIO;
  const rawWidthPx = persistedWidth ?? measuredWidth;
  const currentWidthPx =
    rawWidthPx != null
      ? Math.min(maxWidthPx, Math.max(PANEL_MIN_WIDTH_PX, rawWidthPx))
      : null;

  function handleResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const node = asideRef.current;
    if (node == null) return;
    const liveMaxPx = window.innerWidth * PANEL_MAX_WIDTH_RATIO;
    const base = currentWidthPx ?? node.getBoundingClientRect().width;
    const delta =
      e.key === "ArrowLeft" ? PANEL_KEYBOARD_STEP_PX : -PANEL_KEYBOARD_STEP_PX;
    const next = Math.min(
      liveMaxPx,
      Math.max(PANEL_MIN_WIDTH_PX, base + delta),
    );
    commitPanelWidth(next);
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if (cleanupDragRef.current != null) return;
    e.stopPropagation();
    const node = asideRef.current;
    if (node == null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = node.getBoundingClientRect().width;
    const preDragStyleWidth = node.style.width;
    const maxPx = window.innerWidth * PANEL_MAX_WIDTH_RATIO;
    const coarseGesture = e.pointerType !== "mouse";
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.cursor = "col-resize";
    overlay.style.zIndex = "2147483647";
    overlay.style.touchAction = "none";
    document.body.appendChild(overlay);

    function teardown() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      overlay.remove();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      cleanupDragRef.current = null;
    }

    function handlePointerMove(ev: PointerEvent) {
      const next = Math.min(
        maxPx,
        Math.max(PANEL_MIN_WIDTH_PX, startWidth + (startX - ev.clientX)),
      );
      node!.style.width = `${next}px`;
    }

    function handlePointerUp(ev: PointerEvent) {
      teardown();
      setResizing(false);
      const delta = startX - ev.clientX;
      const tapThreshold = coarseGesture ? 8 : 3;
      if (Math.abs(delta) <= tapThreshold) {
        node!.style.width = preDragStyleWidth;
        return;
      }
      const finalWidth = Math.min(
        maxPx,
        Math.max(PANEL_MIN_WIDTH_PX, startWidth + delta),
      );
      node!.style.width = `clamp(${PANEL_MIN_WIDTH_PX}px, ${finalWidth}px, ${PANEL_MAX_WIDTH_RATIO * 100}vw)`;
      commitPanelWidth(finalWidth);
    }

    function handlePointerCancel() {
      teardown();
      setResizing(false);
      node!.style.width = preDragStyleWidth;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    cleanupDragRef.current = handlePointerCancel;
  }

  function handleResizeDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    const node = asideRef.current;
    if (node != null) {
      node.style.width = "var(--panel-width)";
      setMeasuredWidth(node.getBoundingClientRect().width);
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
      if (cleanupDragRef.current != null) {
        cleanupDragRef.current();
        return;
      }
      if (takeover) {
        requestClose();
        return;
      }
      if (fullscreen) setFullscreen(false);
      else if (!docked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, fullscreen, docked, onClose, takeover, requestClose]);

  const spawnedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!card) {
      spawnedForRef.current = null;
      return;
    }
    if (card.activeSession?.ttydPort != null) {
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

  const showStartAnother =
    c != null &&
    c.column !== "done" &&
    c.groupId == null &&
    c.workspacePath != null;

  const hasLiveSession = !!(c?.tmuxSession && !c.sessionLost);
  const activeSessionLost = c?.activeSession != null && !c.tmuxSession;

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
          onClick={requestClose}
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
            : effectiveFullscreen
              ? "100vw"
              : persistedWidth != null
                ? `clamp(${PANEL_MIN_WIDTH_PX}px, ${persistedWidth}px, ${PANEL_MAX_WIDTH_RATIO * 100}vw)`
                : "var(--panel-width)",
          maxWidth: "100vw",
          background: "var(--surface-column)",
          borderLeft:
            docked || effectiveFullscreen ? "none" : "1px solid var(--border)",
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
        {!docked && !effectiveFullscreen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuenow={
              currentWidthPx != null ? Math.round(currentWidthPx) : undefined
            }
            aria-valuemin={PANEL_MIN_WIDTH_PX}
            aria-valuemax={Math.round(maxWidthPx)}
            aria-hidden={!open}
            tabIndex={open ? 0 : -1}
            onPointerDown={handleResizePointerDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={handleResizeDoubleClick}
            onPointerEnter={() => setHoveringHandle(true)}
            onPointerLeave={() => setHoveringHandle(false)}
            onKeyDown={handleResizeKeyDown}
            onFocus={() => setHandleFocused(true)}
            onBlur={() => setHandleFocused(false)}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: isCoarsePointer ? "var(--space-xl)" : "8px",
              height: "100%",
              cursor: "col-resize",
              touchAction: "none",
              zIndex: 3,
              background: "transparent",
              borderLeft:
                hoveringHandle || resizing
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              ...focusRing(handleFocused),
            }}
          >
            {isCoarsePointer && (
              <GripVertical
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  color: "var(--text-muted)",
                }}
              />
            )}
          </div>
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
              onClose={requestClose}
              docked={docked}
              takeover={takeover}
              onStartRequest={onStartRequest}
              onCleanupRequest={onCleanupRequest}
            />

            {(c?.sessionSummaries != null || showStartAnother) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-sm)",
                  padding: "var(--space-sm) var(--space-lg)",
                  paddingLeft: "var(--space-xl)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {c?.sessionSummaries != null && <SessionSwitcher card={c} />}
                {showStartAnother && c != null && (
                  <StartAnotherSessionButton
                    card={c}
                    onStartRequest={onStartRequest}
                    docked={docked}
                    takeover={takeover}
                  />
                )}
              </div>
            )}

            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {hydrating ? (
                <div
                  style={{
                    padding: "var(--space-xl)",
                    color: "var(--text-muted)",
                    fontSize: "var(--font-body)",
                  }}
                >
                  Loading ticket…
                </div>
              ) : pinFetchError != null ? (
                <div
                  className="reading-surface"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-lg)",
                  }}
                >
                  <Notice
                    tone="destructive"
                    icon={
                      <AlertTriangle
                        size={12}
                        strokeWidth={2}
                        aria-hidden="true"
                        style={{ flex: "0 0 auto" }}
                      />
                    }
                    label={
                      pinFetchError === "not-found"
                        ? "This ticket could not be found"
                        : "Couldn't load this ticket"
                    }
                  />
                  <div
                    style={{
                      fontSize: "var(--font-label)",
                      lineHeight: "var(--line-label)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {pinFetchError === "not-found"
                      ? "It may have been deleted or moved out of range."
                      : "Check your connection and try again."}
                  </div>
                  {pinFetchError === "network" && (
                    <Button
                      variant="secondary"
                      onClick={onRetryPinFetch}
                      style={{ alignSelf: "flex-start" }}
                    >
                      <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
                      Retry
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {hasLiveSession ? (
                    detailsExpanded && (
                      <div
                        className="scroll-stable-y reading-surface"
                        style={{
                          flex: "0 1 auto",
                          maxHeight: "40%",
                          overflowY: "auto",
                        }}
                      >
                        <ReferenceBlocks
                          card={c}
                          members={members}
                          membersActionable={membersActionable}
                        />
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
                      className="scroll-stable-y reading-surface"
                      style={{
                        flex: c?.tmuxSession ? "0 1 auto" : "1 1 auto",
                        overflowY: "auto",
                      }}
                    >
                      <ReferenceBlocks
                        card={c}
                        members={members}
                        membersActionable={membersActionable}
                      />
                      {c && (
                        <CardTimeline
                          cardId={c.id}
                          events={activityEvents ?? []}
                          identifiers={cardIdentifiers}
                        />
                      )}
                    </div>
                  )}

                  {c != null &&
                    (c.previewsUnknown != null ||
                      (c.previews != null && c.previews.length > 0)) && (
                      <div
                        className="reading-surface"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--space-sm)",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {c.previews?.map((preview) => (
                          <PreviewRow key={preview.port} preview={preview} />
                        ))}
                        {c.previewsUnknown != null && (
                          <UnknownProbeRow
                            signal="preview"
                            category={c.previewsUnknown.category}
                            partial={(c.previews?.length ?? 0) > 0}
                          />
                        )}
                      </div>
                    )}

                  {hasLiveSession && c && <TerminalRegion card={c} />}

                  {activeSessionLost && (
                    <SessionLostSection
                      card={c}
                      onStartRequest={onStartRequest}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
