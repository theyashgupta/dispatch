import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { inboxFeed } from "../../../../shared/feed-items.js";
import {
  pinFromBoard,
  selectedCardOf,
} from "../../../../shared/pinned-card.js";
import {
  INBOX_ACTIONS,
  runAction,
  snoozeRow,
  type ActionContext,
  type ActionServices,
  type InboxAction,
  type InboxActionId,
  type InboxRowModel,
} from "../../../../shared/item-actions.js";
import { nowMs } from "../../../../shared/format-age.js";
import { isInboxWaiting } from "../../../../shared/inbox-count.js";
import { routeHash } from "../../../../shared/route.js";
import {
  INBOX_SHORTCUTS,
  bindShortcuts,
} from "../../../../shared/shortcuts.js";
import type { SnoozePreset } from "../../../../shared/snooze.js";
import type { BoardSnapshot, Item } from "../../../../shared/types.js";
import {
  stampLastOpened,
  useLastOpened,
} from "@/components/ui/hooks/use-last-opened";
import { useShortcuts } from "@/components/ui/hooks/use-shortcuts";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import { actionServices } from "@/queries/action-services";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import {
  InboxList,
  type InboxOpenMenu,
} from "@/modules/inbox/components/InboxList";
import type {
  InboxMenuKind,
  SlackThreadSlotArgs,
} from "@/modules/inbox/components/InboxRow";
import { InboxToolbar } from "@/modules/inbox/components/InboxToolbar";
import { inboxRowDomId } from "@/modules/inbox/domain/inbox-ids";
import {
  filterInboxRows,
  groupInboxRows,
  mergeInboxRows,
  rowSourceOptions,
  visibleUnreadIds,
  type InboxGroupBy,
  type InboxRange,
} from "@/modules/inbox/domain/inbox-rows";
import {
  usePromoteItemMutation,
  useSetItemStateMutation,
  useSnoozeItemMutation,
} from "@/modules/inbox/queries/inbox-queries";

interface InboxPageProps {
  board: BoardSnapshot;
  items: Item[];
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  services: ActionServices;
  scopeId: string;
  renderSlackThread?: (args: SlackThreadSlotArgs) => ReactNode;
}

export function InboxContainer({
  scopeId,
  renderSlackThread,
}: Pick<InboxPageProps, "scopeId" | "renderSlackThread">) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const errorsInFeeds = useAppStore(appStore, (s) => s.errorsInFeeds);
  const selectedId = useAppStore(appStore, (s) => s.selectedCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const items = useItems(board);
  const enabledSources = board?.enabledSources;
  const rows = useMemo(
    () =>
      inboxFeed(items, errorsInFeeds, enabledSources ?? []).filter(
        (item) => item.source !== "calendar",
      ),
    [items, errorsInFeeds, enabledSources],
  );
  const services = useMemo(
    () =>
      actionServices({
        showUndo: appStore.showUndo,
        notice: appStore.notice,
        openStart: appStore.openStart,
        askAbout: (question) =>
          void router.navigate({
            href: routeHash({ page: "ask", id: question }).slice(1),
          }),
      }),
    [appStore, router],
  );
  if (board == null) return null;
  return (
    <InboxPage
      board={board}
      items={rows}
      selectedCardId={
        selectedCardOf(board.cards, selectedId, pinned) != null
          ? selectedId
          : null
      }
      onSelectCard={(id) =>
        appStore.selectCard(id, pinFromBoard(id, board.cards))
      }
      services={services}
      scopeId={scopeId}
      renderSlackThread={renderSlackThread}
    />
  );
}

function InboxPage({
  board,
  items,
  selectedCardId,
  onSelectCard,
  services,
  scopeId,
  renderSlackThread,
}: InboxPageProps) {
  const lastOpened = useLastOpened();
  const { mutateAsync: setItemState } = useSetItemStateMutation();
  const { mutateAsync: snoozeItem } = useSnoozeItemMutation();
  const { mutateAsync: promoteItem } = usePromoteItemMutation();
  const [search, setSearch] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [range, setRange] = useState<InboxRange>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [groupBy, setGroupBy] = useState<InboxGroupBy>("none");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<InboxOpenMenu | null>(null);
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
  if (cursorIndex >= 0 && cursorIndex !== lastCursorIndex) {
    setLastCursorIndex(cursorIndex);
  }
  const menuRowGone =
    openMenu != null && !visibleRows.some((r) => r.id === openMenu.rowId);
  if (menuRowGone) setOpenMenu(null);

  const ctx: ActionContext = useMemo(
    () => ({
      ...services,
      api: {
        ...services.api,
        setItemState: (id, state) => setItemState({ id, state }),
        snoozeItem: (id, until) => snoozeItem({ id, until }),
        promoteItem: (id, context) => promoteItem({ id, context }),
      },
      openSnooze: (row) => setOpenMenu({ kind: "snooze", rowId: row.id }),
    }),
    [services, setItemState, snoozeItem, promoteItem],
  );

  const handleAction = useCallback(
    (row: InboxRowModel, actionId: InboxActionId) => {
      const action = INBOX_ACTIONS.find((a) => a.id === actionId);
      if (action) void runAction(action, ctx, row);
    },
    [ctx],
  );

  const handlePickAction = useCallback(
    (row: InboxRowModel, action: InboxAction) =>
      void runAction(action, ctx, row),
    [ctx],
  );

  const handlePickSnooze = useCallback(
    (row: InboxRowModel, preset: SnoozePreset) =>
      void snoozeRow(ctx, row, preset, new Date()),
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
      if (row.unread) handleAction(row, "toggleRead");
    },
    [handleAction, onSelectCard],
  );

  const handleMenuOpenChange = useCallback(
    (rowId: string, kind: InboxMenuKind, open: boolean) =>
      setOpenMenu((current) => {
        if (open) return { kind, rowId };
        return current?.rowId === rowId && current.kind === kind
          ? null
          : current;
      }),
    [],
  );

  const handleMoveCursor = (step: number) => {
    if (orderedRows.length === 0) return;
    const next = Math.max(
      0,
      Math.min(orderedRows.length - 1, cursorIndex + step),
    );
    const target = orderedRows[next];
    if (!target) return;
    setCursorId(target.id);
    const el = document.getElementById(inboxRowDomId(target.id));
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
    a: onCursor((row) => handleAction(row, "ask")),
  };
  useShortcuts(bindShortcuts(INBOX_SHORTCUTS, runs), {
    menuOpen: openMenu != null,
    scopeId,
  });

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

  return (
    <>
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
      <InboxList
        totalCount={rows.length}
        visibleRows={visibleRows}
        groups={groups}
        groupBy={groupBy}
        noSource={(board.enabledSources ?? []).length === 0}
        cursorId={cursorRow?.id}
        selectedCardId={selectedCardId}
        expandedId={expandedId}
        openMenu={openMenu}
        onSelect={handleSelect}
        onMenuOpenChange={handleMenuOpenChange}
        onAction={handleAction}
        onPickAction={handlePickAction}
        onPickSnooze={handlePickSnooze}
        onClearFilters={handleClearFilters}
        onOpenSettings={() => {
          window.location.hash = routeHash({ page: "settings" });
        }}
        renderSlackThread={renderSlackThread}
      />
    </>
  );
}
