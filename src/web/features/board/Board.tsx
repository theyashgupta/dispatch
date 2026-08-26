import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
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
import {
  blocksAgentDoneManualEntry,
  isManualMoveAllowed,
} from "../../../shared/column-transitions.js";
import { COLUMN_LABELS } from "../../lib/event-copy.js";
import { DECK_BACK_OFFSETS_PX, dragSelectionIds } from "./drag-selection.js";
import { Column } from "./Column.js";
import { CardView } from "./CardView.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Notice } from "../../primitives/Notice.js";
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

interface FailedMoveNotice {
  id: number;
  count: number;
  settled: boolean;
  stranded: boolean;
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

  const [failedMove, setFailedMove] = useState<FailedMoveNotice | null>(null);
  const failedMoveIdRef = useRef(0);
  const groupMoveGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (failedMove == null || !failedMove.settled || failedMove.stranded) {
      return;
    }
    const noticeId = failedMove.id;
    const timer = setTimeout(() => {
      setFailedMove((prev) => (prev?.id === noticeId ? null : prev));
    }, 3200);
    return () => clearTimeout(timer);
  }, [failedMove]);

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
    const candidates = cards.filter(
      (c) => cardIds.includes(c.id) && c.column !== targetColumn,
    );
    if (candidates.length === 0) return;

    if (blocksAgentDoneManualEntry(targetColumn)) {
      setRefusedColumn(targetColumn);
      return;
    }

    const moves = candidates
      .filter((c) => isManualMoveAllowed(c.column, targetColumn))
      .map((c) => ({ id: c.id, from: c.column }));
    if (moves.length === 0) return;

    const originalColumnById = new Map(moves.map((m) => [m.id, m.from]));

    const generation = ++groupMoveGenerationRef.current;
    function superseded() {
      return (
        !mountedRef.current || groupMoveGenerationRef.current !== generation
      );
    }

    setCards((prev) =>
      prev.map((c) =>
        originalColumnById.has(c.id) ? { ...c, column: targetColumn } : c,
      ),
    );
    setSelectedIds(new Set());

    const results = await Promise.allSettled(
      moves.map((m) => moveCard(m.id, targetColumn)),
    );

    if (superseded()) return;
    if (results.every((r) => r.status === "fulfilled")) {
      setFailedMove(null);
      return;
    }

    console.error(
      "performGroupMove failed; restoring the previous columns",
      results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r): unknown => r.reason),
    );
    setCards((prev) =>
      prev.map((c) => {
        const from = originalColumnById.get(c.id);
        return from != null && c.column === targetColumn
          ? { ...c, column: from }
          : c;
      }),
    );
    const noticeId = ++failedMoveIdRef.current;
    setFailedMove({
      id: noticeId,
      count: moves.length,
      settled: false,
      stranded: false,
    });
    function markStranded() {
      setFailedMove((prev) =>
        prev?.id === noticeId ? { ...prev, stranded: true } : prev,
      );
    }

    const moved = moves.filter((_, i) => results[i].status === "fulfilled");
    const unrecoverable = moved.filter(
      (m) => !isManualMoveAllowed(targetColumn, m.from),
    );
    if (unrecoverable.length > 0) {
      console.error(
        "performGroupMove cannot compensate a move the manual allowlist refuses; cards stranded",
        unrecoverable.map((m) => m.id),
        targetColumn,
      );
      markStranded();
    }

    const compensationTargets = moved.filter((m) =>
      isManualMoveAllowed(targetColumn, m.from),
    );
    if (superseded()) return;
    const compensationResults = await Promise.allSettled(
      compensationTargets.map((m) => moveCard(m.id, m.from)),
    );
    for (const [i, compensationResult] of compensationResults.entries()) {
      if (compensationResult.status !== "rejected") continue;
      const { id, from } = compensationTargets[i];
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (superseded()) return;
      try {
        await moveCard(id, from);
      } catch (retryErr) {
        console.error(
          "performGroupMove compensation failed after one retry; card stranded",
          id,
          from,
          retryErr,
        );
        markStranded();
      }
    }
    setFailedMove((prev) =>
      prev?.id === noticeId ? { ...prev, settled: true } : prev,
    );
  }

  function selectedGroupMembers() {
    return cards.filter(
      (c) =>
        selectedIds.has(c.id) &&
        c.column === "todo" &&
        c.groupId == null &&
        c.source !== "group",
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    armClickSuppression();

    const { active, over } = event;
    if (!over || !isColumn(over.id)) return;

    const ids = dragSelectionIds(String(active.id), selectedIds);
    if (ids != null) {
      if (over.id === "in_progress") {
        const members = selectedGroupMembers();
        if (members.length < 2) {
          performMove(String(active.id), over.id);
          return;
        }
        setGroupModalMembers(members);
        return;
      }
      void performGroupMove(ids, over.id);
      return;
    }

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
      if (over == null || !isColumn(over.id)) {
        return `${ids.length} tickets returned to their original position.`;
      }
      if (over.id === "in_progress") {
        const members = selectedGroupMembers();
        if (members.length >= 2) {
          return `Opened the new group dialog for ${members.length} tickets.`;
        }
      }
      if (blocksAgentDoneManualEntry(over.id)) {
        return `${COLUMN_LABELS[over.id]} does not accept a manual move.`;
      }
      const moving = ids.filter((id) =>
        cards.some(
          (c) =>
            c.id === id &&
            c.column !== over.id &&
            isManualMoveAllowed(c.column, over.id as ColumnId),
        ),
      );
      if (moving.length === 0) {
        return `${ids.length} tickets returned to their original position.`;
      }
      return `Moved ${moving.length} tickets to ${COLUMN_LABELS[over.id]}.`;
    },
    onDragCancel({ active, over }) {
      const ids = dragSelectionIds(String(active.id), selectedIds);
      if (ids == null) {
        return defaultAnnouncements.onDragCancel({ active, over });
      }
      return `Dragging ${ids.length} tickets was cancelled. They returned to their original position.`;
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
            <div
              style={{ position: "relative", isolation: "isolate" }}
              aria-hidden
              inert
            >
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
              <div style={{ position: "relative", zIndex: 3 }}>
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
              </div>
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
        onStartGroup={() => setGroupModalMembers(selectedGroupMembers())}
        onClear={() => setSelectedIds(new Set())}
      />
      {failedMove != null && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: "var(--space-lg)",
            right: "var(--space-lg)",
            zIndex: 20,
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-float)",
            padding: "var(--space-sm) var(--space-lg)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
          }}
        >
          <Notice
            tone="destructive"
            icon={
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            }
            label={`Couldn't move ${failedMove.count} ${failedMove.count === 1 ? "ticket" : "tickets"}`}
          />
          <IconButton
            aria-label="Dismiss the failed move notice"
            onClick={() => setFailedMove(null)}
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      )}
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
