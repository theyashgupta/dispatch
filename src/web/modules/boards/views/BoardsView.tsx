import { PageColumn } from "@/components/PageColumn";
import { BoardsContainer } from "@/modules/boards/containers/BoardsContainer";

export function BoardsView() {
  return (
    <PageColumn>
      <BoardsContainer />
    </PageColumn>
  );
}
