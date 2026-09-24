import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useShortcuts } from "../../hooks/useShortcuts.js";
import type { BoardSnapshot, Item } from "../../../shared/types.js";
import {
  stampLastOpened,
  useLastOpened,
} from "../../hooks/useUnseenActivity.js";
import {
  INBOX_ACTIONS,
  actionsFor,
  runAction,
  snoozeRow,
  type ActionContext,
  type ActionServices,
  type InboxActionId,
  type InboxRowModel,
} from "../../lib/actions.js";
import { nowMs } from "../../lib/format-age.js";
import { INBOX_SHORTCUTS } from "../../lib/shortcuts.js";
import { SNOOZE_LABELS, SNOOZE_PRESETS } from "../../lib/snooze.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { Glyph } from "../../primitives/Glyph.js";
import { Notice } from "../../primitives/Notice.js";
import { isInboxWaiting } from "../board/index.js";
import { InboxMenu, type InboxMenuItem } from "./InboxMenu.js";
import { InboxRow } from "./InboxRow.js";
import { InboxToolbar } from "./InboxToolbar.js";
import {
  filterInboxRows,
  groupInboxRows,
  mergeInboxRows,
  rowSourceOptions,
  visibleUnreadIds,
  type InboxGroupBy,
  type InboxRange,
} from "./inbox-rows.js";

const toggleRead = INBOX_ACTIONS.find((a) => a.id === "toggleRead");

interface InboxViewProps {
  board: BoardSnapshot;
  items: Item[];
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  services: ActionServices;
}

interface Popover {
  kind: "menu" | "snooze";
  rowId: string;
  anchor: DOMRect;
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

function rowAnchor(id: string): DOMRect {
  return (
    document.getElementById(`inbox-row-${id}`)?.getBoundingClientRect() ??
    new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0)
  );
}

