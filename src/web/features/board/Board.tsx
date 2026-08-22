import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  defaultAnnouncements,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  Announcements,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { COLUMNS } from "../../../shared/types.js";
import type {
  BoardSnapshot,
  Card as CardModel,
  Column as ColumnId,
} from "../../../shared/types.js";
import type { CardSearchResult } from "../../../shared/search.js";
import { blocksAgentDoneManualEntry } from "../../../shared/column-transitions.js";
import { COLUMN_LABELS } from "../../lib/event-copy.js";
import { DECK_BACK_OFFSETS_PX, dragSelectionIds } from "./drag-selection.js";
import { Column } from "./Column.js";
import { CardView } from "./CardView.js";
import { SearchBox } from "./SearchBox.js";
import { StatusPillSwitcher } from "./StatusPillSwitcher.js";
import { SelectionBar } from "./SelectionBar.js";
import { membersOf } from "./group-members.js";
import { GroupStartModal } from "../modals/index.js";
import type { StartRequest } from "../../lib/start-request.js";
import { useLastOpened } from "../../hooks/useUnseenActivity.js";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { moveCard } from "../../lib/api.js";
import { deriveShowDot, deriveShowGone } from "../../lib/card-badges.js";
import { inboxWaitingCount } from "./inbox-count.js";

interface BoardProps {
  board: BoardSnapshot | null;
  selectedCardId?: string | null;
  onSelectCard?: (id: string) => void;
  onStartRequest?: (req: string | StartRequest) => void;
  onEditPlaybooks: () => void;
  onOpenInbox?: () => void;
  doneTotal?: number;
  doneLimit?: number;
  onLoadMoreDone?: () => void;
  onSelectSearchResult?: (result: CardSearchResult) => void;
  overlayAboveContent?: boolean;
}

function isColumn(id: unknown): id is ColumnId {
  return typeof id === "string" && (COLUMNS as readonly string[]).includes(id);
}

