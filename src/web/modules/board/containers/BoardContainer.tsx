import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import {
  DndContext,
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
import { blocksAgentDoneManualEntry } from "../../../../shared/column-transitions.js";
import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import { inboxWaitingCount } from "../../../../shared/inbox-count.js";
import { membersOf } from "../../../../shared/group-members.js";
import {
  BOARD_SHORTCUTS,
  bindShortcuts,
} from "../../../../shared/shortcuts.js";
import {
  pinFromBoard,
  selectedCardOf,
} from "../../../../shared/pinned-card.js";
import { routeHash } from "../../../../shared/route.js";
import {
  startTarget,
  type StartRequest,
} from "../../../../shared/start-request.js";
import { COLUMNS } from "../../../../shared/types.js";
import type {
  BoardSnapshot,
  Card,
  Column as ColumnId,
} from "../../../../shared/types.js";
import {
  CAROUSEL_QUERY,
  NARROW_QUERY,
} from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useShortcuts } from "@/components/ui/hooks/use-shortcuts";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { BoardLayout } from "@/modules/board/components/BoardLayout";
import { ColumnBody } from "@/modules/board/components/ColumnBody";
import { FailedMoveAlert } from "@/modules/board/components/FailedMoveAlert";
import { SelectionBar } from "@/modules/board/components/SelectionBar";
import { StatusPillSwitcher } from "@/modules/board/components/StatusPillSwitcher";
import { BoardDragOverlay } from "@/modules/board/components/dnd/BoardDragOverlay";
import { DraggableCard } from "@/modules/board/components/dnd/DraggableCard";
import { DroppableColumn } from "@/modules/board/components/dnd/DroppableColumn";
import { boardLanes, nextFocusedCard } from "@/modules/board/domain/board-keys";
import type { BoardDirection } from "@/modules/board/domain/board-keys";
import {
  AUTO_DISMISS_MS,
  failedMoveReducer,
  shouldAutoDismiss,
} from "@/modules/board/domain/failed-move-notice";
import {
  groupMoveCandidates,
  planGroupMove,
} from "@/modules/board/domain/group-move";
import {
  dragSelectionIds,
  isForceDimmed,
  isMultiSelectable,
  pruneSelection,
} from "@/modules/board/domain/drag-selection";
import { suppressCardMoveFlip } from "@/modules/board/hooks/card-move-flip";
import {
  focusCard,
  focusedCardId,
  refocusCard,
} from "@/modules/board/hooks/board-focus";
import { useCarouselColumn } from "@/modules/board/hooks/use-carousel-column";
import {
  useGroupMoveMutation,
  useMoveCardMutation,
} from "@/modules/board/queries/board-queries";
import {
  latestBoard,
  useBoardSnapshotQuery,
} from "@/queries/board-snapshot-queries";
import {
  useResumeCardMutation,
  useStartCardMutation,
} from "@/queries/cards-queries";

export interface BoardContainerProps {
  search?: React.ReactNode;
}

const NO_CARDS: Card[] = [];
const REFUSAL_MS = 3200;
const LARGE_QUERY = "(min-width: 1600px)";

function isColumn(id: unknown): id is ColumnId {
  return typeof id === "string" && (COLUMNS as readonly string[]).includes(id);
}