export function InboxView({
  board,
  items,
  selectedCardId,
  onSelectCard,
  services,
}: InboxViewProps) {
  const lastOpened = useLastOpened();
  const [search, setSearch] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [range, setRange] = useState<InboxRange>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [groupBy, setGroupBy] = useState<InboxGroupBy>("none");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [lastCursorIndex, setLastCursorIndex] = useState(0);

  const rows = useMemo(
    () => mergeInboxRows(items, board.cards.filter(isInboxWaiting), lastOpened),
    [items, board.cards, lastOpened],
  );
  const sourceOptions = rowSourceOptions(rows);
  const visibleRows = filterInboxRows(rows, {
    query: search,
    sources: selectedSourceIds,
    range,
    unreadOnly,
    now: nowMs(),
  });
  const unreadIds = visibleUnreadIds(visibleRows);
  const groups = groupInboxRows(visibleRows, groupBy);
  const orderedRows = groups.flatMap((g) => g.rows);
  const foundIndex = orderedRows.findIndex((r) => r.id === cursorId);
  const cursorIndex =
    foundIndex >= 0
      ? foundIndex
      : Math.min(lastCursorIndex, orderedRows.length - 1);
  const cursorRow = cursorIndex >= 0 ? orderedRows[cursorIndex] : undefined;
  useEffect(() => {
    if (cursorIndex >= 0) setLastCursorIndex(cursorIndex);
  }, [cursorIndex]);
  const popoverRow =
    popover == null ? undefined : rows.find((r) => r.id === popover.rowId);
  useEffect(() => {
    if (popover != null && popoverRow == null) setPopover(null);
  }, [popover, popoverRow]);

  const ctx: ActionContext = useMemo(
    () => ({
      ...services,
      openSnooze: (row) =>
        setPopover({
          kind: "snooze",
          rowId: row.id,
          anchor: rowAnchor(row.id),
        }),
    }),
    [services],
  );

  const handleAction = useCallback(
    (row: InboxRowModel, actionId: InboxActionId) => {
      const action = INBOX_ACTIONS.find((a) => a.id === actionId);
      if (action) void runAction(action, ctx, row);
    },
    [ctx],
  );

  const handleSelect = useCallback(
    (row: InboxRowModel) => {
      setCursorId(row.id);
      if (row.kind === "card") {
        stampLastOpened(row.id);
        onSelectCard(row.id);
        return;
      }
      setExpandedId((current) => (current === row.id ? null : row.id));
      if (row.unread && toggleRead) void runAction(toggleRead, ctx, row);
    },
    [ctx, onSelectCard],
  );

  const handleClosePopover = useCallback(() => setPopover(null), []);

  const handleMoveCursor = (step: number) => {
    if (orderedRows.length === 0) return;
    const next = Math.max(
      0,
      Math.min(orderedRows.length - 1, cursorIndex + step),
    );
    const target = orderedRows[next];
    if (!target) return;
    setCursorId(target.id);
    const el = document.getElementById(`inbox-row-${target.id}`);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  };

  const onCursor = (fn: (row: InboxRowModel) => void) => () => {
    if (cursorRow) fn(cursorRow);
  };

  const runs: Record<string, () => void> = {
    j: () => handleMoveCursor(1),
    k: () => handleMoveCursor(-1),
    Enter: onCursor(handleSelect),
    e: onCursor((row) => handleAction(row, "done")),
    s: onCursor((row) => handleAction(row, "snooze")),
    o: onCursor((row) => handleAction(row, "open")),
    u: onCursor((row) => handleAction(row, "toggleRead")),
  };
  useShortcuts(
    INBOX_SHORTCUTS.map((entry) => ({
      ...entry,
      run: runs[entry.key] ?? (() => {}),
    })),
    { menuOpen: popover != null, scopeId: "inbox-view" },
  );

  const menuItems: InboxMenuItem[] =
    popover == null || popoverRow == null
      ? []
      : popover.kind === "menu"
        ? actionsFor(popoverRow).map((a) => ({
            id: a.id,
            label: a.label,
            hint: a.key,
            onPick: () => void runAction(a, ctx, popoverRow),
          }))
        : SNOOZE_PRESETS.map((preset) => ({
            id: preset,
            label: SNOOZE_LABELS[preset],
            onPick: () => void snoozeRow(ctx, popoverRow, preset, new Date()),
          }));

  const noSource = (board.enabledSources ?? []).length === 0;

  const handleMarkAllRead = () => {
    void Promise.allSettled(
      unreadIds.map((id) => ctx.api.setItemState(id, "read")),
    ).then((results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) ctx.notice(`${failed} item(s) could not be marked read`);
    });
  };

  const handleClearFilters = () => {
    setSearch("");
    setSelectedSourceIds([]);
    setRange("all");
    setUnreadOnly(false);
  };

  const renderRow = (row: InboxRowModel) => (
    <InboxRow
      key={row.id}
      row={row}
      selected={
        row.id === cursorRow?.id ||
        (row.kind === "card"
          ? row.id === selectedCardId
          : row.id === expandedId)
      }
      expanded={row.id === expandedId}
      onSelect={handleSelect}
      onOpenMenu={(r, anchor) =>
        setPopover((current) =>
          current?.kind === "menu" && current.rowId === r.id
            ? null
            : { kind: "menu", rowId: r.id, anchor },
        )
      }
      onAction={handleAction}
    />
  );

  return (
    <div
      id="inbox-view"
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <InboxToolbar
        search={search}
        onSearchChange={setSearch}
        sourceOptions={sourceOptions}
        selectedSourceIds={selectedSourceIds}
        onSourcesChange={setSelectedSourceIds}
        range={range}
        onRangeChange={setRange}
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={setUnreadOnly}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        unreadCount={unreadIds.length}
        onMarkAllRead={handleMarkAllRead}
        visibleCount={visibleRows.length}
        totalCount={rows.length}
      />
      <div
        role={visibleRows.length > 0 && groupBy === "none" ? "list" : undefined}
        className="scroll-stable-y"
        style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
      >
        {rows.length === 0 && noSource ? (
          <div style={emptyBlockStyle} data-testid="inbox-connect">
            <Notice
              tone="muted"
              label="Connect a source"
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    window.location.hash = "#/settings";
                  }}
                  style={{ alignSelf: "center" }}
                >
                  Open Settings
                </Button>
              }
            >
              Nothing feeds this Inbox yet. Connect Linear or another source in
              Settings and new work lands here.
            </Notice>
          </div>
        ) : rows.length === 0 ? (
          <div style={emptyBlockStyle}>
            <Glyph size={48} style={{ opacity: 0.08 }} />
            <div style={emptyHeadingStyle}>Inbox is empty</div>
            <div style={emptyBodyStyle}>
              New items and tickets you haven't triaged yet will show up here.
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div style={emptyBlockStyle}>
            <div style={emptyHeadingStyle}>No matching rows</div>
            <div style={emptyBodyStyle}>
              Try a different search or clear your filters.
            </div>
            <Button variant="secondary" onClick={handleClearFilters}>
              Clear filters
            </Button>
          </div>
        ) : groupBy === "none" ? (
          visibleRows.map(renderRow)
        ) : (
          groups.map((group) => (
            <div
              key={group.key}
              style={{ padding: "0 var(--space-lg)" }}
              data-testid="inbox-group"
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
      {popover && popoverRow ? (
        <InboxMenu
          anchor={popover.anchor}
          label={popover.kind === "menu" ? "Row actions" : "Snooze until"}
          items={menuItems}
          onClose={handleClosePopover}
        />
      ) : null}
    </div>
  );
}
