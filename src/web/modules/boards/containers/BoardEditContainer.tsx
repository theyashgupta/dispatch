import type { Board, BoardKey } from "../../../../shared/types.js";
import { BoardDetailDialog } from "@/modules/boards/components/BoardDetailDialog";
import { useBoardDetailQuery } from "@/modules/boards/queries/boards-queries";
import { BoardFormContainer } from "./BoardFormContainer";

interface BoardEditContainerProps {
  boardKey: BoardKey;
  boards: Board[];
  knownLinearTeamKeys: string[];
  onClose: () => void;
}

export function BoardEditContainer({
  boardKey,
  boards,
  knownLinearTeamKeys,
  onClose,
}: BoardEditContainerProps) {
  const detail = useBoardDetailQuery(boardKey);
  if (detail.data === undefined) {
    return (
      <BoardDetailDialog
        error={detail.isError ? detail.error.message : null}
        onRetry={() => void detail.refetch()}
        onClose={onClose}
      />
    );
  }
  return (
    <BoardFormContainer
      target={{ mode: "edit", board: detail.data }}
      boards={boards}
      knownLinearTeamKeys={knownLinearTeamKeys}
      onClose={onClose}
    />
  );
}
