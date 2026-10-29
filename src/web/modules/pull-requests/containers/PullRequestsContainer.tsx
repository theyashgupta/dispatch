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
import { SplitPane } from "@/components/SplitPane";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import { useLocalStorage } from "@/components/ui/hooks/use-local-storage";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { actionApi } from "@/queries/action-services";
import { setItemState } from "@/queries/item-actions-api";
import { useSourceConnectionQuery } from "@/queries/source-connection-queries";
import { PrList } from "@/modules/pull-requests/components/PrList";
import { PrDetailSheet } from "@/modules/pull-requests/components/PrDetailSheet";
import { PrListScroll } from "@/modules/pull-requests/components/PrListScroll";
import { PrListSkeleton } from "@/modules/pull-requests/components/PrListSkeleton";
import { PrNoSelection } from "@/modules/pull-requests/components/PrNoSelection";
import { PrRow as PrRowView } from "@/modules/pull-requests/components/PrRow";
import { prEmptyState } from "@/modules/pull-requests/domain/pr-list-copy";
import {
  groupPrRows,
  parsePrGroupBy,
  PR_GROUP_BY_KEY,
} from "@/modules/pull-requests/domain/pr-list-rows";
import { usePrShortcuts } from "@/modules/pull-requests/hooks/use-pr-shortcuts";
import { useGithubReposQuery } from "@/modules/pull-requests/queries/pull-requests-queries";
import type { ReviewStep } from "@/modules/pull-requests/domain/review-flow";
import { PrDetailContainer } from "./PrDetailContainer";
import { useReviewFlow } from "./use-review-flow";

const SCOPE_ID = "pr-list";

interface PullRequestsPageProps {
  board: BoardSnapshot;
  items: Item[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  login: string | null;
  boardRepos: string[] | null;
  reviewingKey: string | null;
  reviewStep: ReviewStep | null;
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
  const { review, reviewingKey, reviewStep } = useReviewFlow();
  if (board == null) return <PullRequestsLoading />;
  return (
    <PullRequestsPage
      board={board}
      items={items}
      selectedKey={selectedKey}
      login={connection.data?.account ?? null}
      boardRepos={repos.data?.ok ? repos.data.repos : null}
      reviewingKey={reviewingKey}
      reviewStep={reviewStep}
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

function PullRequestsLoading() {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  return (
    <SplitPane
      only={narrow ? "list" : undefined}
      list={
        <PrListScroll>
          <PrListSkeleton />
        </PrListScroll>
      }
      detail={<PrNoSelection />}
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
  reviewStep,
  onReview,
  onSelect,
  onMarkRead,
  onStartAgent,
  onNotice,
}: PullRequestsPageProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const [filters, setFilters] = useState<PrFilters>(NO_PR_FILTERS);
  const [groupBy, setGroupBy] = useLocalStorage(PR_GROUP_BY_KEY, (raw) =>
    parsePrGroupBy(typeof raw === "string" ? raw : null),
  );
  const [lastSelectedRow, setLastSelectedRow] = useState<PrRow | null>(null);
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      buildPrRows([...items, ...heldPrItems(board.items ?? [])], board.cards),
    [items, board.items, board.cards],
  );
  const visibleRows = useMemo(
    () => filterPrRows(rows, filters, login),
    [rows, filters, login],
  );
  const groups = useMemo(
    () => groupPrRows(visibleRows, groupBy),
    [visibleRows, groupBy],
  );
  const orderedRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const cursorRow = orderedRows.find((row) => row.key === cursorKey);
  const authors = useMemo(() => prFilterOptions(rows, "author"), [rows]);
  const repoOptions = useMemo(() => prFilterOptions(rows, "repo"), [rows]);
  const connected = board.enabledSources?.includes("github") === true;
  const partial = board.syncWarning?.startsWith("github ") === true;
  const selectedRow = connected
    ? (rows.find((row) => row.key === selectedKey) ?? null)
    : null;

  if (selectedRow !== null && selectedRow !== lastSelectedRow) {
    setLastSelectedRow(selectedRow);
  }
  const sheetRow = selectedRow ?? lastSelectedRow;

  function renderDetail(row: PrRow | null) {
    if (row === null) return <PrNoSelection />;
    return (
      <PrDetailContainer
        key={row.key}
        row={row}
        onBack={narrow ? () => onSelect(null) : undefined}
        reviewBusy={reviewingKey !== null}
        reviewStep={reviewingKey === row.key ? reviewStep : null}
        onReview={onReview}
        onStartAgent={onStartAgent}
        onNotice={onNotice}
      />
    );
  }

  function handleSelect(row: PrRow) {
    setCursorKey(row.key);
    onSelect(row.key);
    if (row.unread && row.itemId) onMarkRead(row.itemId);
  }

  usePrShortcuts({
    scopeId: SCOPE_ID,
    rows: orderedRows,
    cursor: cursorRow,
    onCursorChange: setCursorKey,
    onSelect: handleSelect,
  });

  return (
    <>
      <SplitPane
        only={narrow ? "list" : undefined}
        list={
          <PrList
            id={SCOPE_ID}
            groups={groups}
            rows={orderedRows}
            groupBy={groupBy}
            connected={connected}
            partial={partial}
            empty={prEmptyState({
              repos: boardRepos,
              hasRows: rows.length > 0,
            })}
            filters={filters}
            authors={authors}
            repos={repoOptions}
            renderRow={(row) => (
              <PrRowView
                key={row.key}
                row={row}
                selected={row.key === selectedKey}
                narrow={narrow}
                reviewingKey={reviewingKey}
                onSelect={() => handleSelect(row)}
                onReview={() => onReview(row)}
              />
            )}
            onFiltersChange={setFilters}
            onGroupByChange={setGroupBy}
            onClearFilters={() => setFilters(NO_PR_FILTERS)}
            onOpenSettings={() => {
              window.location.hash = `#${pageLocation({ page: "settings" }, board.boardKey)}`;
            }}
          />
        }
        detail={narrow ? null : renderDetail(selectedRow)}
      />
      {narrow && (
        <PrDetailSheet
          open={selectedRow !== null}
          title={sheetRow?.title ?? ""}
          onClose={() => onSelect(null)}
        >
          {renderDetail(sheetRow)}
        </PrDetailSheet>
      )}
    </>
  );
}
