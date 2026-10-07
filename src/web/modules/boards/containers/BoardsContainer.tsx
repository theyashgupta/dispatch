import { useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import type { Board, BoardKey } from "../../../../shared/types.js";
import { ArchiveBoardDialog } from "@/modules/boards/components/ArchiveBoardDialog";
import { ArchivedBoards } from "@/modules/boards/components/ArchivedBoards";
import { BoardsEmpty } from "@/modules/boards/components/BoardsEmpty";
import { BoardsError } from "@/modules/boards/components/BoardsError";
import { BoardsList } from "@/modules/boards/components/BoardsList";
import { BoardsLoading } from "@/modules/boards/components/BoardsLoading";
import { BoardsTable } from "@/modules/boards/components/BoardsTable";
import { boardRows } from "@/modules/boards/domain/board-rows";
import { failureText } from "@/modules/boards/domain/board-form";
import { useBoardsNavigation } from "./use-boards-navigation";
import {
  useArchiveBoardMutation,
  useRestoreBoardMutation,
} from "@/modules/boards/queries/boards-queries";
import {
  useBoardCountsQuery,
  useBoardListQuery,
} from "@/queries/board-list-queries";
import { BoardEditContainer } from "./BoardEditContainer";
import { BoardFormContainer } from "./BoardFormContainer";

export function BoardsContainer() {
  const nav = useBoardsNavigation();
  const search = useSearch({ from: "/boards/{-$id}" });
  const list = useBoardListQuery();
  const counts = useBoardCountsQuery();
  const archive = useArchiveBoardMutation();
  const restore = useRestoreBoardMutation();
  const [editKey, setEditKey] = useState<BoardKey | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Board | null>(null);
  const [restoringKeys, setRestoringKeys] = useState<ReadonlySet<BoardKey>>(
    new Set(),
  );

  const runArchive = async (board: Board) => {
    const result = await archive.mutateAsync(board.key);
    setArchiveTarget(null);
    if (!result.ok) {
      toast.error(failureText("Archive board failed", result.error), {
        action: { label: "Try again", onClick: () => void runArchive(board) },
      });
      return;
    }
    toast.success(`Board ${board.name} archived.`);
    if (search.board === board.key) nav.leaveBoard();
  };

  const runRestore = async (board: Board) => {
    setRestoringKeys((prev) => new Set(prev).add(board.key));
    const result = await restore.mutateAsync(board.key);
    setRestoringKeys((prev) => {
      const next = new Set(prev);
      next.delete(board.key);
      return next;
    });
    if (!result.ok) {
      toast.error(failureText("Restore failed", result.error), {
        action: { label: "Try again", onClick: () => void runRestore(board) },
      });
      return;
    }
    toast.success(`Board ${board.name} restored.`);
  };

  if (list.isPending) return <BoardsLoading />;
  if (list.data === undefined) {
    return (
      <BoardsError
        message={list.error?.message ?? "The request failed"}
        onRetry={() => void list.refetch()}
      />
    );
  }

  const { boards, knownLinearTeamKeys } = list.data;
  const rows = boardRows(boards, counts.data?.counts, knownLinearTeamKeys);
  const onlyDefault =
    rows.length === 1 && rows[0]?.board.key === DEFAULT_BOARD_KEY;

  return (
    <>
      <BoardsTable
        rows={rows}
        onOpen={(board) => nav.openBoard(board.key)}
        onEdit={(board) => setEditKey(board.key)}
        onArchive={setArchiveTarget}
      />
      <BoardsList
        rows={rows}
        onOpen={(board) => nav.openBoard(board.key)}
        onEdit={(board) => setEditKey(board.key)}
        onArchive={setArchiveTarget}
      />
      {onlyDefault && <BoardsEmpty onNewBoard={nav.openCreateDialog} />}
      <ArchivedBoards
        boards={boards.filter((board) => board.archived)}
        restoringKeys={restoringKeys}
        onRestore={(board) => void runRestore(board)}
      />
      {search.dialog === "new" && (
        <BoardFormContainer
          target={{ mode: "create" }}
          boards={boards}
          knownLinearTeamKeys={knownLinearTeamKeys}
          onClose={nav.closeCreateDialog}
        />
      )}
      {editKey !== null && (
        <BoardEditContainer
          key={editKey}
          boardKey={editKey}
          boards={boards}
          knownLinearTeamKeys={knownLinearTeamKeys}
          onClose={() => setEditKey(null)}
        />
      )}
      {archiveTarget !== null && (
        <ArchiveBoardDialog
          name={archiveTarget.name}
          pending={archive.isPending}
          onClose={() => setArchiveTarget(null)}
          onArchive={() => void runArchive(archiveTarget)}
        />
      )}
    </>
  );
}
