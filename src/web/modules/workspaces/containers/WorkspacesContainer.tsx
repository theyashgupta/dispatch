import { useEffect, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { pinFromBoard } from "../../../../shared/pinned-card.js";
import type {
  BoardKey,
  BoardSnapshot,
  WorktreeRow as WorktreeRowModel,
} from "../../../../shared/types.js";
import { nowMs } from "../../../../shared/format-age.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { PageHeaderActions } from "@/components/PageHeaderActions";
import { PageHeaderCount } from "@/components/PageHeaderCount";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useIsMobile } from "@/components/ui/hooks/use-mobile";
import { WorkspaceRepos } from "@/modules/workspaces/components/WorkspaceRepos";
import { WorkspaceSection } from "@/modules/workspaces/components/WorkspaceSection";
import { WorkspacesDiskSummary } from "@/modules/workspaces/components/WorkspacesDiskSummary";
import { WorkspacesToolbar } from "@/modules/workspaces/components/WorkspacesToolbar";
import { WorktreeList } from "@/modules/workspaces/components/WorktreeList";
import { WorkspaceFoldersContainer } from "./WorkspaceFoldersContainer";
import { useWorkspacesSummary } from "@/modules/workspaces/hooks/use-workspaces-summary";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import {
  sortWorktreeRows,
  type WorkspacesSummary,
  type WorktreeSortKey,
} from "@/modules/workspaces/domain/workspace-rows";
import {
  useOpenWorkspaceEditorMutation,
  useWorkspaceInventory,
} from "@/modules/workspaces/queries/workspaces-queries";

interface WorkspacesContainerProps {
  boardKey: BoardKey;
  board: BoardSnapshot;
  onSummaryChange: (summary: WorkspacesSummary | undefined) => void;
  onOpenCard: (row: WorktreeRowModel) => void;
  onCleanupRequest: (row: WorktreeRowModel) => void;
}

export function WorkspacesContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  const board = useBoardSnapshot(
    boardKey,
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const [, setSummary] = useWorkspacesSummary();
  if (board == null) return null;

  const inWindow = (id: string) => board.cards.some((card) => card.id === id);
  const openCard = (row: WorktreeRowModel): void => {
    if (inWindow(row.cardId)) {
      appStore.selectCard(row.cardId, pinFromBoard(row.cardId, board.cards));
      return;
    }
    appStore.openSearchResult(
      {
        id: row.cardId,
        identifier: row.identifier,
        title: row.title,
        column: row.column,
      },
      false,
    );
  };
  return (
    <WorkspacesPage
      key={boardKey}
      boardKey={boardKey}
      board={board}
      onSummaryChange={setSummary}
      onOpenCard={openCard}
      onCleanupRequest={(row) => {
        if (inWindow(row.cardId)) appStore.openCleanup(row.cardId);
        else openCard(row);
      }}
    />
  );
}

export function WorkspacesHeaderContainer() {
  const [summary] = useWorkspacesSummary();
  if (summary == null) return null;
  return (
    <>
      <PageHeaderCount count={summary.count} />
      <PageHeaderActions>
        <WorkspacesDiskSummary
          totalKb={summary.totalKb}
          unknownSizes={summary.unknownSizes}
        />
      </PageHeaderActions>
    </>
  );
}

function WorkspacesPage({
  boardKey,
  board,
  onSummaryChange,
  onOpenCard,
  onCleanupRequest,
}: WorkspacesContainerProps) {
  const { inventory, loading, error, refresh, reload } = useWorkspaceInventory(
    boardKey,
    board,
  );
  const openEditor = useOpenWorkspaceEditorMutation();
  const narrow = useIsMobile();
  const [sortKey, setSortKey] = useState<WorktreeSortKey>("due");
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = inventory ? sortWorktreeRows(inventory.worktrees, sortKey) : [];
  const repos = inventory ? inventory.folders.flatMap((f) => f.repos) : [];
  const now = nowMs();

  useEffect(() => {
    onSummaryChange(
      inventory === null
        ? undefined
        : {
            count: inventory.worktrees.length,
            totalKb: inventory.totalKb,
            unknownSizes: inventory.unknownSizes,
          },
    );
  }, [inventory, onSummaryChange]);

  useEffect(() => () => onSummaryChange(undefined), [onSummaryChange]);

  const handleOpenEditor = (
    row: WorktreeRowModel,
    editor: "code" | "cursor",
  ): void => {
    setActionError(null);
    openEditor.mutate(
      { cardId: row.cardId, editor },
      {
        onError: (err) => {
          console.error("openEditor failed", err);
          setActionError(`Couldn't open ${row.identifier} in the editor.`);
        },
      },
    );
  };

  return (
    <>
      <WorkspacesToolbar
        sortKey={sortKey}
        loading={loading}
        onSortChange={setSortKey}
        onRefresh={refresh}
      />
      {error && (
        <ErrorAlert>Couldn't read the workspaces. Try Refresh.</ErrorAlert>
      )}
      {actionError && <ErrorAlert>{actionError}</ErrorAlert>}
      <WorkspaceSection title="Worktrees" count={rows.length}>
        <WorktreeList
          rows={inventory === null ? null : rows}
          editors={board.editors}
          now={now}
          narrow={narrow}
          onOpenCard={onOpenCard}
          onOpenEditor={handleOpenEditor}
          onCleanupRequest={onCleanupRequest}
        />
      </WorkspaceSection>
      <WorkspaceSection title="Folders" count={inventory?.folders.length ?? 0}>
        <WorkspaceFoldersContainer
          board={boardKey}
          folders={inventory?.folders ?? []}
          onChanged={reload}
          onActionError={setActionError}
        />
      </WorkspaceSection>
      <WorkspaceSection title="Repos" count={repos.length}>
        <WorkspaceRepos repos={repos} />
      </WorkspaceSection>
    </>
  );
}
