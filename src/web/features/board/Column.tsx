import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type {
  Card as CardModel,
  Column as ColumnId,
} from "../../../shared/types.js";
import { Card } from "./Card.js";
import { EmptyState } from "./EmptyState.js";
import { COLUMN_ACCENT, COLUMN_LABELS } from "./column-meta.js";
import {
  clearColumnWidth,
  setColumnWidth,
  useColumnWidths,
} from "../../hooks/useColumnWidths.js";

const MIN_COL_WIDTH = 220;
const MAX_COL_WIDTH = 480;

interface ColumnProps {
  column: ColumnId;
  cards: CardModel[];
  groupMembersById?: Map<string, CardModel[]>;
  selectedCardId?: string | null;
  selectedIds?: Set<string>;
  onSelectCard?: (id: string) => void;
  onStartRequest?: (id: string) => void;
  onToggleSelect?: (id: string) => void;
  onMoveTo?: (cardId: string, targetColumn: ColumnId) => void;
  isCarousel?: boolean;
  phone?: boolean;
  large?: boolean;
  dropDisabled?: boolean;
  resizeDisabled?: boolean;
}

export function Column({
  column,
  cards,
  groupMembersById,
  selectedCardId,
  selectedIds,
  onSelectCard,
  onStartRequest,
  onToggleSelect,
  onMoveTo,
  isCarousel,
  phone,
  large,
  dropDisabled,
  resizeDisabled,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const highlight = isOver && !dropDisabled;
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
          : "var(--surface-column)",
        border: highlight ? "1px solid var(--accent)" : "1px solid transparent",
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
            outline: "none",
            borderRight:
              hoveringHandle || resizing || handleFocused
                ? "2px solid var(--accent)"
                : "2px solid transparent",
          }}
        />
      )}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          height: "var(--column-header-height)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          background: "var(--surface-column)",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
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
          style={{
            background: `color-mix(in srgb, ${COLUMN_ACCENT[column]} 16%, var(--surface-column))`,
            color: COLUMN_ACCENT[column],
            borderRadius: "var(--radius)",
            padding: "0 var(--space-xs)",
            fontSize: "var(--font-label)",
          }}
        >
          {cards.length}
        </span>
      </div>

      <div
        className="scroll-stable-y"
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
        }}
      >
        {cards.length === 0 ? (
          <EmptyState column={column} />
        ) : (
          cards.map((card) => (
            <Card
              key={card.id}
              card={card}
              selected={card.id === selectedCardId}
              multiSelected={selectedIds?.has(card.id) ?? false}
              members={groupMembersById?.get(card.id)}
              onSelect={onSelectCard}
              onStartRequest={onStartRequest}
              onToggleSelect={onToggleSelect}
              isCarousel={isCarousel}
              onMoveTo={onMoveTo}
            />
          ))
        )}
      </div>
    </div>
  );
}