export function BoardContainer({ search }: BoardContainerProps) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const doneLimit = useAppStore(appStore, (s) => s.doneLimit);
  const storeSelectedId = useAppStore(appStore, (s) => s.selectedCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const groupStartOpen = useAppStore(appStore, (s) => s.groupStart != null);
  const selectionResetToken = useAppStore(
    appStore,
    (s) => s.selectionResetToken,
  );
  const query = useBoardSnapshotQuery(doneLimit);
  const [lastBoard, setLastBoard] = useState<BoardSnapshot | null>(null);
  const board = latestBoard(query.data, lastBoard);
  if (board !== lastBoard) setLastBoard(board);
  const cards = board?.cards ?? NO_CARDS;
  const selectedCardId =
    selectedCardOf(board?.cards, storeSelectedId, pinned) != null
      ? storeSelectedId
      : null;
  const doneTotal = board?.doneCounts?.total;
  const onLoadMoreDone = appStore.loadMoreDone;
  const onSelectCard = (id: string) =>
    appStore.selectCard(id, pinFromBoard(id, cards));
  const onStartRequest = (req: string | StartRequest) =>
    appStore.requestStart(req, startTarget(req, cards));
  const onOpenInbox = () =>
    void router.navigate({ href: routeHash({ page: "inbox" }).slice(1) });
  const onGroupStartRequest = appStore.openGroupStart;

  const moveCard = useMoveCardMutation();
  const groupMove = useGroupMoveMutation();
  const startCard = useStartCardMutation();
  const { mutateAsync: resumeMutate } = useResumeCardMutation();
  const resume = useCallback(
    (id: string) => resumeMutate({ id }),
    [resumeMutate],
  );

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [pendingMoveIds, setPendingMoveIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [prunedFor, setPrunedFor] = useState({ board, pendingMoveIds });
  if (
    board !== prunedFor.board ||
    pendingMoveIds !== prunedFor.pendingMoveIds
  ) {
    setPrunedFor({ board, pendingMoveIds });
    setSelectedIds((prev) => pruneSelection(prev, cards, pendingMoveIds));
  }
  const [resetFor, setResetFor] = useState(selectionResetToken);
  if (selectionResetToken !== resetFor) {
    setResetFor(selectionResetToken);
    setSelectedIds(new Set());
  }

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const activeCard =
    activeCardId != null
      ? (cards.find((c) => c.id === activeCardId) ?? null)
      : null;

  const [refusedColumn, setRefusedColumn] = useState<ColumnId | null>(null);
  useEffect(() => {
    if (refusedColumn == null) return;
    const timer = setTimeout(() => setRefusedColumn(null), REFUSAL_MS);
    return () => clearTimeout(timer);
  }, [refusedColumn]);

  const [failedMove, dispatchFailedMove] = useReducer(failedMoveReducer, null);
  const unmountController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    unmountController.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (failedMove == null || !shouldAutoDismiss(failedMove)) return;
    const id = failedMove.id;
    const timer = setTimeout(
      () => dispatchFailedMove({ type: "dismissed", id }),
      AUTO_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [failedMove]);

  const isCarousel = useMediaQuery(CAROUSEL_QUERY);
  const isPhone = useMediaQuery(NARROW_QUERY);
  const isLarge = useMediaQuery(LARGE_QUERY);
  const { rowRef, activeColumn, selectColumn } = useCarouselColumn(isCarousel);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const groupMembersById = new Map<string, Card[]>();
  for (const card of cards) {
    if (card.source === "group") {
      groupMembersById.set(card.id, membersOf(card, cards));
    }
  }
  const waitingInInbox = inboxWaitingCount(cards);

  function groupMembers() {
    return cards.filter((c) => selectedIds.has(c.id) && isMultiSelectable(c));
  }

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
    if (selectedIds.size === 0 || groupStartOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented)
        setSelectedIds(new Set());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds.size, groupStartOpen]);

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
    onSelectCard(id);
  }

  function performMove(cardId: string, target: ColumnId): boolean {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return false;

    if (card.column === "todo" && target === "in_progress") {
      onStartRequest({ cardId });
      return false;
    }

    if (card.column === target) return false;

    if (blocksAgentDoneManualEntry(target)) {
      setRefusedColumn(target);
      return false;
    }

    setPendingMoveIds((prev) => new Set(prev).add(cardId));
    void moveCard
      .mutateAsync({ id: cardId, column: target })
      .catch((err: unknown) => {
        console.error("moveCard failed; restoring the previous column", err);
      })
      .finally(() => {
        setPendingMoveIds((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      });
    return true;
  }

  function performGroupMove(ids: string[], target: ColumnId) {
    const candidates = groupMoveCandidates(cards, ids, target);
    if (candidates.length === 0) return;
    const plan = planGroupMove(candidates, target);
    if (plan.refused) {
      setRefusedColumn(target);
      return;
    }
    if (plan.moves.length === 0) return;
    setSelectedIds(new Set());
    groupMove.mutate({
      moves: plan.moves,
      column: target,
      onProgress: dispatchFailedMove,
      signal: unmountController.current?.signal,
    });
  }

  const pendingFocusRef = useRef<{ id: string; column: ColumnId } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (
      pending == null ||
      cards.find((c) => c.id === pending.id)?.column !== pending.column
    ) {
      return;
    }
    pendingFocusRef.current = null;
    refocusCard(pending.id);
  }, [cards]);

  const navigateFocus = (direction: BoardDirection) => () =>
    focusCard(
      nextFocusedCard(
        boardLanes(cards),
        focusedCardId(),
        direction,
        isCarousel && activeColumn != null ? COLUMNS.indexOf(activeColumn) : 0,
      ),
    );
  const boardRuns: Partial<Record<string, () => void>> = {
    j: navigateFocus("j"),
    k: navigateFocus("k"),
    h: navigateFocus("h"),
    l: navigateFocus("l"),
    ...Object.fromEntries(
      COLUMNS.map((column, index) => [
        String(index + 1),
        () => {
          const id = focusedCardId();
          if (id == null) return;
          if (performMove(id, column)) {
            pendingFocusRef.current = { id, column };
          } else {
            refocusCard(id);
          }
        },
      ]),
    ),
  };
  useShortcuts(bindShortcuts(BOARD_SHORTCUTS, boardRuns), {
    menuOpen: groupStartOpen || selectedCardId != null,
    scopeId: "board-page",
  });

  function retryStart(card: Card) {
    void startCard
      .mutateAsync({
        id: card.id,
        extraDirection: card.extraDirection ?? "",
        newSession: card.startError?.newSession === true,
      })
      .catch((err: unknown) => {
        console.error("retry startCard failed", err);
      });
  }

  function restart(card: Card) {
    if (card.workspace) {
      void startCard
        .mutateAsync({ id: card.id, extraDirection: card.extraDirection ?? "" })
        .catch((err: unknown) => {
          console.error("restart startCard failed", err);
        });
    } else {
      onStartRequest(card.id);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    armClickSuppression();

    const { active, over } = event;
    if (!over || !isColumn(over.id)) return;

    const ids = dragSelectionIds(String(active.id), selectedIds);
    if (ids != null) {
      if (over.id === "in_progress") {
        const members = groupMembers();
        if (members.length < 2) {
          suppressCardMoveFlip(String(active.id));
          performMove(String(active.id), over.id);
          return;
        }
        onGroupStartRequest(members);
        return;
      }
      for (const id of ids) suppressCardMoveFlip(id);
      performGroupMove(ids, over.id);
      return;
    }

    suppressCardMoveFlip(String(active.id));
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
        const members = groupMembers();
        if (members.length >= 2) {
          return `Opened the new group dialog for ${members.length} tickets.`;
        }
      }
      const plan = planGroupMove(
        groupMoveCandidates(cards, ids, over.id),
        over.id,
      );
      if (plan.refused) {
        return `${COLUMN_LABELS[over.id]} does not accept a manual move.`;
      }
      if (plan.moves.length === 0) {
        return `${ids.length} tickets returned to their original position.`;
      }
      return `Moved ${plan.moves.length} tickets to ${COLUMN_LABELS[over.id]}.`;
    },
    onDragCancel({ active, over }) {
      const ids = dragSelectionIds(String(active.id), selectedIds);
      if (ids == null) {
        return defaultAnnouncements.onDragCancel({ active, over });
      }
      return `Dragging ${ids.length} tickets was cancelled. They returned to their original position.`;
    },
  };

  const renderCard = (card: Card) => (
    <DraggableCard
      key={card.id}
      card={card}
      selected={card.id === selectedCardId}
      multiSelected={selectedIds.has(card.id)}
      forceDimmed={isForceDimmed(card.id, activeCardId, selectedIds)}
      members={groupMembersById.get(card.id)}
      isCarousel={isCarousel}
      onSelect={handleSelectCard}
      onToggleSelect={toggleSelect}
      onMoveTo={performMove}
      onRetryStart={retryStart}
      onRestart={restart}
      resume={resume}
    />
  );

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
        <BoardLayout
          search={search}
          pills={
            isCarousel ? (
              <StatusPillSwitcher
                cards={cards}
                active={activeColumn}
                onSelect={selectColumn}
              />
            ) : null
          }
          rowRef={rowRef}
          isCarousel={isCarousel}
          isLarge={isLarge}
          dragging={activeCardId != null}
        >
          {COLUMNS.map((column) => {
            const columnCards = cards.filter(
              (c) => c.column === column && c.groupId == null,
            );
            return (
              <DroppableColumn
                key={column}
                column={column}
                count={
                  column === "done" && doneTotal != null
                    ? doneTotal
                    : columnCards.length
                }
                manualEntryBlocked={blocksAgentDoneManualEntry(column)}
                refusedDrop={refusedColumn === column}
                resizeDisabled={activeCardId != null}
                isCarousel={isCarousel}
                phone={isPhone}
                large={isLarge}
              >
                <ColumnBody
                  column={column}
                  cards={columnCards}
                  renderCard={renderCard}
                  inboxCount={waitingInInbox}
                  onOpenInbox={onOpenInbox}
                  doneTotal={column === "done" ? doneTotal : undefined}
                  doneLimit={column === "done" ? doneLimit : undefined}
                  onLoadMoreDone={
                    column === "done" ? onLoadMoreDone : undefined
                  }
                />
              </DroppableColumn>
            );
          })}
        </BoardLayout>
        <BoardDragOverlay
          card={activeCard}
          members={
            activeCard != null ? groupMembersById.get(activeCard.id) : undefined
          }
          selected={activeCard != null && activeCard.id === selectedCardId}
          ids={
            activeCardId != null
              ? dragSelectionIds(activeCardId, selectedIds)
              : null
          }
        />
      </DndContext>
      <SelectionBar
        count={selectedIds.size}
        onStartGroup={() => onGroupStartRequest(groupMembers())}
        onClear={() => setSelectedIds(new Set())}
      />
      {failedMove != null && (
        <FailedMoveAlert
          count={failedMove.count}
          onDismiss={() =>
            dispatchFailedMove({ type: "dismissed", id: failedMove.id })
          }
        />
      )}
    </>
  );
}
