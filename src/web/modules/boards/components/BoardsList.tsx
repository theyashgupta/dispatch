import type { Board } from "../../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import type { BoardRow } from "@/modules/boards/domain/board-rows";
import { BoardCountBadge } from "./BoardCountBadge";
import { BoardLoopsBadge } from "./BoardLoopsBadge";
import { BoardNameMarks } from "./BoardNameMarks";
import { BoardRowMenu } from "./BoardRowMenu";

interface BoardsListProps {
  rows: BoardRow[];
  onOpen: (board: Board) => void;
  onEdit: (board: Board) => void;
  onArchive: (board: Board) => void;
}

export function BoardsList({
  rows,
  onOpen,
  onEdit,
  onArchive,
}: BoardsListProps) {
  return (
    <ItemGroup className="rounded-md border border-border bg-card md:hidden">
      {rows.map((row) => (
        <Item
          key={row.board.key}
          role="listitem"
          size="sm"
          className="flex-nowrap border-0 border-b last:border-b-0"
        >
          <ItemContent className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ItemTitle className="min-w-0 wrap-anywhere">
                {row.board.name}
              </ItemTitle>
              <span className="font-mono text-xs text-muted-foreground">
                {row.board.key}
              </span>
              <BoardNameMarks
                isDefault={row.board.key === DEFAULT_BOARD_KEY}
                keyClash={row.keyClash}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BoardCountBadge
                kind="running"
                count={row.counts?.running ?? null}
              />
              <BoardCountBadge
                kind="openGroups"
                count={row.counts?.openGroups ?? null}
              />
              <BoardCountBadge
                kind="attention"
                count={row.counts?.attention ?? null}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BoardLoopsBadge loops={row.counts?.loops ?? null} />
            </div>
          </ItemContent>
          <ItemActions>
            <BoardRowMenu
              archive={row.archive}
              onOpen={() => onOpen(row.board)}
              onEdit={() => onEdit(row.board)}
              onArchive={() => onArchive(row.board)}
            />
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
