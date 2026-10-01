import { useMemo, useState, type CSSProperties } from "react";
import type { BoardSnapshot, Card, Column } from "../../../shared/types.js";
import {
  CAROUSEL_QUERY,
  NARROW_QUERY,
  useMediaQuery,
} from "../../hooks/useMediaQuery.js";
import { useShortcuts } from "../../hooks/useShortcuts.js";
import { routeHash } from "../../../shared/route.js";
import { TICKETS_BINDINGS } from "../../lib/shortcuts.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { Notice } from "../../primitives/Notice.js";
import { ticketActionsFor } from "./ticket-actions.js";
import { TicketRow } from "./TicketRow.js";
import { TicketsToolbar } from "./TicketsToolbar.js";
import {
  filterTicketRows,
  groupTicketRows,
  readTicketsGroupBy,
  ticketRows,
  writeTicketsGroupBy,
  type TicketsGroupBy,
} from "./ticket-rows.js";

interface TicketsPageProps {
  board: BoardSnapshot;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  onStartRequest: (cardId: string) => void;
  onMoveCard: (id: string, column: Column) => Promise<void>;
  onNotice: (message: string) => void;
}

const emptyBlockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  padding: "var(--space-3xl) var(--space-lg)",
  textAlign: "center",
  alignItems: "center",
};

const emptyHeadingStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

const emptyBodyStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

export function TicketsPage({
  board,
  selectedCardId,
  onSelectCard,
  onStartRequest,
  onMoveCard,
  onNotice,
}: TicketsPageProps) {
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<TicketsGroupBy>(() =>
    readTicketsGroupBy(),
  );
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

  function handleGroupByChange(value: TicketsGroupBy) {
    setGroupBy(value);
    writeTicketsGroupBy(value);
  }

  function handleSelect(card: Card) {
    setCursorId(card.id);
    onSelectCard(card.id);
  }

  function isVisibleRow(card: Card) {
    return !document
      .getElementById(`ticket-row-${card.id}`)
      ?.closest("[inert]");
  }

  function handleMoveCursor(step: number) {
    const reachable = orderedRows.filter(isVisibleRow);
    if (reachable.length === 0) return;
    const from = reachable.findIndex((row) => row.id === cursorRow?.id);
    const next = Math.max(
      0,
      Math.min(reachable.length - 1, from < 0 ? 0 : from + step),
    );
    const target = reachable[next];
    if (!target) return;
    setCursorId(target.id);
    const el = document.getElementById(`ticket-row-${target.id}`);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  }

  function handleDone(card: Card) {
    onMoveCard(card.id, "done").catch((err: unknown) => {
      console.warn("[tickets] done failed:", err);
      onNotice("Could not mark the ticket done. Try again.");
    });
  }

  const onVisibleCursor = (fn: (card: Card) => void) => () => {
    if (cursorRow && isVisibleRow(cursorRow)) fn(cursorRow);
  };
  const runs: Record<string, () => void> = {
    j: () => handleMoveCursor(1),
    k: () => handleMoveCursor(-1),
    Enter: onVisibleCursor(handleSelect),
    e: onVisibleCursor((card) => {
      if (ticketActionsFor(card).includes("done")) handleDone(card);
    }),
    o: onVisibleCursor((card) => {
      if (card.url && ticketActionsFor(card).includes("open"))
        window.open(card.url, "_blank", "noopener,noreferrer");
    }),
  };
  useShortcuts(
    TICKETS_BINDINGS.map((entry) => ({
      ...entry,
      run: runs[entry.key] ?? (() => {}),
    })),
    { menuOpen: false, scopeId: "tickets-view" },
  );

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
    <div
      id="tickets-view"
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TicketsToolbar
        search={search}
        onSearchChange={setSearch}
        groupBy={groupBy}
        onGroupByChange={handleGroupByChange}
        visibleCount={visibleRows.length}
        totalCount={rows.length}
      />
      <div
        role={visibleRows.length > 0 && groupBy === "none" ? "list" : undefined}
        className="scroll-stable-y"
        style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
      >
        {rows.length === 0 && !linearEnabled ? (
          <div style={emptyBlockStyle} data-testid="tickets-connect">
            <Notice
              tone="muted"
              label="Connect a source"
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    window.location.hash = routeHash({ page: "settings" });
                  }}
                  style={{ alignSelf: "center" }}
                >
                  Open Settings
                </Button>
              }
            >
              Nothing feeds this page yet. Connect Linear in Settings and its
              tickets land here.
            </Notice>
          </div>
        ) : rows.length === 0 ? (
          <div style={emptyBlockStyle}>
            <div style={emptyHeadingStyle}>No Linear tickets on the board</div>
            <div style={emptyBodyStyle}>
              Tickets that Linear sends to the board will show up here.
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div style={emptyBlockStyle}>
            <div style={emptyHeadingStyle}>No tickets match</div>
            <div style={emptyBodyStyle}>
              Try a different search or clear your filter.
            </div>
            <Button variant="secondary" onClick={() => setSearch("")}>
              Clear filter
            </Button>
          </div>
        ) : groupBy === "none" ? (
          visibleRows.map(renderRow)
        ) : (
          groups.map((group) => (
            <div
              key={group.key}
              style={{ padding: "0 var(--space-lg)" }}
              data-testid="tickets-group"
            >
              <Collapsible
                title={group.label}
                badge={<Chip>{group.rows.length}</Chip>}
                defaultOpen
              >
                <div
                  role="list"
                  style={{ margin: "0 calc(-1 * var(--space-lg))" }}
                >
                  {group.rows.map(renderRow)}
                </div>
              </Collapsible>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
