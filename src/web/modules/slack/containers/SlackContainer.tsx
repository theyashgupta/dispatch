import { useEffect, useMemo, useRef } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { inboxFeed } from "../../../../shared/feed-items.js";
import { startAgentFor } from "../../../../shared/item-actions.js";
import type { BoardSnapshot } from "../../../../shared/types.js";
import { routeHash } from "../../../../shared/route.js";
import { DetailPlaceholder, DetailScroll } from "@/components/DetailPaneBody";
import { SplitPane } from "@/components/SplitPane";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import { copyText } from "@/queries/action-services";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { actionApi } from "@/queries/action-services";
import { setItemState } from "@/queries/item-actions-api";
import { SlackList } from "@/modules/slack/components/SlackList";
import { SlackDetailContainer } from "./SlackDetailContainer";
import {
  groupSlackRows,
  slackRows,
  type SlackRow,
} from "../../../../shared/slack-rows.js";

interface SlackPageProps {
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

export function SlackContainer({ selectedId }: { selectedId: string | null }) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const boardKey = useAppStore(appStore, (s) => s.board);
  const board = useBoardSnapshot(
    boardKey,
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const errorsInFeeds = useAppStore(appStore, (s) => s.errorsInFeeds);
  const items = useItems(board);
  const enabledSources = board?.enabledSources;
  const rows = useMemo(
    () => slackRows(inboxFeed(items, errorsInFeeds, enabledSources ?? [])),
    [items, errorsInFeeds, enabledSources],
  );
  if (board == null) return null;
  return (
    <SlackPage
      board={board}
      rows={rows}
      selectedId={selectedId}
      onSelect={(id) =>
        void router.navigate({
          href: routeHash({ page: "slack", id: id ?? undefined }).slice(1),
          replace: true,
        })
      }
      onMarkRead={(id) =>
        void setItemState(id, "read").catch(() =>
          appStore.notice("Couldn't mark it read."),
        )
      }
      onNotice={appStore.notice}
      onShowUndo={appStore.showUndo}
      onCopyText={copyText}
      onStartAgent={(target, prompt) =>
        startAgentFor(
          {
            ...actionApi(boardKey),
            openStart: appStore.openStart,
            notice: appStore.notice,
          },
          target,
          prompt,
        )
      }
    />
  );
}

function SlackPage({
  board,
  rows,
  selectedId,
  onSelect,
  onMarkRead,
  onNotice,
  onShowUndo,
  onCopyText,
  onStartAgent,
}: SlackPageProps) {
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
