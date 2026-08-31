import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../../shared/types.js";
import { Card } from "./Card.js";
import { isForceDimmed } from "./drag-selection.js";
import { EmptyState } from "./EmptyState.js";
import { COLUMN_ACCENT, COLUMN_LABELS } from "./column-meta.js";
import {
  clearColumnWidth,
  setColumnWidth,
  useColumnWidths,
} from "../../hooks/useColumnWidths.js";
import { Button } from "../../primitives/Button.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { DONE_PAGE_SIZE } from "../../../shared/done-limit.js";

const MIN_COL_WIDTH = 220;
const MAX_COL_WIDTH = 480;

interface ColumnProps {
  column: ColumnId;
  cards: CardModel[];
  groupMembersById?: Map<string, CardModel[]>;
  selectedCardId?: string | null;
  selectedIds?: Set<string>;
  activeCardId?: string | null;
  onSelectCard?: (id: string) => void;
  onStartRequest?: (id: string) => void;
  onToggleSelect?: (id: string) => void;
  onMoveTo?: (cardId: string, targetColumn: ColumnId) => void;
  isCarousel?: boolean;
  phone?: boolean;
  large?: boolean;
  manualEntryBlocked?: boolean;
  refusedDrop?: boolean;
  resizeDisabled?: boolean;
  inboxCount?: number;
  onOpenInbox?: () => void;
  doneTotal?: number;
  doneLimit?: number;
  onLoadMoreDone?: () => void;
}

