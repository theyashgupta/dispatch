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
import { StatusPillSwitcher } from "./StatusPillSwitcher.js";
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
  onEditPlaybooks: () => void;
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
  onEditPlaybooks,
}: BoardProps) {
  const [cards, setCards] = useState<CardModel[]>(board?.cards ?? []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = board?.cards ?? [];
    setCards(next);
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const eligible = new Set(
        next
          .filter(
            (c) =>
              c.column === "todo" && c.groupId == null && c.source !== "group",
          )
          .map((c) => c.id),
      );
      const pruned = new Set([...prev].filter((id) => eligible.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
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

  const scrollRowRef = useRef<HTMLDivElement | null>(null);
  const [activeColumn, setActiveColumn] = useState<ColumnId | null>(null);

  useEffect(() => {
    const root = scrollRowRef.current;
    if (!isCarousel || root == null) {
      setActiveColumn(null);
      return;
    }
    const ratios = new Map<ColumnId, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const col = (entry.target as HTMLElement).dataset.column as
            ColumnId | undefined;
          if (col == null) continue;
          ratios.set(col, entry.intersectionRatio);
        }
        let best: ColumnId | null = null;
        let bestRatio = 0.6;
        for (const column of COLUMNS) {
          const ratio = ratios.get(column) ?? 0;
          if (ratio >= bestRatio && best == null) {
            best = column;
            bestRatio = ratio;
          } else if (ratio > bestRatio) {
            best = column;
            bestRatio = ratio;
          }
        }
        if (best != null) setActiveColumn(best);
      },
      { root, threshold: 0.6 },
    );
    for (const el of root.querySelectorAll("[data-column]")) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [isCarousel]);

  function handlePillSelect(column: ColumnId) {
    const el = scrollRowRef.current?.querySelector(`[data-column="${column}"]`);
    el?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }

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
            flexDirection: "column",
          }}
        >
          {isCarousel && (
            <StatusPillSwitcher
              cards={cards}
              active={activeColumn}
              onSelect={handlePillSelect}
            />
          )}
          <div
            ref={scrollRowRef}
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              display: "flex",
              justifyContent: isLarge ? "safe center" : "flex-start",
              gap: isLarge ? "var(--board-gutter-lg)" : "var(--space-lg)",
              padding: isLarge ? "var(--board-gutter-lg)" : "var(--space-lg)",
              overflowX: "auto",
              overflowY: "hidden",
              scrollbarGutter: "auto",
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
        </div>
        <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
          {activeCard ? (
            <CardView
              card={activeCard}
              members={groupMembersById.get(activeCard.id)}
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
          onEditPlaybooks={onEditPlaybooks}
        />
      )}
    </>
  );
}
