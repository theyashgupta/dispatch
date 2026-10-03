import { useMemo, useState } from "react";
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
import {
  CAROUSEL_QUERY,
  useMediaQuery,
} from "@/components/ui/hooks/use-media-query";
import { PrList } from "@/modules/pull-requests/components/PrList";
import { PrDetailContainer } from "./PrDetailContainer";

interface PullRequestsContainerProps {
  board: BoardSnapshot;
  items: Item[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onMarkRead: (itemId: string) => void;
  onStartAgent: (row: PrRow, prompt: string) => void;
  onNotice: (text: string) => void;
}

export function PullRequestsContainer({
  board,
  items,
  selectedKey,
  onSelect,
  onMarkRead,
  onStartAgent,
  onNotice,
}: PullRequestsContainerProps) {
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
