import { BoardContainer } from "@/modules/board/containers/BoardContainer";
import { SearchContainer } from "@/modules/board/containers/SearchContainer";

export function BoardView() {
  return <BoardContainer search={<SearchContainer />} />;
}
