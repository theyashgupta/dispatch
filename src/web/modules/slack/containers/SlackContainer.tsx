import { useEffect, useMemo, useRef } from "react";
import type { BoardSnapshot } from "../../../../shared/types.js";
import { routeHash } from "../../../../shared/route.js";
import { DetailPlaceholder, DetailScroll } from "@/components/DetailPaneBody";
import { SplitPane } from "@/components/SplitPane";
import {
  CAROUSEL_QUERY,
  useMediaQuery,
} from "@/components/ui/hooks/use-media-query";
import { SlackList } from "@/modules/slack/components/SlackList";
import { SlackDetailContainer } from "./SlackDetailContainer";
import {
  groupSlackRows,
  type SlackRow,
} from "@/modules/slack/domain/slack-rows";

interface SlackContainerProps {
  board: BoardSnapshot;
  rows: SlackRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMarkRead: (itemId: string) => void;
  onNotice: (text: string) => void;
  onShowUndo: (label: string, undo: () => Promise<void>) => void;
  onCopyText: (text: string) => Promise<void>;
  onStartAgent: (target: { itemId: string }, prompt: string) => Promise<void>;
}

export function SlackContainer({
  board,
  rows,
  selectedId,
  onSelect,
  onMarkRead,
  onNotice,
  onShowUndo,
  onCopyText,
  onStartAgent,
}: SlackContainerProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const enabled = board.enabledSources?.includes("slack") === true;
  const groups = useMemo(() => groupSlackRows(rows), [rows]);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const hasDetail = enabled && rows.length > 0;
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  function handleSelect(row: SlackRow) {
    onSelect(row.id);
    if (row.unread) onMarkRead(row.id);
  }

  const only = narrow
    ? selectedRow !== null
      ? "detail"
      : "list"
    : hasDetail
      ? undefined
      : "list";

  return (
    <SplitPane
      only={only}
      list={
        <SlackList
          groups={groups}
          selectedId={selectedId}
          narrow={narrow}
          enabled={enabled}
          empty={rows.length === 0}
          onSelect={handleSelect}
          onOpenSettings={() => {
            window.location.hash = routeHash({ page: "settings" });
          }}
        />
      }
      detail={
        selectedRow ? (
          <SlackDetailContainer
            key={selectedRow.id}
            row={selectedRow}
            onBack={narrow ? () => onSelect(null) : undefined}
            onLeave={(id) => {
              if (selectedRef.current === id) onSelect(null);
            }}
            onNotice={onNotice}
            onShowUndo={onShowUndo}
            onCopyText={onCopyText}
            onStartAgent={onStartAgent}
          />
        ) : (
          <DetailScroll>
            <DetailPlaceholder>
              Pick a message to see it here.
            </DetailPlaceholder>
          </DetailScroll>
        )
      }
    />
  );
}
