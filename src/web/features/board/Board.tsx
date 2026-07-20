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
import { COLUMNS } from "../../../shared/types.js";
import type {
  BoardSnapshot,
  Card as CardModel,
  Column as ColumnId,
} from "../../../shared/types.js";
import { Column } from "./Column.js";
import { CardView } from "./CardView.js";
import { SelectionBar } from "./SelectionBar.js";
import { membersOf } from "./group-members.js";
import { GroupStartModal } from "../modals/index.js";
import type { StartRequest } from "../../lib/start-request.js";
import { useLastOpened } from "../../hooks/useUnseenActivity.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { moveCard } from "../../lib/api.js";
import { deriveShowDot, deriveShowGone } from "../../lib/card-badges.js";

interface BoardProps {
  board: BoardSnapshot | null;
  selectedCardId?: string | null;
  onSelectCard?: (id: string) => void;
  onStartRequest?: (req: string | StartRequest) => void;
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

  const groupMembersById = new Map<string, CardModel[]>();
  for (const card of cards) {
    if (card.source === "group") {
      groupMembersById.set(card.id, membersOf(card, cards));
    }
  }

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const activeCard = activeCardId
    ? (cards.find((c) => c.id === activeCardId) ?? null)
    : null;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupModalMembers, setGroupModalMembers] = useState<
    CardModel[] | null
  >(null);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  useEffect(() => {
    if (selectedIds.size === 0 || groupModalMembers != null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedIds(new Set());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds.size, groupModalMembers]);

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
      onStartRequest?.({ cardId });
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
    <>
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
              cards={cards.filter(
                (card) => card.column === column && card.groupId == null,
              )}
              groupMembersById={groupMembersById}
              selectedCardId={selectedCardId}
              selectedIds={selectedIds}
              onSelectCard={handleSelectCard}
              onStartRequest={onStartRequest}
              onToggleSelect={toggleSelect}
              isCarousel={isCarousel}
              phone={isPhone}
              large={isLarge}
              resizeDisabled={activeCardId != null}
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
      <SelectionBar
        count={selectedIds.size}
        onStartGroup={() =>
          setGroupModalMembers(cards.filter((c) => selectedIds.has(c.id)))
        }
        onClear={() => setSelectedIds(new Set())}
      />
      {groupModalMembers != null && (
        <GroupStartModal
          members={groupModalMembers}
          onClose={() => setGroupModalMembers(null)}
          onStarted={() => setSelectedIds(new Set())}
        />
      )}
    </>
  );
}
