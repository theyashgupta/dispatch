import { useMemo, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { startAgentFor } from "../../../../shared/item-actions.js";
import type { BoardSnapshot, Item } from "../../../../shared/types.js";
import {
  buildPrRows,
  groupPrRows,
  type PrGroupBy,
  type PrRow,
} from "../../../../shared/pr-rows.js";
import { routeHash } from "../../../../shared/route.js";
import { DetailPlaceholder, DetailScroll } from "@/components/DetailPaneBody";
import { SplitPane } from "@/components/SplitPane";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { moveCard } from "@/queries/cards-api";
import { promoteItem, setItemState } from "@/queries/item-actions-api";
import { PrList } from "@/modules/pull-requests/components/PrList";
import { PrDetailContainer } from "./PrDetailContainer";

interface PullRequestsPageProps {
  board: BoardSnapshot;
  items: Item[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onMarkRead: (itemId: string) => void;
  onStartAgent: (row: PrRow, prompt: string) => void;
  onNotice: (text: string) => void;
}

export function PullRequestsContainer({
  selectedKey,
}: {
  selectedKey: string | null;
}) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const items = useItems(board);
  if (board == null) return null;
  return (
    <PullRequestsPage
      board={board}
      items={items}
      selectedKey={selectedKey}
      onSelect={(key) =>
        void router.navigate({
          href: routeHash({
            page: "pull-requests",
            id: key ?? undefined,
          }).slice(1),
          replace: true,
        })
      }
      onMarkRead={(id) => void setItemState(id, "read")}
      onNotice={appStore.notice}
      onStartAgent={(row, prompt) =>
        void startAgentFor(
          {
            promoteItem,
            moveCard,
            openStart: appStore.openStart,
            notice: appStore.notice,
          },
          { itemId: row.itemId, cardId: row.cardId },
          prompt,
        )
      }
    />
  );
}

function PullRequestsPage({
  board,
  items,
  selectedKey,
  onSelect,
  onMarkRead,
  onStartAgent,
  onNotice,
}: PullRequestsPageProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const [groupBy, setGroupBy] = useState<PrGroupBy>("repo");
  const rows = useMemo(
    () => buildPrRows(items, board.cards),
    [items, board.cards],
  );
  const groups = useMemo(() => groupPrRows(rows, groupBy), [rows, groupBy]);
  const connected = board.enabledSources?.includes("github") === true;
  const partial = board.syncWarning?.startsWith("github ") === true;
  const selectedRow = connected
    ? (rows.find((row) => row.key === selectedKey) ?? null)
    : null;

  function handleSelect(row: PrRow) {
    onSelect(row.key);
    if (row.unread && row.itemId) onMarkRead(row.itemId);
  }

  return (
    <SplitPane
      only={narrow ? (selectedRow !== null ? "detail" : "list") : undefined}
      list={
        <PrList
          groups={groups}
          selectedKey={selectedKey}
          narrow={narrow}
          groupBy={groupBy}
          connected={connected}
          partial={partial}
          empty={rows.length === 0}
          onGroupByChange={setGroupBy}
          onSelect={handleSelect}
          onOpenSettings={() => {
            window.location.hash = routeHash({ page: "settings" });
          }}
        />
      }
      detail={
        selectedRow ? (
          <PrDetailContainer
            key={selectedRow.key}
            row={selectedRow}
            onBack={narrow ? () => onSelect(null) : undefined}
            onStartAgent={onStartAgent}
            onNotice={onNotice}
          />
        ) : (
          <DetailScroll>
            <DetailPlaceholder>
              Select a pull request to see its detail.
            </DetailPlaceholder>
          </DetailScroll>
        )
      }
    />
  );
}