export function Board({
  board,
  selectedCardId,
  onSelectCard,
  onStartRequest,
  onEditPlaybooks,
  onOpenInbox,
  doneTotal,
  doneLimit,
  onLoadMoreDone,
  onSelectSearchResult,
  overlayAboveContent,
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

  const waitingInInbox = inboxWaitingCount(cards);

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
  const overlayIds =
    activeCardId != null ? dragSelectionIds(activeCardId, selectedIds) : null;

  const isCarousel = useMediaQuery(CAROUSEL_QUERY);
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
    setActiveColumn((prev) => prev ?? COLUMNS[0]);
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
        let bestRatio = 0;
        for (const column of COLUMNS) {
          const ratio = ratios.get(column) ?? 0;
          if (ratio >= 0.6 && ratio > bestRatio) {
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

  const [refusedColumn, setRefusedColumn] = useState<ColumnId | null>(null);

  useEffect(() => {
    if (refusedColumn == null) return;
    const timer = setTimeout(() => setRefusedColumn(null), 3200);
    return () => clearTimeout(timer);
  }, [refusedColumn]);

  const [failedMoveCount, setFailedMoveCount] = useState<number | null>(null);
  const strandedCompensationRef = useRef(false);

  useEffect(() => {
    if (failedMoveCount == null) return;
    const timer = setTimeout(() => {
      if (!strandedCompensationRef.current) setFailedMoveCount(null);
    }, 3200);
    return () => clearTimeout(timer);
  }, [failedMoveCount]);

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

  function performMove(cardId: string, targetColumn: ColumnId) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    if (card.column === "todo" && targetColumn === "in_progress") {
      onStartRequest?.({ cardId });
      return;
    }

    if (card.column === targetColumn) return;

    if (blocksAgentDoneManualEntry(targetColumn)) {
      setRefusedColumn(targetColumn);
      return;
    }

    const previousColumn = card.column;
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, column: targetColumn } : c)),
    );

    moveCard(cardId, targetColumn).catch((err) => {
      console.error("moveCard failed; restoring the previous column", err);
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId && c.column === targetColumn
            ? { ...c, column: previousColumn }
            : c,
        ),
      );
    });
  }

  async function performGroupMove(cardIds: string[], targetColumn: ColumnId) {
    if (blocksAgentDoneManualEntry(targetColumn)) {
      setRefusedColumn(targetColumn);
      return;
    }

    const snapshot = new Map(
      cards
        .filter((c) => cardIds.includes(c.id))
        .map((c) => [c.id, c.column] as const),
    );
    const toMove = cardIds.filter((id) => snapshot.get(id) !== targetColumn);
    if (toMove.length === 0) return;

    setCards((prev) =>
      prev.map((c) =>
        toMove.includes(c.id) ? { ...c, column: targetColumn } : c,
      ),
    );

    const results = await Promise.allSettled(
      toMove.map((id) => moveCard(id, targetColumn)),
    );

    if (results.every((r) => r.status === "fulfilled")) return;

    console.error(
      "performGroupMove failed; restoring the previous columns",
      results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r): unknown => r.reason),
    );
    setCards((prev) =>
      prev.map((c) =>
        toMove.includes(c.id) && c.column === targetColumn
          ? { ...c, column: snapshot.get(c.id)! }
          : c,
      ),
    );
    strandedCompensationRef.current = false;
    setFailedMoveCount(toMove.length);

    const compensationTargets = toMove.filter(
      (_, i) => results[i].status === "fulfilled",
    );
    const compensationResults = await Promise.allSettled(
      compensationTargets.map((id) => moveCard(id, snapshot.get(id)!)),
    );
    for (const [i, compensationResult] of compensationResults.entries()) {
      if (compensationResult.status !== "rejected") continue;
      const id = compensationTargets[i];
      const originalColumn = snapshot.get(id)!;
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        await moveCard(id, originalColumn);
      } catch (retryErr) {
        console.error(
          "performGroupMove compensation failed after one retry; card stranded",
          id,
          originalColumn,
          retryErr,
        );
        strandedCompensationRef.current = true;
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    armClickSuppression();

    const { active, over } = event;
    if (!over || !isColumn(over.id)) return;

    performMove(String(active.id), over.id);
  }

  function handleDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    if (selectedIds.size > 0 && !selectedIds.has(id)) {
      setSelectedIds(new Set());
    }
    setActiveCardId(id);
  }

  const announcements: Announcements = {
    ...defaultAnnouncements,
    onDragStart({ active }) {
      const ids = dragSelectionIds(String(active.id), selectedIds);
      if (ids == null) return defaultAnnouncements.onDragStart({ active });
      return `Picked up ${ids.length} selected tickets.`;
    },
    onDragEnd({ active, over }) {
      const ids = dragSelectionIds(String(active.id), selectedIds);
      if (ids == null) return defaultAnnouncements.onDragEnd({ active, over });
      if (over != null && isColumn(over.id)) {
        return `Moved ${ids.length} tickets to ${COLUMN_LABELS[over.id]}.`;
      }
      return `${ids.length} tickets returned to their original position.`;
    },
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
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
          <div
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              padding: "var(--space-sm) var(--space-lg)",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg)",
            }}
          >
            <SearchBox
              onSelectResult={(result) => onSelectSearchResult?.(result)}
              overlayAboveContent={overlayAboveContent}
            />
          </div>
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
                activeCardId={activeCardId}
                onSelectCard={handleSelectCard}
                onStartRequest={onStartRequest}
                onToggleSelect={toggleSelect}
                onMoveTo={performMove}
                isCarousel={isCarousel}
                phone={isPhone}
                large={isLarge}
                manualEntryBlocked={blocksAgentDoneManualEntry(column)}
                refusedDrop={refusedColumn === column}
                resizeDisabled={activeCardId != null}
                inboxCount={waitingInInbox}
                onOpenInbox={onOpenInbox}
                doneTotal={column === "done" ? doneTotal : undefined}
                doneLimit={column === "done" ? doneLimit : undefined}
                onLoadMoreDone={column === "done" ? onLoadMoreDone : undefined}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
          {activeCard && overlayIds == null ? (
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
          {activeCard && overlayIds != null ? (
            <div style={{ position: "relative" }} aria-hidden inert>
              {DECK_BACK_OFFSETS_PX.slice(
                Math.min(overlayIds.length, 3) === 3 ? 0 : 1,
              ).map((offset) => (
                <div
                  key={offset}
                  style={{
                    position: "absolute",
                    inset: 0,
                    transform:
                      offset === 8
                        ? "translate(8px, 8px)"
                        : "translate(4px, 4px)",
                    zIndex: offset === 8 ? 1 : 2,
                    background: "var(--surface-card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                  }}
                />
              ))}
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
              <span
                style={{
                  position: "absolute",
                  top: "calc(-1 * var(--space-sm))",
                  right: "calc(-1 * var(--space-sm))",
                  zIndex: 4,
                  height: "20px",
                  minWidth: "20px",
                  padding: "0 var(--space-xs)",
                  borderRadius: "10px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--accent)",
                  color: "var(--text)",
                  fontSize: "var(--font-label)",
                  fontWeight: "var(--weight-semibold)",
                  lineHeight: "var(--line-label)",
                }}
              >
                {overlayIds.length}
              </span>
            </div>
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
