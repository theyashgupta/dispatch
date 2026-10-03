import { useEffect, useState } from "react";
import type {
  BoardSnapshot,
  WorktreeRow as WorktreeRowModel,
} from "../../../../shared/types.js";
import { nowMs } from "../../../../shared/format-age.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { useIsMobile } from "@/components/ui/hooks/use-mobile";
import { WorkspaceRepos } from "@/modules/workspaces/components/WorkspaceRepos";
import { WorkspaceSection } from "@/modules/workspaces/components/WorkspaceSection";
import { WorkspacesToolbar } from "@/modules/workspaces/components/WorkspacesToolbar";
import { WorktreeList } from "@/modules/workspaces/components/WorktreeList";
import { WorkspaceFoldersContainer } from "./WorkspaceFoldersContainer";
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
  board: BoardSnapshot;
  onSummaryChange: (summary: WorkspacesSummary | undefined) => void;
  onOpenCard: (row: WorktreeRowModel) => void;
  onCleanupRequest: (row: WorktreeRowModel) => void;
}

export function WorkspacesContainer({
  board,
  onSummaryChange,
  onOpenCard,
  onCleanupRequest,
}: WorkspacesContainerProps) {
  const { inventory, loading, error, refresh, reload } =
    useWorkspaceInventory(board);
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
