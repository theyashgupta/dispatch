import { useRouteContext } from "@tanstack/react-router";
import { pageLocation } from "../../../../shared/route.js";
import type { BoardKey } from "../../../../shared/types.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { BoardSettingsLoading } from "@/modules/boards/components/BoardSettingsLoading";
import { BoardSettingsNotFound } from "@/modules/boards/components/BoardSettingsNotFound";
import { BoardsError } from "@/modules/boards/components/BoardsError";
import { useBoardDetailQuery } from "@/modules/boards/queries/boards-queries";
import { BoardSettingsFormContainer } from "./BoardSettingsFormContainer";

interface BoardSettingsContainerProps {
  boardKey: string;
}

export function BoardSettingsContainer({
  boardKey,
}: BoardSettingsContainerProps) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const currentBoard = useAppStore(appStore, (s) => s.board);
  const detail = useBoardDetailQuery(boardKey as BoardKey);
  if (detail.data === undefined) {
    return detail.isError ? (
      <BoardsError
        title="Board did not load"
        message={detail.error.message}
        onRetry={() => void detail.refetch()}
      />
    ) : (
      <BoardSettingsLoading />
    );
  }
  if (detail.data === null) {
    return (
      <BoardSettingsNotFound
        href={`#${pageLocation({ page: "boards" }, currentBoard)}`}
      />
    );
  }
  return (
    <BoardSettingsFormContainer key={detail.data.key} board={detail.data} />
  );
}
