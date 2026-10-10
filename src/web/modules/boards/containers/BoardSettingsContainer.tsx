import { routeHash } from "../../../../shared/route.js";
import type { BoardKey } from "../../../../shared/types.js";
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
    return <BoardSettingsNotFound href={routeHash({ page: "boards" })} />;
  }
  return (
    <BoardSettingsFormContainer key={detail.data.key} board={detail.data} />
  );
}