export function Column({
  column,
  cards,
  groupMembersById,
  selectedCardId,
  selectedIds,
  activeCardId,
  onSelectCard,
  onStartRequest,
  onToggleSelect,
  onMoveTo,
  isCarousel,
  phone,
  large,
  manualEntryBlocked,
  refusedDrop,
  resizeDisabled,
  inboxCount,
  onOpenInbox,
  doneTotal,
  doneLimit,
  onLoadMoreDone,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const highlight = isOver && !manualEntryBlocked;
  const refusing =
    manualEntryBlocked === true && (isOver || refusedDrop === true);
  const widths = useColumnWidths();
  const persistedWidth = widths[column];
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const [hoveringHandle, setHoveringHandle] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [handleFocused, setHandleFocused] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  useEffect(() => {
    return () => cleanupDragRef.current?.();
  }, []);

  useEffect(() => {
    const node = wrapperRef.current;
    if (node == null) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width != null) setMeasuredWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const effectiveWidth = Math.min(
    MAX_COL_WIDTH,
    Math.max(MIN_COL_WIDTH, persistedWidth ?? measuredWidth ?? MIN_COL_WIDTH),
  );

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (resizeDisabled) return;
    const node = wrapperRef.current;
    if (node == null) return;
    const startX = e.clientX;
    const startWidth = node.getBoundingClientRect().width;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(ev: PointerEvent) {
      const next = Math.min(
        MAX_COL_WIDTH,
        Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX)),
      );
      node!.style.width = `${next}px`;
      node!.style.flex = "0 0 auto";
    }

    function handlePointerUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      cleanupDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizing(false);
      const delta = ev.clientX - startX;
      if (Math.abs(delta) > 3) {
        const finalWidth = Math.min(
          MAX_COL_WIDTH,
          Math.max(MIN_COL_WIDTH, startWidth + delta),
        );
        setColumnWidth(column, finalWidth);
      } else if (persistedWidth != null) {
        const w = Math.min(
          MAX_COL_WIDTH,
          Math.max(MIN_COL_WIDTH, persistedWidth),
        );
        node!.style.width = `${w}px`;
        node!.style.flex = "0 0 auto";
      } else {
        node!.style.width = "";
        node!.style.flex = "1 1 0";
      }
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
    const node = wrapperRef.current;
    if (node != null) {
      node.style.width = "";
      node.style.flex = "1 1 0";
    }
    clearColumnWidth(column);
  }

  function handleResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (resizeDisabled) return;
    const step = 20;
    let next: number | null = null;
    if (e.key === "ArrowLeft") {
      next = Math.min(
        MAX_COL_WIDTH,
        Math.max(MIN_COL_WIDTH, effectiveWidth - step),
      );
    } else if (e.key === "ArrowRight") {
      next = Math.min(
        MAX_COL_WIDTH,
        Math.max(MIN_COL_WIDTH, effectiveWidth + step),
      );
    } else if (e.key === "Home") {
      next = MIN_COL_WIDTH;
    } else if (e.key === "End") {
      next = MAX_COL_WIDTH;
    }
    if (next == null) return;
    e.preventDefault();
    const node = wrapperRef.current;
    if (node != null) {
      node.style.width = `${next}px`;
      node.style.flex = "0 0 auto";
    }
    setColumnWidth(column, next);
  }

  const doneGroups =
    column === "done"
      ? {
          awaiting: cards.filter(
            (c) => c.tmuxSession != null || c.workspacePath != null,
          ),
          cleaned: cards.filter(
            (c) => c.tmuxSession == null && c.workspacePath == null,
          ),
        }
      : null;

  const doneRemaining =
    column === "done"
      ? Math.max(0, (doneTotal ?? cards.length) - cards.length)
      : 0;
  const doneBatch = Math.min(DONE_PAGE_SIZE, doneRemaining);
  const doneLoadInFlight =
    column === "done" &&
    doneLimit != null &&
    doneLimit > cards.length &&
    doneRemaining > 0;

  const count =
    column === "done" && doneTotal != null ? doneTotal : cards.length;
  const prevCountRef = useRef(count);
  const [countPulse, setCountPulse] = useState(0);
  useEffect(() => {
    if (prevCountRef.current !== count) {
      prevCountRef.current = count;
      setCountPulse((n) => n + 1);
    }
  }, [count]);

  function renderCard(card: CardModel) {
    return (
      <Card
        key={card.id}
        card={card}
        selected={card.id === selectedCardId}
        multiSelected={selectedIds?.has(card.id) ?? false}
        forceDimmed={isForceDimmed(
          card.id,
          activeCardId ?? null,
          selectedIds ?? new Set(),
        )}
        members={groupMembersById?.get(card.id)}
        onSelect={onSelectCard}
        onStartRequest={onStartRequest}
        onToggleSelect={onToggleSelect}
        isCarousel={isCarousel}
        onMoveTo={onMoveTo}
      />
    );
  }

  const sizing =
    !isCarousel && persistedWidth != null
      ? {
          flex: "0 0 auto",
          width: `${Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, persistedWidth))}px`,
        }
      : isCarousel
        ? {
            flex: phone ? "0 0 90vw" : "0 0 80vw",
            scrollSnapAlign: "start" as const,
          }
        : large
          ? { flex: "1 1 0", minWidth: "240px", maxWidth: "360px" }
          : { flex: "1 1 0", minWidth: "220px" };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        wrapperRef.current = node;
      }}
      data-column={column}
      style={{
        ...sizing,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: highlight
          ? "color-mix(in srgb, var(--accent) 12%, var(--surface-column))"
          : refusing
            ? "color-mix(in srgb, var(--status-stale) 8%, var(--surface-column))"
            : "var(--surface-column)",
        border: highlight
          ? "1px solid var(--accent)"
          : refusing
            ? "1px solid var(--status-stale)"
            : "1px solid transparent",
        borderRadius: "var(--radius)",
        padding: "0 var(--space-lg) var(--space-lg)",
        overflow: "hidden",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
      }}
    >
      {!isCarousel && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${COLUMN_LABELS[column]} column`}
          aria-valuenow={effectiveWidth}
          aria-valuemin={MIN_COL_WIDTH}
          aria-valuemax={MAX_COL_WIDTH}
          tabIndex={resizeDisabled ? -1 : 0}
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
            top: 0,
            right: 0,
            width: "6px",
            height: "100%",
            cursor: "col-resize",
            zIndex: 2,
            background: "transparent",
            borderRight: resizing
              ? "2px solid var(--accent)"
              : hoveringHandle
                ? "2px solid var(--hover-resize-handle)"
                : "2px solid transparent",
            ...focusRing(handleFocused, true),
          }}
        />
      )}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          height: "var(--column-header-height)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          background: "var(--surface-column)",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-medium)",
          lineHeight: "var(--line-label)",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
          userSelect: "none",
        }}
      >
        <span
          style={{
            borderBottom: `2px solid ${COLUMN_ACCENT[column]}`,
            paddingBottom: "2px",
          }}
        >
          {COLUMN_LABELS[column]}
        </span>
        <span
          key={countPulse}
          style={{
            background: `color-mix(in srgb, ${COLUMN_ACCENT[column]} 16%, var(--surface-column))`,
            color: COLUMN_ACCENT[column],
            borderRadius: "var(--radius-sm)",
            padding: "0 var(--space-xs)",
            fontSize: "var(--font-micro)",
            ...(countPulse > 0
              ? {
                  animation:
                    "count-pulse var(--motion-count-change) var(--easing-enter)",
                }
              : {}),
          }}
        >
          {count}
        </span>
        {manualEntryBlocked && (
          <span
            title="Agent Done is set automatically by a real agent completion signal — it is never a manual drop target"
            style={{
              color: "var(--text-muted)",
              fontSize: "var(--font-label)",
              fontWeight: "var(--weight-regular)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            Automatic only
          </span>
        )}
      </div>

      {refusing && (
        <div
          role="status"
          style={{
            flex: "0 0 auto",
            marginBottom: "var(--space-sm)",
            padding: "var(--space-xs) var(--space-sm)",
            borderRadius: "var(--radius)",
            background:
              "color-mix(in srgb, var(--status-stale) 14%, var(--surface-column))",
            border: "1px solid var(--status-stale)",
            color: "var(--text)",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-regular)",
            lineHeight: "var(--line-label)",
          }}
        >
          Can&rsquo;t drop here — a card only reaches Agent Done on a real agent
          completion signal.
        </div>
      )}

      <div
        className="scroll-stable-y"
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--inter-card-gap)",
        }}
      >
        {cards.length === 0 ? (
          <EmptyState
            column={column}
            inboxCount={inboxCount}
            onOpenInbox={onOpenInbox}
          />
        ) : doneGroups ? (
          <>
            {doneGroups.awaiting.map(renderCard)}
            {doneGroups.awaiting.length > 0 &&
              doneGroups.cleaned.length > 0 && <CleanedDivider />}
            {doneGroups.cleaned.map(renderCard)}
            {doneRemaining > 0 && (
              <Button
                variant="secondary"
                disabled={doneLoadInFlight}
                onClick={onLoadMoreDone}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  marginTop: "var(--space-sm)",
                }}
              >
                {doneLoadInFlight
                  ? "Loading…"
                  : `Load ${doneBatch} more (${doneRemaining} remaining)`}
              </Button>
            )}
          </>
        ) : (
          cards.map(renderCard)
        )}
      </div>
    </div>
  );
}

function CleanedDivider() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-xs) 0",
      }}
    >
      <div
        style={{
          flex: "1 1 auto",
          height: "1px",
          background: "var(--border)",
        }}
      />
      <span
        style={{
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-medium)",
          lineHeight: "var(--line-label)",
          color: "var(--text-muted)",
          flex: "0 0 auto",
          whiteSpace: "nowrap",
        }}
      >
        Cleaned
      </span>
      <div
        style={{
          flex: "1 1 auto",
          height: "1px",
          background: "var(--border)",
        }}
      />
    </div>
  );
}
