import { useMemo, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import {
  pinFromBoard,
  selectedCardOf,
} from "../../../../shared/pinned-card.js";
import { startTarget } from "../../../../shared/start-request.js";
import type { BoardSnapshot, Card, Column } from "../../../../shared/types.js";
import { routeHash } from "../../../../shared/route.js";
import {
  CAROUSEL_QUERY,
  NARROW_QUERY,
} from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { moveCard } from "@/queries/cards-api";
import { TicketRow } from "@/modules/tickets/components/TicketRow";
import { TicketsList } from "@/modules/tickets/components/TicketsList";
import { TicketsPane } from "@/modules/tickets/components/TicketsPane";
import { TicketsToolbar } from "@/modules/tickets/components/TicketsToolbar";
import {
  filterTicketRows,
  groupTicketRows,
  ticketRows,
} from "@/modules/tickets/domain/ticket-rows";
import { useTicketShortcuts } from "@/modules/tickets/hooks/use-ticket-shortcuts";
import { useTicketsGroupBy } from "@/modules/tickets/hooks/use-tickets-group-by";

interface TicketsPageProps {
  board: BoardSnapshot;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  onStartRequest: (cardId: string) => void;
  onMoveCard: (id: string, column: Column) => Promise<void>;
  onNotice: (message: string) => void;
}

const SCOPE_ID = "tickets-view";

export function TicketsContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const selectedId = useAppStore(appStore, (s) => s.selectedCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  if (board == null) return null;
  return (
    <TicketsPage
      board={board}
      selectedCardId={
        selectedCardOf(board.cards, selectedId, pinned) != null
          ? selectedId
          : null
      }
      onSelectCard={(id) =>
        appStore.selectCard(id, pinFromBoard(id, board.cards))
      }
      onStartRequest={(cardId) =>
        appStore.requestStart(cardId, startTarget(cardId, board.cards))
      }
      onMoveCard={moveCard}
      onNotice={appStore.notice}
    />
  );
}

function TicketsPage({
  board,
  selectedCardId,
  onSelectCard,
  onStartRequest,
  onMoveCard,
  onNotice,
}: TicketsPageProps) {
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useTicketsGroupBy();
  const [cursorId, setCursorId] = useState<string | null>(null);
  const iconOnly = useMediaQuery(CAROUSEL_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [lastCursorIndex, setLastCursorIndex] = useState(0);

  const rows = useMemo(() => ticketRows(board.cards), [board.cards]);
  const visibleRows = filterTicketRows(rows, search);
  const groups = groupTicketRows(visibleRows, groupBy);
  const orderedRows = groups.flatMap((g) => g.rows);
  const foundIndex = orderedRows.findIndex((r) => r.id === cursorId);
  const cursorIndex =
    foundIndex >= 0
      ? foundIndex
      : Math.min(lastCursorIndex, orderedRows.length - 1);
  const cursorRow = cursorIndex >= 0 ? orderedRows[cursorIndex] : undefined;
  if (cursorIndex >= 0 && cursorIndex !== lastCursorIndex) {
    setLastCursorIndex(cursorIndex);
  }
  const linearEnabled = (board.enabledSources ?? []).includes("linear");

  function handleSelect(card: Card) {
    setCursorId(card.id);
    onSelectCard(card.id);
  }

  function handleDone(card: Card) {
    onMoveCard(card.id, "done").catch((err: unknown) => {
      console.warn("[tickets] done failed:", err);
      onNotice("Could not mark the ticket done. Try again.");
    });
  }

  useTicketShortcuts({
    scopeId: SCOPE_ID,
    rows: orderedRows,
    cursor: cursorRow,
    onCursorChange: setCursorId,
    onSelect: handleSelect,
    onDone: handleDone,
  });

  const renderRow = (card: Card) => (
    <TicketRow
      key={card.id}
      card={card}
      selected={card.id === cursorRow?.id || card.id === selectedCardId}
      onSelect={() => handleSelect(card)}
      onStart={() => onStartRequest(card.id)}
      onDone={() => handleDone(card)}
      iconOnly={iconOnly}
      narrow={narrow}
    />
  );

  return (
    <TicketsPane
      id={SCOPE_ID}
      toolbar={
        <TicketsToolbar
          search={search}
          onSearchChange={setSearch}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          visibleCount={visibleRows.length}
          totalCount={rows.length}
        />
      }
      listed={visibleRows.length > 0 && groupBy === "none"}
    >
      <TicketsList
        totalCount={rows.length}
        linearEnabled={linearEnabled}
        groupBy={groupBy}
        visibleRows={visibleRows}
        groups={groups}
        renderRow={renderRow}
        onClearSearch={() => setSearch("")}
        onOpenSettings={() => {
          window.location.hash = routeHash({ page: "settings" });
        }}
      />
    </TicketsPane>
  );
}
