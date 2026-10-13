import { useMemo, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { startAgentFor } from "../../../../shared/item-actions.js";
import type { BoardSnapshot, Item } from "../../../../shared/types.js";
import {
  buildPrRows,
  heldPrItems,
  filterPrRows,
  NO_PR_FILTERS,
  prFilterOptions,
  type PrFilters,
  type PrRow,
} from "../../../../shared/pr-rows.js";
import { pageLocation } from "../../../../shared/route.js";
import { DetailPlaceholder, DetailScroll } from "@/components/DetailPaneBody";
import { SplitPane } from "@/components/SplitPane";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { actionApi } from "@/queries/action-services";
import { setItemState } from "@/queries/item-actions-api";
import { useSourceConnectionQuery } from "@/queries/source-connection-queries";
import { PrList } from "@/modules/pull-requests/components/PrList";
import { prEmptyText } from "@/modules/pull-requests/domain/pr-list-copy";
import { useGithubReposQuery } from "@/modules/pull-requests/queries/pull-requests-queries";
import { PrDetailContainer } from "./PrDetailContainer";
import { useReviewFlow } from "./use-review-flow";

interface PullRequestsPageProps {
  board: BoardSnapshot;
  items: Item[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  login: string | null;
  boardRepos: string[] | null;
  reviewingKey: string | null;
  onReview: (row: PrRow) => void;
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
  const boardKey = useAppStore(appStore, (s) => s.board);
  const board = useBoardSnapshot(
    boardKey,
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const items = useItems(board);
  const connection = useSourceConnectionQuery("github");
  const repos = useGithubReposQuery();
  const { review, reviewingKey } = useReviewFlow();
  if (board == null) return null;
  return (
    <PullRequestsPage
      board={board}
      items={items}
      selectedKey={selectedKey}
      login={connection.data?.account ?? null}
      boardRepos={repos.data?.ok ? repos.data.repos : null}
      reviewingKey={reviewingKey}
      onReview={(row) => void review(row)}
      onSelect={(key) =>
        void router.navigate({
          href: pageLocation(
            { page: "pull-requests", id: key ?? undefined },
            boardKey,
          ),
          replace: true,
        })
      }
      onMarkRead={(id) => void setItemState(id, "read")}
      onNotice={appStore.notice}
      onStartAgent={(row, prompt) =>
        void startAgentFor(
          {
            ...actionApi(boardKey),
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
  login,
  boardRepos,
  reviewingKey,
  onReview,
  onSelect,
  onMarkRead,
  onStartAgent,
  onNotice,
}: PullRequestsPageProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const [filters, setFilters] = useState<PrFilters>(NO_PR_FILTERS);
  const rows = useMemo(
    () =>
      buildPrRows([...items, ...heldPrItems(board.items ?? [])], board.cards),
    [items, board.items, board.cards],
  );
  const visibleRows = useMemo(
    () => filterPrRows(rows, filters, login),
    [rows, filters, login],
  );
  const authors = useMemo(() => prFilterOptions(rows, "author"), [rows]);
  const repoOptions = useMemo(() => prFilterOptions(rows, "repo"), [rows]);
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
          rows={visibleRows}
          selectedKey={selectedKey}
          narrow={narrow}
          connected={connected}
          partial={partial}
          emptyText={prEmptyText({
            repos: boardRepos,
            hasRows: rows.length > 0,
          })}
          filters={filters}
          authors={authors}
          repos={repoOptions}
          reviewingKey={reviewingKey}
          onFiltersChange={setFilters}
          onSelect={handleSelect}
          onReview={onReview}
          onOpenSettings={() => {
            window.location.hash = `#${pageLocation({ page: "settings" }, board.boardKey)}`;
          }}
        />
      }
      detail={
        selectedRow ? (
          <PrDetailContainer
            key={selectedRow.key}
            row={selectedRow}
            onBack={narrow ? () => onSelect(null) : undefined}
            reviewing={reviewingKey === selectedRow.key}
            onReview={onReview}
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
