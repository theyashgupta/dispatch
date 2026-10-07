import { useMemo, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { startAgentFor } from "../../../../shared/item-actions.js";
import type { BoardSnapshot, Item } from "../../../../shared/types.js";
import { routeHash } from "../../../../shared/route.js";
import { DetailPlaceholder, DetailScroll } from "@/components/DetailPaneBody";
import { SplitPane } from "@/components/SplitPane";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { actionApi } from "@/queries/action-services";
import { setItemState } from "@/queries/item-actions-api";
import { ErrorList } from "@/modules/errors/components/ErrorList";
import { ErrorDetailContainer } from "./ErrorDetailContainer";
import {
  buildErrorRows,
  groupErrorRows,
  type ErrorGroupBy,
  type ErrorRow,
} from "@/modules/errors/domain/error-rows";

interface ErrorsPageProps {
  board: BoardSnapshot;
  items: Item[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onMarkRead: (itemId: string) => void;
  onStartAgent: (row: ErrorRow, prompt: string, context: string) => void;
  onNotice: (text: string) => void;
}

export function ErrorsContainer({
  selectedKey,
}: {
  selectedKey: string | null;
}) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const boardKey = useAppStore(appStore, (s) => s.board);
  const board = useBoardSnapshot(
    boardKey,
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const items = useItems(board);
  if (board == null) return null;
  return (
    <ErrorsPage
      board={board}
      items={items}
      selectedKey={selectedKey}
      onSelect={(key) =>
        void router.navigate({
          href: routeHash({ page: "errors", id: key ?? undefined }).slice(1),
          replace: true,
        })
      }
      onMarkRead={(id) => void setItemState(id, "read")}
      onNotice={appStore.notice}
      onStartAgent={(row, prompt, context) =>
        void startAgentFor(
          {
            ...actionApi(boardKey),
            openStart: appStore.openStart,
            notice: appStore.notice,
          },
          { itemId: row.itemId, cardId: row.cardId },
          prompt,
          context,
        )
      }
    />
  );
}

function ErrorsPage({
  board,
  items,
  selectedKey,
  onSelect,
  onMarkRead,
  onStartAgent,
  onNotice,
}: ErrorsPageProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const [groupBy, setGroupBy] = useState<ErrorGroupBy>("project");
  const rows = useMemo(() => buildErrorRows(items), [items]);
  const groups = useMemo(() => groupErrorRows(rows, groupBy), [rows, groupBy]);
  const connected = board.enabledSources?.includes("sentry") === true;
  const partial = board.syncWarning?.startsWith("sentry ") === true;
  const selectedRow = connected
    ? (rows.find((row) => row.key === selectedKey) ?? null)
    : null;

  function handleSelect(row: ErrorRow) {
    onSelect(row.key);
    if (row.unread) onMarkRead(row.itemId);
  }

  return (
    <SplitPane
      only={narrow ? (selectedRow !== null ? "detail" : "list") : undefined}
      list={
        <ErrorList
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
          <ErrorDetailContainer
            key={selectedRow.key}
            row={selectedRow}
            onBack={narrow ? () => onSelect(null) : undefined}
            onStartAgent={onStartAgent}
            onNotice={onNotice}
          />
        ) : (
          <DetailScroll>
            {connected && rows.length > 0 && (
              <DetailPlaceholder>
                Select an error to see its details.
              </DetailPlaceholder>
            )}
          </DetailScroll>
        )
      }
    />
  );
}
