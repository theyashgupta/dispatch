import type { CardSearchResult } from "../../../../shared/search.js";
import {
  BoardContainer,
  type BoardContainerProps,
} from "@/modules/board/containers/BoardContainer";
import { SearchContainer } from "@/modules/board/containers/SearchContainer";

export type BoardViewProps = Omit<BoardContainerProps, "search"> & {
  onSelectSearchResult?: (result: CardSearchResult) => void;
};

export function BoardView({ onSelectSearchResult, ...props }: BoardViewProps) {
  return (
    <BoardContainer
      {...props}
      search={
        <SearchContainer
          onSelectResult={(result) => onSelectSearchResult?.(result)}
        />
      }
    />
  );
}
