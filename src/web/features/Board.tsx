import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { COLUMNS } from "../../shared/types.js";
import type {
  BoardSnapshot,
  Card as CardModel,
  Column as ColumnId,
} from "../../shared/types.js";
import { Column } from "./Column.js";
import { CardView } from "./CardView.js";
import { useLastOpened } from "../hooks/useUnseenActivity.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { moveCard } from "../lib/api.js";
import { deriveShowDot, deriveShowGone } from "../lib/cardBadges.js";

interface BoardProps {
  board: BoardSnapshot | null;
  selectedCardId?: string | null;
  onSelectCard?: (id: string) => void;
  onStartRequest?: (id: string) => void;
  onCleanupRequest?: (id: string) => void;
}

function isColumn(id: unknown): id is ColumnId {
  return typeof id === "string" && (COLUMNS as readonly string[]).includes(id);
}

export function Board({
  board,
  selectedCardId,
  onSelectCard,
  onStartRequest,
  onCleanupRequest,
}: BoardProps) {
  const [cards, setCards] = useState<CardModel[]>(board?.cards ?? []);
  useEffect(() => {
    setCards(board?.cards ?? []);
  }, [board]);

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const activeCard = activeCardId
    ? (cards.find((c) => c.id === activeCardId) ?? null)
    : null;

  const lastOpenedMap = useLastOpened();
  const overlaySelected =
    activeCard != null && activeCard.id === selectedCardId;
  const overlayShowGone = activeCard != null && deriveShowGone(activeCard);
  const overlayShowDot =
    activeCard != null &&
    deriveShowDot(activeCard, overlaySelected, lastOpenedMap);

  const isCarousel = useMediaQuery("(max-width: 1023px)");
  const isPhone = useMediaQuery("(max-width: 767px)");
  const isLarge = useMediaQuery("(min-width: 1600px)");

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const justDroppedRef = useRef(false);

  function armClickSuppression() {
    justDroppedRef.current = true;
    setTimeout(() => {
      justDroppedRef.current = false;
    }, 0);
  }

  function armClickSuppressionUntilPointerUp() {
    justDroppedRef.current = true;
    window.addEventListener(
      "pointerup",
      () => {
        setTimeout(() => {
          justDroppedRef.current = false;
        }, 0);
      },
      { once: true },
    );
  }

  function handleSelectCard(id: string) {
    if (justDroppedRef.current) return;
    onSelectCard?.(id);
  }

  function handleDragEnd(event: DragEndEvent) {
    armClickSuppression();

    const { active, over } = event;
    if (!over || !isColumn(over.id)) return;

    const cardId = String(active.id);
    const targetColumn = over.id;
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    if (card.column === "todo" && targetColumn === "in_progress") {
      onStartRequest?.(cardId);
      return;
    }

    if (card.column === targetColumn) return;

    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, column: targetColumn } : c)),
    );

    moveCard(cardId, targetColumn).catch((err) => {
      console.error("moveCard failed; SSE snapshot will reconcile", err);
    });

    if (targetColumn === "done" && (card.tmuxSession || card.workspacePath)) {
      onCleanupRequest?.(cardId);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }: DragStartEvent) =>
        setActiveCardId(String(active.id))
      }
      onDragEnd={(e) => {
        setActiveCardId(null);
        handleDragEnd(e);
      }}
      onDragCancel={() => {
        setActiveCardId(null);
        armClickSuppressionUntilPointerUp();
      }}
    >
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          display: "flex",
          justifyContent: isLarge ? "safe center" : "flex-start",
          gap: isLarge ? "var(--board-gutter-lg)" : "var(--space-lg)",
          padding: isLarge ? "var(--board-gutter-lg)" : "var(--space-lg)",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType:
            isCarousel && activeCardId == null ? "x mandatory" : "none",
          scrollPaddingInline: "var(--space-lg)",
        }}
      >
        {COLUMNS.map((column) => (
          <Column
            key={column}
            column={column}
            cards={cards.filter((card) => card.column === column)}
            selectedCardId={selectedCardId}
            onSelectCard={handleSelectCard}
            isCarousel={isCarousel}
            phone={isPhone}
            large={isLarge}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
        {activeCard ? (
          <CardView
            card={activeCard}
            selected={overlaySelected}
            showDot={overlayShowDot}
            showGone={overlayShowGone}
            hover={false}
            elevated
            domProps={{ "aria-hidden": true, inert: true }}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
